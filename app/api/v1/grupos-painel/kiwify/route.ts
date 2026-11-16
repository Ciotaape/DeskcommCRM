/**
 * GET  /api/v1/grupos-painel/kiwify — a URL do webhook da Kiwify desta organização (se já existe).
 * POST /api/v1/grupos-painel/kiwify — cria (ou recria) a URL, com o token de assinatura opcional.
 *
 * Só administrador: a URL é o segredo que deixa alguém gravar venda aqui.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function urlDoWebhook(segredo: string): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  return `${base}/api/v1/webhooks/kiwify/${segredo}`;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "vendas_externas_fontes" });
  if (!authz.ok) return authz.response;
  const { data } = await createAdminClient()
    .from("vendas_externas_fontes")
    .select("segredo_caminho, token_assinatura, created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("plataforma", "kiwify")
    .maybeSingle();
  if (!data) return ok({ conectada: false }, { requestId });
  return ok(
    {
      conectada: true,
      url: urlDoWebhook(data.segredo_caminho as string),
      comToken: !!data.token_assinatura,
      criadaEm: data.created_at,
    },
    { requestId },
  );
}

const corpoSchema = z.object({ token_assinatura: z.string().trim().max(200).nullable().optional() });

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "vendas_externas_fontes" });
  if (!authz.ok) return authz.response;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!corpo.success) return fail("validation_error", "dados inválidos", 400, { requestId });
  const segredo = randomBytes(24).toString("hex");
  const { error } = await createAdminClient()
    .from("vendas_externas_fontes")
    .upsert(
      {
        organization_id: authz.org.orgId,
        plataforma: "kiwify",
        segredo_caminho: segredo,
        token_assinatura: corpo.data.token_assinatura || null,
      },
      { onConflict: "organization_id,plataforma" },
    );
  if (error) return fail("internal_error", "Não foi possível criar a conexão agora.", 500, { requestId });
  void audit({
    action: "grupos_painel.kiwify_conectada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "vendas_externas_fontes",
    requestId,
    metadata: { com_token: !!corpo.data.token_assinatura },
  });
  return ok({ conectada: true, url: urlDoWebhook(segredo), comToken: !!corpo.data.token_assinatura }, { requestId, status: 201 });
}
