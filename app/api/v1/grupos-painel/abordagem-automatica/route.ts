/**
 * GET /api/v1/grupos-painel/abordagem-automatica — configuração do robô + como está o dia.
 * PUT /api/v1/grupos-painel/abordagem-automatica — liga/desliga e ajusta (gerente ou admin).
 *
 * Quem salva vira o "ator": as mensagens automáticas saem em nome dele.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  intervaloMedioMs,
  lerConfig,
  gravarConfig,
  situacaoDoDia,
} from "@/lib/grupos-painel/abordagem-automatica";
import { pessoasParaAbordar } from "@/lib/grupos-painel/abordagem";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const corpoSchema = z
  .object({
    ativo: z.boolean(),
    por_dia: z.number().int().min(1).max(80),
    hora_inicio: z.number().int().min(0).max(23),
    hora_fim: z.number().int().min(1).max(24),
    template_id: z.string().uuid().nullable(),
    fluxo_id: z.string().uuid().nullable(),
  })
  .refine((c) => c.hora_fim > c.hora_inicio, { message: "O fim tem de ser depois do início." })
  .refine((c) => !c.ativo || (c.template_id && c.fluxo_id), {
    message: "Escolha a mensagem de abertura e o fluxo do questionário antes de ligar.",
  });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const org = authz.org.orgId;
  const [config, dia, pessoas] = await Promise.all([
    lerConfig(admin, org),
    situacaoDoDia(admin, org, new Date()),
    pessoasParaAbordar(admin, org).catch(() => []),
  ]);
  return ok(
    {
      config,
      hoje: dia.hoje,
      ultima: dia.ultima,
      intervalo_medio_min: Math.round(intervaloMedioMs(config) / 60_000),
      na_fila: pessoas.filter((p) => !p.abordado_em).length,
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_error", corpo.error.issues[0]?.message ?? "dados inválidos", 400, { requestId });
  }
  const admin = createAdminClient();
  const org = authz.org.orgId;

  // O fluxo e a mensagem precisam ser DESTA organização.
  if (corpo.data.fluxo_id) {
    const { data } = await admin
      .from("followup_flow_pointers")
      .select("id")
      .eq("organization_id", org)
      .eq("id", corpo.data.fluxo_id)
      .maybeSingle();
    if (!data) return fail("not_found", "Fluxo não encontrado.", 404, { requestId });
  }
  if (corpo.data.template_id) {
    const { data } = await admin
      .from("message_templates")
      .select("id")
      .eq("organization_id", org)
      .eq("id", corpo.data.template_id)
      .maybeSingle();
    if (!data) return fail("not_found", "Mensagem não encontrada.", 404, { requestId });
  }

  const salvo = await gravarConfig(org, { ...corpo.data, ator_user_id: authz.user.id });
  void audit({
    action: "grupos_painel.abordagem_automatica_configurada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "organizations",
    resourceId: null,
    requestId,
    metadata: { ativo: salvo.ativo, por_dia: salvo.por_dia },
  });
  return ok({ config: salvo }, { requestId });
}
