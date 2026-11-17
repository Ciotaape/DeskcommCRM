import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { periodoDaUrl, visaoGeral } from "@/lib/visao-geral/servico";
import { VisaoGeralClient } from "./_components/VisaoGeralClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Visão geral" };

/**
 * Dashboard: oportunidades (status, valor, conversão), funil por etapa,
 * tarefas, atendimento e vendas da Kiwify, num período escolhido.
 * A organização vem da sessão; o admin client só lê o que é dela.
 */
export default async function VisaoGeralPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; pipeline?: string }>;
}) {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const sp = await searchParams;
  const periodo = periodoDaUrl(sp.de, sp.ate);
  const dados = await visaoGeral(createAdminClient(), org.orgId, periodo, sp.pipeline ?? null);
  return <VisaoGeralClient dados={dados} de={periodo.deTexto} ate={periodo.ateTexto} />;
}
