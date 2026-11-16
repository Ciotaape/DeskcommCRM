/**
 * GET   /api/v1/grupos-painel/[id] — membros do grupo, quem comprou e quem não comprou.
 * PATCH /api/v1/grupos-painel/[id] — liga/desliga "acompanhar" e troca o código do link (`?src=`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { detalheDoGrupo, sincronizarGrupos } from "@/lib/grupos-painel/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const idSchema = z.string().uuid();
const corpoSchema = z
  .object({
    acompanhar: z.boolean().optional(),
    codigo_origem: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_-]{1,40}$/, "use só letras, números, - ou _")
      .nullable()
      .optional(),
  })
  .refine((c) => c.acompanhar !== undefined || c.codigo_origem !== undefined, { message: "nada para mudar" });

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return fail("validation_error", "id inválido", 400, { requestId });
  const detalhe = await detalheDoGrupo(createAdminClient(), authz.org.orgId, id.data);
  if (!detalhe) return fail("not_found", "Grupo não encontrado.", 404, { requestId });
  return ok(detalhe, { requestId });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const id = idSchema.safeParse((await ctx.params).id);
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !corpo.success) {
    return fail("validation_error", corpo.success ? "id inválido" : corpo.error.issues[0]?.message ?? "dados inválidos", 400, { requestId });
  }
  const admin = createAdminClient();
  const mudanca: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (corpo.data.acompanhar !== undefined) mudanca.acompanhar = corpo.data.acompanhar;
  if (corpo.data.codigo_origem !== undefined) mudanca.codigo_origem = corpo.data.codigo_origem || null;

  const { data, error } = await admin
    .from("grupos_painel")
    .update(mudanca)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id.data)
    .select("id, acompanhar, codigo_origem")
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return fail("conflict", "Esse código já está em outro grupo.", 409, { requestId });
    }
    logger.error("grupos-painel: falha ao gravar", { requestId, causa: error.message });
    return fail("internal_error", "Não foi possível salvar agora.", 500, { requestId });
  }
  if (!data) return fail("not_found", "Grupo não encontrado.", 404, { requestId });

  // Ligou o acompanhamento: o retrato dos membros sai na hora, para a tela já
  // mostrar a conversão. Se o WhatsApp falhar, a chave fica salva e o botão
  // "Sincronizar" resolve depois.
  if (corpo.data.acompanhar === true) {
    await sincronizarGrupos(admin, authz.org.orgId, { soGrupoId: id.data }).catch((err) =>
      logger.warn("grupos-painel: sincronização do grupo falhou", { requestId, causa: err instanceof Error ? err.message : String(err) }),
    );
  }
  void audit({
    action: "grupos_painel.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "grupos_painel",
    requestId,
    metadata: { grupo_id: id.data, acompanhar: corpo.data.acompanhar, codigo_origem: corpo.data.codigo_origem },
  });
  return ok(data, { requestId });
}
