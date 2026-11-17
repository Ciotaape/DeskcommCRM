/**
 * GET  /api/v1/grupos-painel/programadas — as mensagens programadas e os grupos disponíveis.
 * POST /api/v1/grupos-painel/programadas — programa uma mensagem para um ou vários grupos.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  COLUNAS_DA_PROGRAMADA,
  gruposDaOrganizacao,
  idsForaDaOrganizacao,
  primeiroEnvio,
  programadaSchema,
} from "@/lib/grupos-painel/programadas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  try {
    const [{ data, error }, grupos] = await Promise.all([
      admin
        .from("grupos_mensagens_programadas")
        .select(COLUNAS_DA_PROGRAMADA)
        .eq("organization_id", authz.org.orgId)
        .order("created_at", { ascending: false })
        .limit(200),
      gruposDaOrganizacao(admin, authz.org.orgId),
    ]);
    if (error) throw error;
    return ok({ programadas: data ?? [], grupos }, { requestId });
  } catch (err) {
    logger.error("grupos-painel: falha ao ler programadas", { requestId, causa: err instanceof Error ? err.message : String(err) });
    return fail("internal_error", "Não foi possível ler as mensagens programadas.", 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const corpo = programadaSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_error", corpo.error.issues[0]?.message ?? "dados inválidos", 400, { requestId });
  }
  const p = corpo.data;
  const org = authz.org.orgId;
  const admin = createAdminClient();
  const fora = await idsForaDaOrganizacao(admin, org, p.conversation_ids);
  if (fora.length > 0) {
    return fail("unprocessable_entity", "Algum grupo escolhido não existe mais.", 422, { requestId, details: { fora } });
  }
  const proximo = primeiroEnvio(p);
  if (p.frequencia === "unica" && proximo.getTime() < Date.now() - 60_000) {
    return fail("validation_error", "A data já passou.", 400, { requestId });
  }
  const { data, error } = await admin
    .from("grupos_mensagens_programadas")
    .insert({
      organization_id: org,
      conversation_ids: [...new Set(p.conversation_ids)],
      corpo: p.corpo,
      frequencia: p.frequencia,
      horario: p.frequencia === "diaria" ? p.horario : null,
      dias_semana: p.frequencia === "diaria" ? p.dias_semana : [],
      variacao_min: p.variacao_min,
      proximo_envio: proximo.toISOString(),
      created_by_user_id: authz.user.id,
    })
    .select(COLUNAS_DA_PROGRAMADA)
    .single();
  if (error) {
    logger.error("grupos-painel: falha ao programar", { requestId, causa: error.message });
    return fail("internal_error", "Não foi possível programar agora.", 500, { requestId });
  }
  void audit({
    action: "grupos_painel.programada_criada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "grupos_mensagens_programadas",
    resourceId: (data as { id: string }).id,
    requestId,
    metadata: { grupos: p.conversation_ids.length, frequencia: p.frequencia },
  });
  return ok(data, { requestId, status: 201 });
}
