import { describe, expect, it } from "vitest";
import { proximoEnvioDiario } from "./programacao";

const zero = () => 0;

describe("proximoEnvioDiario", () => {
  it("hoje mais tarde, no horário de Brasília", () => {
    // 10:00 em Brasília = 13:00 UTC
    const agora = new Date("2026-11-16T13:00:00Z");
    expect(proximoEnvioDiario(agora, { horario: "18:30", dias_semana: [], variacao_min: 0 }, zero).toISOString()).toBe(
      "2026-11-16T21:30:00.000Z",
    );
  });

  it("horário já passou → amanhã", () => {
    const agora = new Date("2026-11-16T22:00:00Z"); // 19:00 BRT
    expect(proximoEnvioDiario(agora, { horario: "18:30", dias_semana: [], variacao_min: 0 }, zero).toISOString()).toBe(
      "2026-11-17T21:30:00.000Z",
    );
  });

  it("perto da meia-noite UTC usa o dia de Brasília", () => {
    const agora = new Date("2026-11-17T01:00:00Z"); // 22:00 BRT do dia 16
    expect(proximoEnvioDiario(agora, { horario: "23:00", dias_semana: [], variacao_min: 0 }, zero).toISOString()).toBe(
      "2026-11-17T02:00:00.000Z",
    );
  });

  it("respeita os dias da semana (16/11/2026 é segunda)", () => {
    const agora = new Date("2026-11-16T13:00:00Z");
    // só sábado (6)
    expect(proximoEnvioDiario(agora, { horario: "09:00", dias_semana: [6], variacao_min: 0 }, zero).toISOString()).toBe(
      "2026-11-21T12:00:00.000Z",
    );
  });

  it("variação soma até N minutos depois", () => {
    const agora = new Date("2026-11-16T13:00:00Z");
    const r = proximoEnvioDiario(agora, { horario: "18:00", dias_semana: [], variacao_min: 30 }, () => 0.999);
    expect(r.toISOString()).toBe("2026-11-16T21:30:00.000Z");
  });
});
