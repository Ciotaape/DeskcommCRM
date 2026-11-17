/**
 * GET  /api/v1/grupos-painel/abordagem — quem está nos grupos e ainda não comprou.
 * POST /api/v1/grupos-painel/abordagem — chama UMA pessoa no privado com a resposta rápida escolhida.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/require-role";
import { abordar, pessoasParaAbordar } from "@/lib/grupos-painel/abordagem";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { assumirConversaComEfeitos } from "@/lib/inbox/assumir-conversa";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const corpoSchema = z.object({
  telefone: z.string().trim().min(8).max(30),
  nome: z.string().trim().min(1).max(200).nullable().optional(),
  template_id: z.string().uuid(),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  try {
    return ok(await pessoasParaAbordar(createAdminClient(), authz.org.orgId), { requestId });
  } catch (err) {
    logger.error("grupos-painel: falha ao montar a lista de abordagem", {
      requestId,
      causa: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "Não foi possível montar a lista agora.", 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_error", "dados inválidos", 400, { requestId });

  try {
    const r = await abordar(createAdminClient(), authz.org.orgId, {
      userId: authz.user.id,
      requestId,
      telefone: corpo.data.telefone,
      nome: corpo.data.nome ?? null,
      templateId: corpo.data.template_id,
    });
    // A conversa aberta pelo clique é de quem clicou (se estiver livre).
    try {
      await assumirConversaComEfeitos(await createClient(), {
        organizationId: authz.org.orgId,
        conversationId: r.conversation_id,
        actor: { type: "user", id: authz.user.id },
        requestId,
      });
    } catch {
      // Sem dono a conversa ainda aparece para gerente/admin; não derruba a abordagem.
    }
    void audit({
      action: "grupos_painel.abordagem_enviada",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "conversations",
      resourceId: r.conversation_id,
      requestId,
      metadata: { mensagens: r.enviadas },
    });
    return ok(r, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "modelo_nao_encontrado") return fail("not_found", "Resposta rápida não encontrada.", 404, { requestId });
    if (msg === "telefone_invalido") return fail("validation_error", "Telefone inválido.", 400, { requestId });
    if (msg === "session_unavailable")
      return fail("state_conflict", "O número do WhatsApp está desconectado. Reconecte em Conexões.", 409, { requestId });
    logger.error("grupos-painel: falha ao abordar", { requestId, causa: msg });
    return fail("internal_error", "Não foi possível enviar a abordagem agora.", 500, { requestId });
  }
}
