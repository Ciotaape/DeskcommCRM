/**
 * Painel de Grupos — sincronização dos membros (WAHA) e os números por grupo.
 *
 * `admin` é service role: TODA consulta filtra `organization_id`, que vem da
 * sessão autenticada de quem chama, nunca do corpo.
 *
 * Contas:
 * - Comprou pelo link: venda paga com `codigo_grupo` = código do grupo (`?src=`).
 * - Comprou e está no grupo: venda paga cujo telefone cruza com um membro.
 * - Compradores do grupo: a UNIÃO dos dois, sem contar a mesma venda duas vezes.
 * - Conversão: membros que compraram ÷ membros com telefone conhecido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef } from "@/lib/channels/session-ref";
import type { ChannelSessionRef } from "@/lib/channels/session-ref";
import { getWahaClient } from "@/lib/waha/client";
import { chaveDeTelefone } from "./telefone";

export interface ResumoDoGrupo {
  id: string;
  channelSessionId: string;
  groupChatId: string;
  subject: string | null;
  acompanhar: boolean;
  codigoOrigem: string | null;
  souAdmin: boolean | null;
  membrosTotal: number | null;
  membrosComTelefone: number;
  sincronizadoEm: string | null;
  vendasPeloLink: number;
  membrosQueCompraram: number;
  compradores: number;
  faturamentoCents: number;
  faturamentoLiquidoCents: number;
  conversao: number | null;
}

export interface ResumoGeral {
  grupos: ResumoDoGrupo[];
  vendasTotais: number;
  vendasSemGrupo: number;
  faturamentoTotalCents: number;
  ultimaVendaEm: string | null;
}

interface LinhaGrupo {
  id: string;
  channel_session_id: string;
  group_chat_id: string;
  subject: string | null;
  acompanhar: boolean;
  codigo_origem: string | null;
  sou_admin: boolean | null;
  membros_total: number | null;
  sincronizado_em: string | null;
}

interface LinhaVenda {
  id: string;
  status: string;
  produto: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  telefone_chave: string | null;
  valor_cents: number | null;
  valor_liquido_cents: number | null;
  codigo_grupo: string | null;
  comprado_em: string | null;
}

const PAGINA = 1000;

/** Lê tudo de uma consulta paginada (o PostgREST corta em 1.000 linhas). */
async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw error;
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return todas;
}

async function vendasPagas(admin: SupabaseClient, org: string): Promise<LinhaVenda[]> {
  return lerTudo<LinhaVenda>((de, ate) =>
    admin
      .from("vendas_externas")
      .select("id, status, produto, cliente_nome, cliente_telefone, telefone_chave, valor_cents, valor_liquido_cents, codigo_grupo, comprado_em")
      .eq("organization_id", org)
      .eq("status", "paga")
      .order("id")
      .range(de, ate),
  );
}

/** Puxa do WhatsApp os grupos de cada número conectado e grava os membros dos grupos acompanhados. */
export async function sincronizarGrupos(
  admin: SupabaseClient,
  org: string,
  opts: { soGrupoId?: string } = {},
): Promise<{ grupos: number; membros: number; numeros: number }> {
  const client = getWahaClient();
  if (!client) throw new Error("waha_not_configured");
  const { data: sessoes, error } = await admin
    .from("channel_sessions")
    .select(`id, status, phone_number, ${CHANNEL_SESSION_REF_COLUMNS}`)
    .eq("organization_id", org);
  if (error) throw error;
  const doWaha = (sessoes ?? []).filter(
    (s) => (s as { provider?: string }).provider === "waha" && (s as { status?: string }).status === "WORKING",
  );
  let totalGrupos = 0;
  let totalMembros = 0;
  const agora = new Date().toISOString();

  for (const s of doWaha) {
    const sessao = s as unknown as ChannelSessionRef & { id: string; phone_number: string | null };
    const meuNumero = chaveDeTelefone(sessao.phone_number);
    const grupos = await client.listarGruposComMembros(resolveSessionRef(sessao));
    totalGrupos += grupos.length;

    const { data: gravados } = await admin
      .from("grupos_painel")
      .select("id, group_chat_id, acompanhar")
      .eq("organization_id", org)
      .eq("channel_session_id", sessao.id);
    const porChat = new Map((gravados ?? []).map((g) => [g.group_chat_id as string, g as { id: string; acompanhar: boolean }]));

    for (const g of grupos) {
      const eu = meuNumero ? g.participantes.find((p) => chaveDeTelefone(p.telefone) === meuNumero) : undefined;
      const { data: linha, error: errUpsert } = await admin
        .from("grupos_painel")
        .upsert(
          {
            organization_id: org,
            channel_session_id: sessao.id,
            group_chat_id: g.chatId,
            subject: g.subject,
            membros_total: g.participantes.length,
            sou_admin: eu ? eu.admin : null,
            sincronizado_em: agora,
            updated_at: agora,
          },
          { onConflict: "organization_id,channel_session_id,group_chat_id" },
        )
        .select("id, acompanhar")
        .single();
      if (errUpsert) throw errUpsert;
      const grupoId = (linha as { id: string }).id;
      const acompanhar = (linha as { acompanhar: boolean }).acompanhar || porChat.get(g.chatId)?.acompanhar === true;
      if (!acompanhar) continue;
      if (opts.soGrupoId && opts.soGrupoId !== grupoId) continue;

      // Retrato novo: troca a lista inteira do grupo.
      await admin.from("grupos_painel_membros").delete().eq("organization_id", org).eq("grupo_id", grupoId);
      const linhas = g.participantes.map((p) => ({
        organization_id: org,
        grupo_id: grupoId,
        participante_id: p.id,
        telefone: p.telefone,
        telefone_chave: chaveDeTelefone(p.telefone),
        admin: p.admin,
        visto_em: agora,
      }));
      for (let i = 0; i < linhas.length; i += 500) {
        const { error: errIns } = await admin
          .from("grupos_painel_membros")
          .upsert(linhas.slice(i, i + 500), { onConflict: "grupo_id,participante_id" });
        if (errIns) throw errIns;
      }
      totalMembros += linhas.length;
    }
  }
  return { grupos: totalGrupos, membros: totalMembros, numeros: doWaha.length };
}

