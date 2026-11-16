/**
 * POST /api/v1/grupos-painel/vendas/importar — planilha "Vendas → Exportar" da
 * Kiwify (CSV ou XLSX, campo `file`). Reimportar a mesma planilha não duplica:
 * a venda é única pelo ID da Kiwify.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { vendaDaPlanilha } from "@/lib/grupos-painel/kiwify";
import { gravarVendas } from "@/lib/grupos-painel/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { parseImportFile } from "@/lib/planilha/ler-arquivo";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "grupos_painel" });
  if (!authz.ok) return authz.response;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("validation_error", "Envie a planilha no campo file.", 400, { requestId });
  const leitura = await parseImportFile(await file.arrayBuffer(), file.name, { maxLinhas: 50_000 });
  if (!leitura.ok) return fail("validation_error", leitura.error, 400, { requestId });

  const { headers, rows } = leitura.sheet;
  if (!headers.includes("ID da venda")) {
    return fail("validation_error", "Essa não parece a planilha de vendas da Kiwify (falta a coluna “ID da venda”).", 400, { requestId });
  }
  const vendas = rows
    .map((r) => vendaDaPlanilha(Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))))
    .filter((v): v is NonNullable<typeof v> => v !== null);
  try {
    const gravadas = await gravarVendas(createAdminClient(), authz.org.orgId, vendas);
    void audit({
      action: "grupos_painel.vendas_importadas",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "vendas_externas",
      requestId,
      metadata: { linhas: rows.length, gravadas },
    });
    return ok({ linhas: rows.length, gravadas }, { requestId });
  } catch (err) {
    logger.error("grupos-painel: falha na importação", { requestId, causa: err instanceof Error ? err.message : String(err) });
    return fail("internal_error", "Não foi possível gravar as vendas agora.", 500, { requestId });
  }
}
