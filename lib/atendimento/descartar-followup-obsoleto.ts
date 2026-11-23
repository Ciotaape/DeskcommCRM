import type { Pool } from "pg";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { claimOfJob } from "@/lib/agent-engine/queue/claim";
import { cancelJob, type JobRow } from "@/lib/agent-engine/queue/queue";

/** Descartar o turno não cancela a inscrição: pause/cancel continuam sendo
 * decisões do fluxo. O rastro permite retomar sem falso worker morto.
 * Só o worker (sem auth.uid de uma sessão) chama esta função.
 */
export async function descartarFollowupObsoleto(
  pool: Pool,
  job: JobRow,
  workerId: string,
  log: Pick<Logger, "warn"> = logger,
): Promise<void> {
  const claim = claimOfJob(job);
  if (!claim || job.kind !== "followup_turn") return;
  const tx = await pool.connect();
  try {
    await tx.query("begin");
    const { rows } = await tx.query(
      `select id from job_queue where organization_id=$1 and id=$2
         and kind='followup_turn' and status='running' and locked_by=$3
         and locked_at=$4::timestamptz for update`,
      [job.organization_id, job.id, workerId, claim.acquired_at],
    );
    if (rows.length) {
      const { rows: revogado } = await tx.query<{ r: boolean }>(
        `select public.fn_autonomous_turn_revoked($1,$2) as r`,
        [job.organization_id, job.id],
      );
      if (revogado[0]?.r === true) {
        await tx.query(`select fn_followup_turno_descartado($1,$2)`, [job.organization_id, job.id]);
      } else {
        // O cliente escreveu de novo entre o enfileiramento e o envio (atendimento
        // novo). O passo NÃO saiu: grava o descarte para o motor enfileirar o
        // mesmo passo de novo com a fronteira atual. Sem isto a inscrição ficava
        // em recheck até morrer (`action_turn_never_completed`) e o lead parava
        // no meio do questionário.
        await tx.query(
          `insert into public.followup_enrollment_events
             (organization_id, enrollment_id, node_id, event_type, payload, idempotency_key)
           select $1, e.id, e.current_node_id, 'turn_discarded',
                  jsonb_build_object('job_id', j.id, 'motivo', 'service_boundary_stale'),
                  coalesce(j.payload->>'source_step_key', j.id::text) || ':descartado'
             from public.job_queue j
             join public.followup_enrollments e
               on e.organization_id = $1
              and e.id::text = j.payload->>'followup_enrollment_id'
              and e.current_node_id = j.payload->>'node_id'
              and e.status in ('active', 'waiting_reply')
            where j.id = $2 and j.organization_id = $1
              and j.kind = 'followup_turn'
              and j.payload->>'purpose' = 'send_message'
           on conflict (enrollment_id, idempotency_key) where idempotency_key is not null do nothing`,
          [job.organization_id, job.id],
        );
      }
      await cancelJob(tx, job.id, workerId, "service_boundary_stale", claim.acquired_at);
    } else {
      // Não registra descarte nem altera o lease que já pertence a outro ciclo.
      log.warn("followup_stale_discard_lease_changed", {
        job_id: job.id, organization_id: job.organization_id, kind: job.kind,
      });
    }
    await tx.query("commit");
  } catch (error) {
    await tx.query("rollback");
    throw error;
  } finally {
    tx.release();
  }
}
