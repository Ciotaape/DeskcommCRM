import { describe, expect, it } from "vitest";

import {
  CONFIG_PADRAO,
  horaDaProxima,
  horaLocal,
  inicioDoDiaLocal,
  intervaloMedioMs,
  proximaPessoa,
} from "./abordagem-automatica";
import type { PessoaParaAbordar } from "./abordagem";

const pessoa = (p: Partial<PessoaParaAbordar>): PessoaParaAbordar => ({
  telefone: "5582999990000",
  telefone_chave: "82999990000",
  nome: null,
  grupos: [],
  mensagens_no_grupo: 0,
  ultima_mensagem: null,
  abordado_em: null,
  ...p,
});

describe("abordagem automática", () => {
  it("hora de Maceió é UTC−3", () => {
    expect(horaLocal(new Date("2026-11-22T12:00:00Z"))).toBe(9);
    expect(horaLocal(new Date("2026-11-22T02:00:00Z"))).toBe(23);
  });

  it("o dia local começa às 03:00 UTC", () => {
    expect(inicioDoDiaLocal(new Date("2026-11-22T02:30:00Z")).toISOString()).toBe("2026-11-21T03:00:00.000Z");
    expect(inicioDoDiaLocal(new Date("2026-11-22T15:00:00Z")).toISOString()).toBe("2026-11-22T03:00:00.000Z");
  });

  it("30 por dia em 10 horas dá um a cada 20 minutos", () => {
    expect(intervaloMedioMs(CONFIG_PADRAO)).toBe(20 * 60_000);
  });

  it("nunca antes de 75% do intervalo, sempre depois de 125%, sorteio no meio", () => {
    const i = 20 * 60_000;
    expect(horaDaProxima(i * 0.7, i, 0)).toBe(false);
    expect(horaDaProxima(i * 1.3, i, 0.99)).toBe(true);
    expect(horaDaProxima(i, i, 0.1)).toBe(true);
    expect(horaDaProxima(i, i, 0.9)).toBe(false);
  });

  it("escolhe quem mais fala e pula quem já foi abordado", () => {
    const escolhida = proximaPessoa([
      pessoa({ telefone_chave: "a", mensagens_no_grupo: 50, abordado_em: "2026-11-20T10:00:00Z" }),
      pessoa({ telefone_chave: "b", mensagens_no_grupo: 3 }),
      pessoa({ telefone_chave: "c", mensagens_no_grupo: 12 }),
    ]);
    expect(escolhida?.telefone_chave).toBe("c");
    expect(proximaPessoa([pessoa({ abordado_em: "x" })])).toBeNull();
  });
});
