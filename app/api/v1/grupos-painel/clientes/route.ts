/**
 * GET /api/v1/grupos-painel/clientes — a situação de cada telefone conhecido
 *   (comprou / renovou / marcado à mão), para a etiqueta em cima de quem fala
 *   num grupo. Quem não está no mapa é "ainda não é cliente".
 * PUT /api/v1/grupos-painel/clientes — marca à mão a situação de um telefone
 *   (`situacao: null` tira a marcação e volta a valer o que as vendas dizem).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { clientesConhecidos } from "@/lib/grupos-painel/servico";
import { SITUACOES_DO_CLIENTE } from "@/lib/grupos-painel/situacao";
import { chaveDeTelefone } from "@/lib/grupos-painel/telefone";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const marcarSchema = z.object({
  telefone: z.string().trim().min(8).max(30),
  situacao: z.enum(SITUACOES_DO_CLIENTE).nullable(),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  try {
    return ok(await clientesConhecidos(createAdminClient(), authz.org.orgId), { requestId });
  } catch (err) {
    logger.error("grupos-painel: falha ao ler clientes", { requestId, causa: err instanceof Error ? err.message : String(err) });
    return fail("internal_error", "Não foi possível ler os clientes agora.", 500, { requestId });
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;
  const corpo = marcarSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_error", "dados inválidos", 400, { requestId });
  const chave = chaveDeTelefone(corpo.data.telefone);
  if (!chave) return fail("validation_error", "telefone inválido", 400, { requestId });

  const admin = createAdminClient();
  const org = authz.org.orgId;
  const { error } =
    corpo.data.situacao === null
      ? await admin.from("grupos_painel_marcacoes").delete().eq("organization_id", org).eq("telefone_chave", chave)
      : await admin.from("grupos_painel_marcacoes").upsert(
          {
            organization_id: org,
            telefone_chave: chave,
            situacao: corpo.data.situacao,
            marcado_por: authz.user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,telefone_chave" },
        );
  if (error) {
    logger.error("grupos-painel: falha ao marcar cliente", { requestId, causa: error.message });
    return fail("internal_error", "Não foi possível salvar agora.", 500, { requestId });
  }
  void audit({
    action: "grupos_painel.cliente_marcado",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "grupos_painel",
    requestId,
    metadata: { telefone_chave: chave, situacao: corpo.data.situacao },
  });
  return ok({ telefone_chave: chave, situacao: corpo.data.situacao }, { requestId });
}
