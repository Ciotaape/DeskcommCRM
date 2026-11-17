/**
 * POST /api/v1/grupos-painel/sincronizar — lê do WhatsApp os grupos de cada
 * número conectado e tira um retrato novo dos membros dos grupos acompanhados.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ligarEntradaDosGrupos, sincronizarGrupos } from "@/lib/grupos-painel/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  try {
    const admin = createAdminClient();
    const sinc = await sincronizarGrupos(admin, authz.org.orgId);
    // Os grupos acompanhados entram (ou continuam) na aba Grupos › Conversas.
    const entrada = await ligarEntradaDosGrupos(admin, authz.org.orgId, { actorUserId: authz.user.id, requestId }).catch(() => ({
      ligados: 0,
      falhas: -1,
    }));
    const r = { ...sinc, conversas_ligadas: entrada.ligados, conversas_falhas: entrada.falhas };
    void audit({
      action: "grupos_painel.synced",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "grupos_painel",
      requestId,
      metadata: r,
    });
    return ok(r, { requestId });
  } catch (err) {
    logger.warn("grupos-painel: o WhatsApp não respondeu na sincronização", {
      requestId,
      causa: err instanceof Error ? err.message : String(err),
    });
    return fail(
      "channel_unavailable",
      "O WhatsApp não respondeu. Confira se o número está conectado em Conexões e tente de novo.",
      502,
      { requestId },
    );
  }
}
