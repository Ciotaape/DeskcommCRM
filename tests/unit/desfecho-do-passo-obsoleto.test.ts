import { expect, it, vi } from "vitest";
import type { JobRow } from "@/lib/agent-engine/queue/queue";
import { registrarDesfechoDoPassoObsoleto } from "@/lib/atendimento/descartar-followup-obsoleto";

const job = {
  id: "job",
  organization_id: "org",
  kind: "followup_turn",
  payload: { purpose: "send_message", followup_enrollment_id: "enr", node_id: "p2" },
} as unknown as JobRow;

function txComLedger(status: string | null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("from send_ledger")) return { rows: status === null ? [] : [{ status }] };
    return { rows: [] };
  });
  return { query };
}

function eventoGravado(tx: ReturnType<typeof txComLedger>): string | null {
  const chamada = tx.query.mock.calls.find(([sql]) => String(sql).includes("followup_enrollment_events"));
  return chamada ? ((chamada as unknown as [string, unknown[]])[1][2] as string) : null;
}

it("mensagem que já saiu fecha o passo com action_sent (nada é reenviado)", async () => {
  const tx = txComLedger("accepted");
  await registrarDesfechoDoPassoObsoleto(tx, job);
  expect(eventoGravado(tx)).toBe("action_sent");
});

it("mensagem retida para sair também conta como enviada", async () => {
  const tx = txComLedger("queued");
  await registrarDesfechoDoPassoObsoleto(tx, job);
  expect(eventoGravado(tx)).toBe("action_sent");
});

it("sem envio nenhum, o passo é descartado para o motor enfileirar de novo", async () => {
  const tx = txComLedger(null);
  await registrarDesfechoDoPassoObsoleto(tx, job);
  expect(eventoGravado(tx)).toBe("turn_discarded");
});

it("envio incerto (requested) não grava nada: envio em dobro é pior que não-envio", async () => {
  const tx = txComLedger("requested");
  await registrarDesfechoDoPassoObsoleto(tx, job);
  expect(eventoGravado(tx)).toBeNull();
});

it("turno que não é de envio fica como antes", async () => {
  const tx = txComLedger("accepted");
  await registrarDesfechoDoPassoObsoleto(tx, { ...job, payload: { purpose: "classify" } } as unknown as JobRow);
  expect(tx.query).not.toHaveBeenCalled();
});
