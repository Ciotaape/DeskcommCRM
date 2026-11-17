/**
 * O CRON DAS MENSAGENS PROGRAMADAS PARA GRUPOS (aba Grupos › Programadas).
 *
 * Roda por minuto. Para cada programação ativa com `proximo_envio` vencido:
 *   1. CLAIM: avança `proximo_envio` com UPDATE condicional (só quem trocar o
 *      valor que leu processa) — duas rodadas nunca mandam a mesma vez.
 *      Única → desativa; diária → próxima ocorrência com a variação aleatória.
 *   2. Envia a cada grupo pelo caminho do Inbox, com pausa entre grupos.
 *   3. Grava o resultado ("3 de 3 grupos") e audita (só quando enviou algo).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { proximoEnvioDiario } from "@/lib/grupos-painel/programacao";
import { COLUNAS_DA_PROGRAMADA, enviarProgramada, type Programada } from "@/lib/grupos-painel/programadas";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOTE = 10;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });

  const admin = createAdminClient();
  const agora = new Date();
  const { data: devidas, error } = await admin
    .from("grupos_mensagens_programadas")
    .select(`${COLUNAS_DA_PROGRAMADA}, organization_id`)
    .eq("ativa", true)
    .lte("proximo_envio", agora.toISOString())
    .order("proximo_envio", { ascending: true })
    .limit(LOTE);
  if (error) return fail("internal_error", "Erro ao ler as programações devidas.", 500, { requestId });

  const paradas = new Set(await idsDeOrgsParadas(admin));
  const resumo = { processadas: 0, enviadas: 0, falhas: 0 };

  for (const linha of (devidas ?? []) as Array<Programada & { organization_id: string }>) {
    if (paradas.has(linha.organization_id)) continue;
    const proximo =
      linha.frequencia === "diaria" && linha.horario
        ? proximoEnvioDiario(agora, { horario: linha.horario, dias_semana: linha.dias_semana ?? [], variacao_min: linha.variacao_min })
        : null;
    const { data: reservada } = await admin
      .from("grupos_mensagens_programadas")
      .update({
        proximo_envio: proximo?.toISOString() ?? null,
        ativa: proximo !== null,
        updated_at: agora.toISOString(),
      })
      .eq("id", linha.id)
      .eq("organization_id", linha.organization_id)
      .eq("ativa", true)
      .eq("proximo_envio", linha.proximo_envio as string)
      .select("id");
    if (!reservada?.length) continue;
    resumo.processadas++;

    const r = await enviarProgramada(admin, linha.organization_id, linha, requestId);
    resumo.enviadas += r.enviadas;
    resumo.falhas += r.falhas;
    const total = linha.conversation_ids.length;
    const resultado = r.motivo === "sem_acesso"
      ? "Não enviada: quem programou não tem mais acesso."
      : `Enviada para ${r.enviadas} de ${total} grupo(s).`;
    await admin
      .from("grupos_mensagens_programadas")
      .update({ ultimo_envio: new Date().toISOString(), ultimo_resultado: resultado })
      .eq("id", linha.id)
      .eq("organization_id", linha.organization_id);
    if (r.enviadas > 0) {
      void audit({
        action: "grupos_painel.programada_enviada",
        organizationId: linha.organization_id,
        actorUserId: null,
        resourceType: "grupos_mensagens_programadas",
        resourceId: linha.id,
        requestId,
        metadata: { enviadas: r.enviadas, falhas: r.falhas },
      });
    }
  }
  return ok(resumo, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
