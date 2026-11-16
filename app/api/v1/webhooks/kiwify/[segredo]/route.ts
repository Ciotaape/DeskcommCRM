/**
 * POST /api/v1/webhooks/kiwify/[segredo] — a Kiwify avisa venda aprovada,
 * reembolso, chargeback e renovação.
 *
 * Quem é a organização: o SEGREDO DO CAMINHO (gerado no painel), nunca o corpo.
 * Se a organização cadastrou o token da Kiwify, a assinatura (`?signature=`,
 * HMAC-SHA1 do corpo cru com o token) também é conferida.
 *
 * Responde 200 para evento que não é venda: a Kiwify reenvia o que receber
 * erro, e um evento que nós ignoramos de propósito não é erro.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { vendaDoWebhook } from "@/lib/grupos-painel/kiwify";
import { gravarVendas } from "@/lib/grupos-painel/servico";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function assinaturaConfere(corpoCru: string, token: string, recebida: string | null): boolean {
  if (!recebida) return false;
  const esperada = createHmac("sha1", token).update(corpoCru).digest("hex");
  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(recebida.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ segredo: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { segredo } = await ctx.params;
  if (!/^[0-9a-f]{32,128}$/.test(segredo)) return fail("not_found", "não encontrado", 404, { requestId });

  const admin = createAdminClient();
  const { data: fonte } = await admin
    .from("vendas_externas_fontes")
    .select("organization_id, token_assinatura")
    .eq("segredo_caminho", segredo)
    .eq("plataforma", "kiwify")
    .maybeSingle();
  if (!fonte) return fail("not_found", "não encontrado", 404, { requestId });

  const corpoCru = await req.text();
  if (fonte.token_assinatura) {
    const assinatura = req.nextUrl.searchParams.get("signature");
    if (!assinaturaConfere(corpoCru, fonte.token_assinatura as string, assinatura)) {
      logger.warn("kiwify: assinatura não confere", { requestId });
      return fail("unauthorized", "assinatura inválida", 401, { requestId });
    }
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch {
    return fail("validation_error", "JSON inválido", 400, { requestId });
  }
  const venda = vendaDoWebhook(corpo);
  if (!venda) return ok({ ignorado: true }, { requestId });

  const org = fonte.organization_id as string;
  try {
    await gravarVendas(admin, org, [{ ...venda, payload: corpo }]);
  } catch (err) {
    logger.error("kiwify: falha ao gravar a venda", { requestId, causa: err instanceof Error ? err.message : String(err) });
    return fail("internal_error", "falha ao gravar", 500, { requestId });
  }
  void audit({
    action: "grupos_painel.venda_recebida",
    organizationId: org,
    resourceType: "vendas_externas",
    requestId,
    metadata: { id_externo: venda.id_externo, status: venda.status, codigo_grupo: venda.codigo_grupo },
  });
  return ok({ recebido: true }, { requestId });
}
