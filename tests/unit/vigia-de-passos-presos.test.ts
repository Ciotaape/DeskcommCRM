import { expect, it, vi } from "vitest";
import { vigiarPassosPresos } from "@/lib/followup/vigia-de-passos-presos";

it("conta o que destravou, separando fechados de reenfileirados", async () => {
  const query = vi.fn(async () => ({
    rows: [
      { evento: "action_sent", n: "3" },
      { evento: "turn_discarded", n: "1" },
    ],
  }));
  const r = await vigiarPassosPresos({ query } as never);
  expect(r).toEqual({ fechados: 3, reenfileirados: 1 });
  // A carência é parâmetro, nunca concatenada no SQL.
  expect(query).toHaveBeenCalledWith(expect.any(String), [2]);
});

it("nada preso: zero e zero", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  expect(await vigiarPassosPresos({ query } as never)).toEqual({ fechados: 0, reenfileirados: 0 });
});

it("a regra mora no SQL: só o ledger decide, e o envio incerto não é tocado", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  await vigiarPassosPresos({ query } as never);
  const sql = String((query.mock.calls[0] as unknown as [string])[0]);
  expect(sql).toContain("when u.ledger in ('accepted', 'queued') then 'action_sent'");
  expect(sql).toContain("when u.ledger is null and u.last_error = 'service_boundary_stale' then 'turn_discarded'");
  expect(sql).not.toMatch(/'requested'/);
  expect(sql).toContain("e.status = 'active'");
});
