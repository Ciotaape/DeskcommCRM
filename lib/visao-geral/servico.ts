/**
 * Visão geral (dashboard) — tudo o que a tela mostra, num lugar só.
 *
 * `admin` é service role: TODA consulta filtra `organization_id` vindo da
 * sessão (a página resolve a organização ativa antes de chamar).
 *
 * Recorte: negócios CRIADOS no período (o mesmo recorte do "Status das
 * oportunidades" das ferramentas de mercado). Tarefas e conversas mostram o
 * estado de agora.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerTudo } from "@/lib/grupos-painel/servico";

export interface Periodo {
  de: Date;
  ate: Date;
}

export interface EtapaDoFunil {
  id: string;
  nome: string;
  cor: string | null;
  ganho: boolean;
  perdido: boolean;
  quantidade: number;
  valor_cents: number;
  /** Quantos chegaram nesta etapa ou além (etapas abertas, em ordem). */
  cumulativo_pct: number;
  /** Desta etapa para a próxima. */
  proxima_pct: number | null;
}

export interface VisaoGeral {
  pipelines: Array<{ id: string; nome: string }>;
  pipelineId: string | null;
  status: {
    aberto: { quantidade: number; valor_cents: number };
    ganho: { quantidade: number; valor_cents: number };
    perdido: { quantidade: number; valor_cents: number };
  };
  total: number;
  conversao_pct: number;
  funil: EtapaDoFunil[];
  tarefas: {
    abertas: number;
    atrasadas: number;
    proximas: Array<{ id: string; titulo: string; prazo: string | null; prioridade: string }>;
  };
  atendimento: { privadoAbertas: number; aguardandoResposta: number; grupos: number; contatosNovos: number };
  vendasExternas: {
    quantidade: number;
    valor_cents: number;
    porGrupo: Array<{ codigo: string; quantidade: number; valor_cents: number }>;
  };
  serieDiaria: Array<{ dia: string; criados: number; ganhos: number }>;
}

interface Lead {
  pipeline_id: string;
  stage_id: string;
  status: "open" | "won" | "lost";
  value_cents: number | null;
  created_at: string;
  closed_at: string | null;
}

const FUSO = "America/Sao_Paulo";
const diaLocal = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: FUSO });

