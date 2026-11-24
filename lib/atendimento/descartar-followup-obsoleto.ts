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
      const { rows: revogado } = await tx.query<{ revogado: boolean }>(
        `select public.fn_autonomous_turn_revoked($1,$2) as revogado`,
        [job.organization_id, job.id],
      );
      if (revogado[0]?.revogado === true) {
        await tx.query(`select fn_followup_turno_descartado($1,$2)`, [job.organization_id, job.id]);
      } else {
        await registrarDesfechoDoPassoObsoleto(tx, job);
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

type Consultor = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * O turno de ENVIO do fluxo caiu na fronteira de atendimento (o cliente escreveu
 * de novo entre o enfileiramento e o fechamento do passo). Antes, nada era
 * gravado e a inscrição ficava em recheck até morrer com
 * `action_turn_never_completed` — inclusive quando a mensagem JÁ tinha saído,
 * que é o caso comum: o cliente responde rápido e o passo fecha depois.
 *
 * O `send_ledger` do job diz o que aconteceu, e só ele decide:
 *  - `accepted`/`queued`: a mensagem saiu (ou está retida para sair). Grava
 *    `action_sent` no passo; o motor vê o envio fechado e avança
 *    (`actionTurnCompleted` em node-handlers.ts). Nada é reenviado.
 *  - nenhuma linha: nada saiu. Grava `turn_discarded`; o motor enfileira o mesmo
 *    passo de novo com a fronteira atual.
 *  - qualquer outro estado (`requested` = pode ter saído): não grava nada — o
 *    comportamento de antes. Envio em dobro é pior que não-envio.
 */
export async function registrarDesfechoDoPassoObsoleto(tx: Consultor, job: JobRow): Promise<void> {
  if (job.payload?.purpose !== "send_message") return;
  const { rows } = (await tx.query(
    `select status, updated_at from send_ledger where organization_id=$1 and job_id=$2 order by seq desc limit 1`,
    [job.organization_id, job.id],
  )) as { rows: Array<{ status: string; updated_at: Date | string | null }> };
  const estado = rows[0]?.status ?? null;
  const enviadoEm = rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString() : null;
  const evento =
    estado === "accepted" || estado === "queued" ? "action_sent" : estado === null ? "turn_discarded" : null;
  if (evento === null) return;
  await tx.query(
    `with gravado as (
       insert into public.followup_enrollment_events
         (organization_id, enrollment_id, node_id, event_type, payload, idempotency_key)
       select $1, e.id, e.current_node_id, $3,
              jsonb_build_object('job_id', j.id, 'motivo', 'service_boundary_stale')
                || case when $3 = 'action_sent' and $4::text is not null
                        then jsonb_build_object('enviado_em', $4::text) else '{}'::jsonb end,
              coalesce(j.payload->>'source_step_key', j.id::text) || ':' || $3
         from public.job_queue j
         join public.followup_enrollments e
           on e.organization_id = $1
          and e.id::text = j.payload->>'followup_enrollment_id'
          and e.current_node_id = j.payload->>'node_id'
          and e.status in ('active', 'waiting_reply')
        where j.id = $2 and j.organization_id = $1 and j.kind = 'followup_turn'
       on conflict (enrollment_id, idempotency_key) where idempotency_key is not null do nothing
       returning enrollment_id
     )
     update public.followup_enrollments f set next_eval_at = now()
       from gravado g where f.id = g.enrollment_id and f.organization_id = $1`,
    [job.organization_id, job.id, evento, enviadoEm],
  );
}
