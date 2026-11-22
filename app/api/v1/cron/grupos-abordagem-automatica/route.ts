/**
 * O CRON DA ABORDAGEM AUTOMÁTICA (aba Grupos › Abordagem › Automática).
 *
 * Roda por minuto. Para cada organização com o robô ligado, faz NO MÁXIMO uma
 * abordagem (`rodadaDaOrg`): horário, limite do dia e espaçamento aleatório
 * decidem se é a hora; a pessoa é quem mais fala nos grupos e ainda não foi
 * chamada. Audita só quando abordou alguém.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodadaDaOrg } from "@/lib/grupos-painel/abordagem-automatica";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });

  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id")
    .eq("settings->grupos_abordagem_auto->>ativo", "true");
  if (error) return fail("internal_error", "Erro ao ler as organizações.", 500, { requestId });

  const paradas = new Set(await idsDeOrgsParadas(admin));
  const resumo: Record<string, string> = {};
  for (const { id } of (orgs ?? []) as Array<{ id: string }>) {
    if (paradas.has(id)) continue;
    const r = await rodadaDaOrg(admin, id, new Date(), requestId);
    resumo[id] = r.acao;
    if (r.acao === "abordou") {
      void audit({
        action: "grupos_painel.abordagem_automatica",
        organizationId: id,
        actorUserId: null,
        resourceType: "conversations",
        resourceId: r.conversation_id,
        requestId,
        metadata: { questionario: r.questionario },
      });
    } else if (r.acao === "falhou") {
      logger.warn("abordagem-automatica: rodada falhou", { requestId, organizationId: id, motivo: r.motivo });
    }
  }
  return ok(resumo, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