export async function visaoGeral(
  admin: SupabaseClient,
  org: string,
  periodo: Periodo,
  pipelinePedido: string | null,
): Promise<VisaoGeral> {
  const de = periodo.de.toISOString();
  const ate = periodo.ate.toISOString();

  const [pipelinesR, leads, tarefasR, atrasadasR, privadoR, aguardandoR, gruposR, contatosR, vendas] = await Promise.all([
    admin
      .from("crm_pipelines")
      .select("id, name, is_default, position")
      .eq("organization_id", org)
      .eq("is_archived", false)
      .order("position"),
    lerTudo<Lead>((a, b) =>
      admin
        .from("crm_leads")
        .select("pipeline_id, stage_id, status, value_cents, created_at, closed_at")
        .eq("organization_id", org)
        .gte("created_at", de)
        .lte("created_at", ate)
        .order("id")
        .range(a, b),
    ),
    admin
      .from("crm_tasks")
      .select("id, title, due_date, priority", { count: "exact" })
      .eq("organization_id", org)
      .in("status", ["pending", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(6),
    admin
      .from("crm_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .in("status", ["pending", "in_progress"])
      .lt("due_date", new Date().toISOString()),
    admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("is_group", false)
      .in("status", ["open", "pending", "claimed", "ai_handling"]),
    admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("is_group", false)
      .in("status", ["open", "pending", "claimed"])
      .gt("unread_count_for_assignee", 0),
    admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("is_group", true),
    admin
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .gte("created_at", de)
      .lte("created_at", ate),
    lerTudo<{ valor_cents: number | null; valor_liquido_cents: number | null; codigo_grupo: string | null }>((a, b) =>
      admin
        .from("vendas_externas")
        .select("valor_cents, valor_liquido_cents, codigo_grupo")
        .eq("organization_id", org)
        .eq("status", "paga")
        .gte("comprado_em", de)
        .lte("comprado_em", ate)
        .order("id")
        .range(a, b),
    ).catch(() => []),
  ]);

  const pipelines = ((pipelinesR.data ?? []) as Array<{ id: string; name: string; is_default: boolean }>).map((p) => ({
    id: p.id,
    nome: p.name,
    padrao: p.is_default,
  }));
  const pipelineFiltro = pipelinePedido && pipelines.some((p) => p.id === pipelinePedido) ? pipelinePedido : null;
  const doFiltro = pipelineFiltro ? leads.filter((l) => l.pipeline_id === pipelineFiltro) : leads;

  const status = {
    aberto: { quantidade: 0, valor_cents: 0 },
    ganho: { quantidade: 0, valor_cents: 0 },
    perdido: { quantidade: 0, valor_cents: 0 },
  };
  for (const l of doFiltro) {
    const s = l.status === "won" ? status.ganho : l.status === "lost" ? status.perdido : status.aberto;
    s.quantidade++;
    s.valor_cents += l.value_cents ?? 0;
  }
  const total = doFiltro.length;

  // Funil: o pipeline escolhido, ou o padrão, ou o primeiro.
  const pipelineDoFunil =
    pipelineFiltro ?? pipelines.find((p) => p.padrao)?.id ?? pipelines[0]?.id ?? null;
  let funil: EtapaDoFunil[] = [];
  if (pipelineDoFunil) {
    const { data: etapas } = await admin
      .from("crm_stages")
      .select("id, name, color, position, is_won, is_lost")
      .eq("organization_id", org)
      .eq("pipeline_id", pipelineDoFunil)
      .eq("is_archived", false)
      .order("position");
    const lista = (etapas ?? []) as Array<{ id: string; name: string; color: string | null; is_won: boolean; is_lost: boolean }>;
    const daPipeline = leads.filter((l) => l.pipeline_id === pipelineDoFunil);
    const porEtapa = new Map<string, { q: number; v: number }>();
    for (const l of daPipeline) {
      const e = porEtapa.get(l.stage_id) ?? { q: 0, v: 0 };
      e.q++;
      e.v += l.value_cents ?? 0;
      porEtapa.set(l.stage_id, e);
    }
    const totalDaPipeline = daPipeline.length;
    // Cumulativo só pelas etapas que não são de perda: quem perdeu saiu do funil.
    const abertas = lista.filter((e) => !e.is_lost);
    const cum = abertas.map((_, i) => abertas.slice(i).reduce((s, e) => s + (porEtapa.get(e.id)?.q ?? 0), 0));
    funil = lista.map((e) => {
      const idx = abertas.findIndex((a) => a.id === e.id);
      const atual = idx >= 0 ? (cum[idx] ?? 0) : 0;
      const prox = idx >= 0 && idx + 1 < cum.length ? (cum[idx + 1] ?? 0) : null;
      return {
        id: e.id,
        nome: e.name,
        cor: e.color,
        ganho: e.is_won,
        perdido: e.is_lost,
        quantidade: porEtapa.get(e.id)?.q ?? 0,
        valor_cents: porEtapa.get(e.id)?.v ?? 0,
        cumulativo_pct: idx >= 0 && totalDaPipeline > 0 ? (atual / totalDaPipeline) * 100 : 0,
        proxima_pct: prox !== null && atual > 0 ? (prox / atual) * 100 : null,
      };
    });
  }

  // Série diária: criados x ganhos.
  const dias = new Map<string, { criados: number; ganhos: number }>();
  for (let t = periodo.de.getTime(); t <= periodo.ate.getTime(); t += 86_400_000) {
    dias.set(diaLocal(new Date(t).toISOString()), { criados: 0, ganhos: 0 });
  }
  for (const l of doFiltro) {
    const d = dias.get(diaLocal(l.created_at));
    if (d) d.criados++;
    if (l.status === "won" && l.closed_at) {
      const g = dias.get(diaLocal(l.closed_at));
      if (g) g.ganhos++;
    }
  }

  const porGrupo = new Map<string, { quantidade: number; valor_cents: number }>();
  let valorVendas = 0;
  for (const v of vendas) {
    const valor = v.valor_liquido_cents ?? v.valor_cents ?? 0;
    valorVendas += valor;
    const codigo = v.codigo_grupo ?? "sem grupo";
    const g = porGrupo.get(codigo) ?? { quantidade: 0, valor_cents: 0 };
    g.quantidade++;
    g.valor_cents += valor;
    porGrupo.set(codigo, g);
  }

  return {
    pipelines: pipelines.map(({ id, nome }) => ({ id, nome })),
    pipelineId: pipelineFiltro,
    status,
    total,
    conversao_pct: total > 0 ? (status.ganho.quantidade / total) * 100 : 0,
    funil,
    tarefas: {
      abertas: tarefasR.count ?? 0,
      atrasadas: atrasadasR.count ?? 0,
      proximas: ((tarefasR.data ?? []) as Array<{ id: string; title: string; due_date: string | null; priority: string }>).map(
        (t) => ({ id: t.id, titulo: t.title, prazo: t.due_date, prioridade: t.priority }),
      ),
    },
    atendimento: {
      privadoAbertas: privadoR.count ?? 0,
      aguardandoResposta: aguardandoR.count ?? 0,
      grupos: gruposR.count ?? 0,
      contatosNovos: contatosR.count ?? 0,
    },
    vendasExternas: {
      quantidade: vendas.length,
      valor_cents: valorVendas,
      porGrupo: [...porGrupo.entries()]
        .map(([codigo, g]) => ({ codigo, ...g }))
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 11),
    },
    serieDiaria: [...dias.entries()].map(([dia, v]) => ({ dia, ...v })),
  };
}

/** Período da URL (`de`/`ate` em AAAA-MM-DD, horário de Brasília); padrão: mês atual. */
export function periodoDaUrl(de?: string, ate?: string, agora = new Date()): Periodo & { deTexto: string; ateTexto: string } {
  const valida = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const hoje = diaLocal(agora.toISOString());
  const inicioDoMes = `${hoje.slice(0, 8)}01`;
  let deTexto = valida(de) ?? inicioDoMes;
  let ateTexto = valida(ate) ?? hoje;
  if (deTexto > ateTexto) [deTexto, ateTexto] = [ateTexto, deTexto];
  // Teto de um ano: a série diária tem um ponto por dia.
  const limite = new Date(new Date(`${ateTexto}T12:00:00-03:00`).getTime() - 365 * 86_400_000);
  if (new Date(`${deTexto}T12:00:00-03:00`) < limite) deTexto = diaLocal(limite.toISOString());
  return {
    de: new Date(`${deTexto}T00:00:00-03:00`),
    ate: new Date(`${ateTexto}T23:59:59.999-03:00`),
    deTexto,
    ateTexto,
  };
}
