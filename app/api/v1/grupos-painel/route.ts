/**
 * GET /api/v1/grupos-painel — os grupos do WhatsApp com membros, vendas e conversão.
 * Gerente ou administrador: são números de venda da empresa inteira.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { resumoDosGrupos } from "@/lib/grupos-painel/servico";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  try {
    const resumo = await resumoDosGrupos(createAdminClient(), authz.org.orgId);
    return ok(resumo, { requestId });
  } catch (err) {
    logger.error("grupos-painel: falha ao montar o resumo", { requestId, causa: err instanceof Error ? err.message : String(err) });
    return fail("internal_error", "Não foi possível carregar os grupos agora.", 500, { requestId });
  }
}
