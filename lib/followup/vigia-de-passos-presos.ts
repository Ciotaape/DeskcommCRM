/**
 * VIGIA DE PASSOS PRESOS — a rede de segurança do passo de envio do fluxo.
 *
 * O defeito que ela cobre: o passo de texto do fluxo ENVIA a mensagem, mas o
 * turno termina sem gravar `action_sent` (o caso medido em produção é o
 * `service_boundary_stale`: o cliente responde rápido e o passo fecha depois).
 * Sem o `action_sent`, a inscrição fica em recheck no nó de envio até o
 * dead-man matá-la (`action_turn_never_completed`), horas depois — e a resposta
 * do cliente à pergunta que ele JÁ recebeu é ignorada.
 *
 * `registrarDesfechoDoPassoObsoleto` (worker) e `registrarDesfechoDoTextoObsoleto`
 * (drain inline) fecham esse caso na hora em que ele acontece. Esta vigia roda
 * no cron de minuto e pega o que escapar dos dois — outro caminho de erro, um
 * processo que caiu entre o envio e o fechamento —, com a MESMA regra, e quem
 * decide é sempre o `send_ledger` do job, nunca um palpite:
 *
 *  - ledger `accepted`/`queued`: a mensagem saiu. Grava `action_sent`; o motor
 *    vê o envio fechado e avança (`actionTurnCompleted`). Nada é reenviado.
 *  - ledger vazio E o job caiu na fronteira (`service_boundary_stale`): nada
 *    saiu. Grava `turn_discarded`; o motor enfileira o mesmo passo de novo.
 *  - qualquer outro estado (`requested` = pode ter saído): não mexe. Envio em
 *    dobro é pior que não-envio; o dead-man e o aviso da Central seguem valendo.
 *
 * Só olha a inscrição `active` parada num nó cujo ÚLTIMO job de envio já
 * terminou há mais de 2 minutos — o passo que ainda está na fila ou rodando não
 * é passo preso.
 */
import type pg from "pg";

export interface ResultadoDaVigia {
  fechados: number;
  reenfileirados: number;
}

const CARENCIA_EM_MINUTOS = 2;

export async function vigiarPassosPresos(db: Pick<pg.Pool, "query">): Promise<ResultadoDaVigia> {
  const { rows } = await db.query<{ evento: string; n: string }>(
    `with ultimo_job as (
       select e.id as enrollment_id, e.organization_id, e.current_node_id as node_id,
              j.id as job_id, j.status as job_status, j.last_error, j.created_at as job_criado,
              coalesce(j.payload->>'source_step_key', j.id::text) as step_key,
              l.status as ledger, l.updated_at as enviado_em
         from public.followup_enrollments e
         join lateral (
           select j.* from public.job_queue j
            where j.organization_id = e.organization_id
              and j.kind = 'followup_turn'
              and j.payload->>'followup_enrollment_id' = e.id::text
              and j.payload->>'node_id' = e.current_node_id
              and j.payload->>'purpose' = 'send_message'
            order by j.created_at desc
            limit 1
         ) j on true
         left join lateral (
           select s.status, s.updated_at from public.send_ledger s
            where s.organization_id = e.organization_id and s.job_id = j.id
            order by s.seq desc
            limit 1
         ) l on true
        where e.status = 'active'
          and j.status in ('done', 'failed', 'dead')
          and j.created_at > now() - interval '2 days'
          and coalesce(j.locked_at, j.run_after, j.created_at) < now() - make_interval(mins => $1)
     ),
     decidido as (
       select u.*,
              case
                when u.ledger in ('accepted', 'queued') then 'action_sent'
                when u.ledger is null and u.last_error = 'service_boundary_stale' then 'turn_discarded'
              end as evento
         from ultimo_job u
        where not exists (
          select 1 from public.followup_enrollment_events ev
           where ev.organization_id = u.organization_id
             and ev.enrollment_id = u.enrollment_id
             and ev.node_id = u.node_id
             and ev.event_type in ('action_sent', 'turn_discarded', 'action_skipped')
             and ev.created_at >= u.job_criado
        )
     ),
     gravado as (
       insert into public.followup_enrollment_events
         (organization_id, enrollment_id, node_id, event_type, payload, idempotency_key)
       select d.organization_id, d.enrollment_id, d.node_id, d.evento,
              jsonb_build_object('job_id', d.job_id, 'motivo', 'vigia_de_passo_preso')
                || case when d.evento = 'action_sent' and d.enviado_em is not null
                        then jsonb_build_object('enviado_em', d.enviado_em) else '{}'::jsonb end,
              d.step_key || ':vigia:' || d.evento
         from decidido d
        where d.evento is not null
       on conflict (enrollment_id, idempotency_key) where idempotency_key is not null do nothing
       returning organization_id, enrollment_id, event_type
     ),
     acordado as (
       update public.followup_enrollments f
          set next_eval_at = now()
         from gravado g
        where f.id = g.enrollment_id and f.organization_id = g.organization_id
       returning f.id
     )
     select event_type as evento, count(*)::text as n from gravado group by event_type`,
    [CARENCIA_EM_MINUTOS],
  );
  const contar = (evento: string) => Number(rows.find((r) => r.evento === evento)?.n ?? 0);
  return { fechados: contar("action_sent"), reenfileirados: contar("turn_discarded") };
}