/** Grava vendas (upsert idempotente pelo id do pedido). Reembolso que chega depois troca o status. */
export async function gravarVendas(
  admin: SupabaseClient,
  org: string,
  vendas: Array<import("./kiwify").VendaNormalizada & { payload?: unknown }>,
): Promise<number> {
  let gravadas = 0;
  const agora = new Date().toISOString();
  for (let i = 0; i < vendas.length; i += 500) {
    const lote = vendas.slice(i, i + 500).map((v) => ({
      organization_id: org,
      plataforma: "kiwify",
      ...v,
      payload: v.payload ?? null,
      updated_at: agora,
    }));
    const { error, count } = await admin
      .from("vendas_externas")
      .upsert(lote, { onConflict: "organization_id,plataforma,id_externo", count: "exact" });
    if (error) throw error;
    gravadas += count ?? lote.length;
  }
  return gravadas;
}

export async function resumoDosGrupos(admin: SupabaseClient, org: string): Promise<ResumoGeral> {
  const [{ data: grupos, error }, vendas] = await Promise.all([
    admin
      .from("grupos_painel")
      .select("id, channel_session_id, group_chat_id, subject, acompanhar, codigo_origem, sou_admin, membros_total, sincronizado_em")
      .eq("organization_id", org)
      .order("subject"),
    vendasPagas(admin, org),
  ]);
  if (error) throw error;
  const lista = (grupos ?? []) as LinhaGrupo[];
  const acompanhados = lista.filter((g) => g.acompanhar).map((g) => g.id);

  const membros = acompanhados.length
    ? await lerTudo<{ grupo_id: string; telefone_chave: string | null }>((de, ate) =>
        admin
          .from("grupos_painel_membros")
          .select("grupo_id, telefone_chave")
          .eq("organization_id", org)
          .in("grupo_id", acompanhados)
          .order("id")
          .range(de, ate),
      )
    : [];
  const chavesPorGrupo = new Map<string, Set<string>>();
  for (const m of membros) {
    if (!m.telefone_chave) continue;
    let s = chavesPorGrupo.get(m.grupo_id);
    if (!s) chavesPorGrupo.set(m.grupo_id, (s = new Set()));
    s.add(m.telefone_chave);
  }

  const codigos = new Set(lista.map((g) => g.codigo_origem).filter((c): c is string => !!c));
  const resumo: ResumoDoGrupo[] = lista.map((g) => {
    const chaves = chavesPorGrupo.get(g.id) ?? new Set<string>();
    const doGrupo = new Map<string, LinhaVenda>();
    let pelasChaves = 0;
    let peloLink = 0;
    const clientesNoGrupo = new Set<string>();
    for (const v of vendas) {
      const viaLink = !!g.codigo_origem && v.codigo_grupo === g.codigo_origem;
      const viaMembro = !!v.telefone_chave && chaves.has(v.telefone_chave);
      if (viaLink) peloLink++;
      if (viaMembro && v.telefone_chave && !clientesNoGrupo.has(v.telefone_chave)) {
        clientesNoGrupo.add(v.telefone_chave);
        pelasChaves++;
      }
      if (viaLink || viaMembro) doGrupo.set(v.id, v);
    }
    const valores = [...doGrupo.values()];
    return {
      id: g.id,
      channelSessionId: g.channel_session_id,
      groupChatId: g.group_chat_id,
      subject: g.subject,
      acompanhar: g.acompanhar,
      codigoOrigem: g.codigo_origem,
      souAdmin: g.sou_admin,
      membrosTotal: g.membros_total,
      membrosComTelefone: chaves.size,
      sincronizadoEm: g.sincronizado_em,
      vendasPeloLink: peloLink,
      membrosQueCompraram: pelasChaves,
      compradores: valores.length,
      faturamentoCents: valores.reduce((a, v) => a + (v.valor_cents ?? 0), 0),
      faturamentoLiquidoCents: valores.reduce((a, v) => a + (v.valor_liquido_cents ?? 0), 0),
      conversao: chaves.size > 0 ? pelasChaves / chaves.size : null,
    };
  });

  const datas = vendas.map((v) => v.comprado_em).filter((d): d is string => !!d).sort();
  return {
    grupos: resumo,
    vendasTotais: vendas.length,
    vendasSemGrupo: vendas.filter((v) => !v.codigo_grupo || !codigos.has(v.codigo_grupo)).length,
    faturamentoTotalCents: vendas.reduce((a, v) => a + (v.valor_cents ?? 0), 0),
    ultimaVendaEm: datas.at(-1) ?? null,
  };
}

