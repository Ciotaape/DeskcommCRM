/**
 * Quando sai a próxima mensagem programada de grupo.
 *
 * Horário de Brasília fixo (UTC-3; o Brasil não tem horário de verão desde
 * 2019). A variação aleatória espalha o envio em até N minutos DEPOIS do
 * horário escolhido — mandar no mesmo segundo todo dia é padrão de robô, e o
 * WhatsApp pune padrão de robô.
 */
const OFFSET_MS = -3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

export interface RegraDiaria {
  horario: string; // "HH:MM"
  dias_semana: readonly number[]; // 0=dom … 6=sáb; vazio = todos
  variacao_min: number;
}

export function proximoEnvioDiario(agora: Date, regra: RegraDiaria, aleatorio: () => number = Math.random): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(regra.horario);
  if (!m) throw new Error("horario_invalido");
  const minutosDoDia = Number(m[1]) * 60 + Number(m[2]);
  // "Meia-noite de hoje" em Brasília, expressa em UTC.
  const local = new Date(agora.getTime() + OFFSET_MS);
  const meiaNoiteLocalUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_MS;
  const dias = regra.dias_semana.length > 0 ? new Set(regra.dias_semana) : null;
  for (let d = 0; d <= 7; d++) {
    const base = meiaNoiteLocalUtc + d * DIA_MS + minutosDoDia * 60_000;
    const diaDaSemana = new Date(base + OFFSET_MS).getUTCDay();
    if (dias && !dias.has(diaDaSemana)) continue;
    if (base <= agora.getTime()) continue;
    const variacao = Math.floor(aleatorio() * (Math.max(0, regra.variacao_min) + 1)) * 60_000;
    return new Date(base + variacao);
  }
  throw new Error("sem_dia_valido");
}
