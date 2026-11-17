/**
 * PATCH  /api/v1/grupos-painel/programadas/[id] — pausa/retoma, ou "enviar agora".
 * DELETE /api/v1/grupos-painel/programadas/[id] — apaga a programação.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { proximoEnvioDiario } from "@/lib/grupos-painel/programacao";
import { COLUNAS_DA_PROGRAMADA, type Programada } from "@/lib/grupos-painel/programadas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const corpoSchema = z.object({
  ativa: z.boolean().optional(),
  /** Manda na próxima rodada do cron (até 1 minuto). */
  enviar_agora: z.literal(true).optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const id = idSchema.safeParse((await ctx.params).id);
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !corpo.success) return fail("validation_error", "dados inválidos", 400, { requestId });
  const admin = createAdminClient();
  const org = authz.org.orgId;
  const { data: atual } = await admin
    .from("grupos_mensagens_programadas")
    .select(COLUNAS_DA_PROGRAMADA)
    .eq("organization_id", org)
    .eq("id", id.data)
    .maybeSingle();
  if (!atual) return fail("not_found", "Programação não encontrada.", 404, { requestId });
  const p = atual as unknown as Programada;

  const mudanca: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (corpo.data.enviar_agora) {
    mudanca.ativa = true;
    mudanca.proximo_envio = new Date().toISOString();
  } else if (corpo.data.ativa !== undefined) {
    mudanca.ativa = corpo.data.ativa;
    // Retomar uma diária recalcula a próxima a partir de agora.
    if (corpo.data.ativa && p.frequencia === "diaria" && p.horario) {
      mudanca.proximo_envio = proximoEnvioDiario(new Date(), {
        horario: p.horario,
        dias_semana: p.dias_semana ?? [],
        variacao_min: p.variacao_min,
      }).toISOString();
    }
  }
  const { data, error } = await admin
    .from("grupos_mensagens_programadas")
    .update(mudanca)
    .eq("organization_id", org)
    .eq("id", id.data)
    .select(COLUNAS_DA_PROGRAMADA)
    .single();
  if (error) return fail("internal_error", "Não foi possível salvar agora.", 500, { requestId });
  void audit({
    action: "grupos_painel.programada_alterada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "grupos_mensagens_programadas",
    requestId,
    metadata: { programada_id: id.data, ativa: corpo.data.ativa, enviar_agora: corpo.data.enviar_agora ?? false },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return fail("validation_error", "id inválido", 400, { requestId });
  const { data, error } = await createAdminClient()
    .from("grupos_mensagens_programadas")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id.data)
    .select("id");
  if (error) return fail("internal_error", "Não foi possível apagar agora.", 500, { requestId });
  if (!data?.length) return fail("not_found", "Programação não encontrada.", 404, { requestId });
  void audit({
    action: "grupos_painel.programada_alterada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "grupos_mensagens_programadas",
    requestId,
    metadata: { programada_id: id.data, apagada: true },
  });
  return ok({ id: id.data }, { requestId });
}