export interface MembroDetalhado {
  telefone: string | null;
  admin: boolean;
  comprou: boolean;
  compras: number;
  ultimaCompraEm: string | null;
  nome: string | null;
  valorCents: number;
}

export interface DetalheDoGrupo {
  grupo: Pick<ResumoDoGrupo, "id" | "subject" | "codigoOrigem" | "membrosTotal" | "sincronizadoEm" | "acompanhar">;
  membros: MembroDetalhado[];
  compradoresForaDoGrupo: Array<{ nome: string | null; telefone: string | null; compradoEm: string | null; valorCents: number }>;
}

export async function detalheDoGrupo(admin: SupabaseClient, org: string, grupoId: string): Promise<DetalheDoGrupo | null> {
  const { data: g } = await admin
    .from("grupos_painel")
    .select("id, subject, codigo_origem, membros_total, sincronizado_em, acompanhar")
    .eq("organization_id", org)
    .eq("id", grupoId)
    .maybeSingle();
  if (!g) return null;
  const grupo = g as { id: string; subject: string | null; codigo_origem: string | null; membros_total: number | null; sincronizado_em: string | null; acompanhar: boolean };
  const [membros, vendas] = await Promise.all([
    lerTudo<{ telefone: string | null; telefone_chave: string | null; admin: boolean }>((de, ate) =>
      admin
        .from("grupos_painel_membros")
        .select("telefone, telefone_chave, admin")
        .eq("organization_id", org)
        .eq("grupo_id", grupoId)
        .order("id")
        .range(de, ate),
    ),
    vendasPagas(admin, org),
  ]);
  const porChave = new Map<string, LinhaVenda[]>();
  for (const v of vendas) {
    if (!v.telefone_chave) continue;
    const l = porChave.get(v.telefone_chave) ?? [];
    l.push(v);
    porChave.set(v.telefone_chave, l);
  }
  const chavesDoGrupo = new Set<string>();
  const detalhados: MembroDetalhado[] = membros.map((m) => {
    if (m.telefone_chave) chavesDoGrupo.add(m.telefone_chave);
    const compras = (m.telefone_chave && porChave.get(m.telefone_chave)) || [];
    const datas = compras.map((c) => c.comprado_em).filter((d): d is string => !!d).sort();
    return {
      telefone: m.telefone,
      admin: m.admin,
      comprou: compras.length > 0,
      compras: compras.length,
      ultimaCompraEm: datas.at(-1) ?? null,
      nome: compras[0]?.cliente_nome ?? null,
      valorCents: compras.reduce((a, c) => a + (c.valor_cents ?? 0), 0),
    };
  });
  detalhados.sort((a, b) => Number(b.comprou) - Number(a.comprou) || (b.ultimaCompraEm ?? "").localeCompare(a.ultimaCompraEm ?? ""));
  const fora = grupo.codigo_origem
    ? vendas
        .filter((v) => v.codigo_grupo === grupo.codigo_origem && !(v.telefone_chave && chavesDoGrupo.has(v.telefone_chave)))
        .map((v) => ({ nome: v.cliente_nome, telefone: v.cliente_telefone, compradoEm: v.comprado_em, valorCents: v.valor_cents ?? 0 }))
        .sort((a, b) => (b.compradoEm ?? "").localeCompare(a.compradoEm ?? ""))
    : [];
  return {
    grupo: {
      id: grupo.id,
      subject: grupo.subject,
      codigoOrigem: grupo.codigo_origem,
      membrosTotal: grupo.membros_total,
      sincronizadoEm: grupo.sincronizado_em,
      acompanhar: grupo.acompanhar,
    },
    membros: detalhados,
    compradoresForaDoGrupo: fora,
  };
}
