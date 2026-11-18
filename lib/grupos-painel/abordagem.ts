/**
 * Grupos › Abordagem — chamar no privado quem está nos grupos e ainda não comprou.
 *
 * Não é disparo: a lista mostra as pessoas e quem atende clica em "Abordar" em
 * UMA de cada vez. O clique abre (ou reabre) a conversa no privado pelo mesmo
 * número do grupo, manda a resposta rápida escolhida (texto com {{primeiro_nome}}
 * e as imagens/áudio dela) pelo MESMO caminho do Inbox, e a partir daí a
 * conversa é de quem clicou — nada mais sai sozinho.
 *
 * `admin` é service role: toda consulta filtra `organization_id` vindo da sessão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { openSharedContactConversation } from "@/lib/messaging/open-shared-contact-conversation";
import { lerRemetenteDeGrupo } from "@/lib/messaging/remetente-de-grupo";
import { BUCKET_DAS_MIDIAS, type MidiaDeTemplate } from "@/lib/templates/midias";
import { clientesConhecidos, lerTudo } from "./servico";
import { chaveDeTelefone } from "./telefone";

export interface PessoaParaAbordar {
  telefone: string;
  telefone_chave: string;
  nome: string | null;
  grupos: string[];
  mensagens_no_grupo: number;
  ultima_mensagem: string | null;
  abordado_em: string | null;
}

const JANELA_DE_MENSAGENS_DIAS = 120;

/**
 * Quem está nos grupos acompanhados, não é admin do grupo e não comprou
 * (nem foi marcado à mão como cliente). O nome vem do que a pessoa escreveu no
 * grupo — quem nunca falou aparece só com o número.
 */
export async function pessoasParaAbordar(admin: SupabaseClient, org: string): Promise<PessoaParaAbordar[]> {
  const { data: grupos, error } = await admin
    .from("grupos_painel")
    .select("id, subject, group_chat_id")
    .eq("organization_id", org)
    .eq("acompanhar", true);
  if (error) throw error;
  const listaDeGrupos = (grupos ?? []) as Array<{ id: string; subject: string | null; group_chat_id: string }>;
  if (listaDeGrupos.length === 0) return [];
  const nomeDoGrupo = new Map(listaDeGrupos.map((g) => [g.id, g.subject ?? "Grupo"]));

  const membros = await lerTudo<{ grupo_id: string; telefone: string; telefone_chave: string; admin: boolean }>((a, b) =>
    admin
      .from("grupos_painel_membros")
      .select("grupo_id, telefone, telefone_chave, admin")
      .eq("organization_id", org)
      .in(
        "grupo_id",
        listaDeGrupos.map((g) => g.id),
      )
      .order("id")
      .range(a, b),
  );

  const [clientes, abordagens, falas] = await Promise.all([
    clientesConhecidos(admin, org),
    lerTudo<{ telefone_chave: string; abordado_em: string }>((a, b) =>
      admin
        .from("grupos_abordagens")
        .select("telefone_chave, abordado_em")
        .eq("organization_id", org)
        .order("id")
        .range(a, b),
    ),
    falasNosGrupos(
      admin,
      org,
      listaDeGrupos.map((g) => g.group_chat_id),
    ),
  ]);
  const abordadoEm = new Map(abordagens.map((x) => [x.telefone_chave, x.abordado_em]));

  const pessoas = new Map<string, PessoaParaAbordar & { ehAdmin: boolean }>();
  for (const m of membros) {
    if (!m.telefone_chave) continue;
    const p =
      pessoas.get(m.telefone_chave) ??
      ({
        telefone: m.telefone,
        telefone_chave: m.telefone_chave,
        nome: null,
        grupos: [],
        mensagens_no_grupo: 0,
        ultima_mensagem: null,
        abordado_em: abordadoEm.get(m.telefone_chave) ?? null,
        ehAdmin: false,
      } satisfies PessoaParaAbordar & { ehAdmin: boolean });
    p.grupos.push(nomeDoGrupo.get(m.grupo_id) ?? "Grupo");
    if (m.admin) p.ehAdmin = true;
    pessoas.set(m.telefone_chave, p);
  }

  const lista: PessoaParaAbordar[] = [];
  for (const p of pessoas.values()) {
    if (p.ehAdmin) continue;
    const situacao = clientes[p.telefone_chave]?.situacao;
    if (situacao === "comprou" || situacao === "renovou") continue;
    const fala = falas.get(p.telefone_chave);
    if (fala) {
      p.nome = fala.nome;
      p.mensagens_no_grupo = fala.quantidade;
      p.ultima_mensagem = fala.ultima;
    }
    const { ehAdmin: _ignorado, ...semAdmin } = p;
    lista.push(semAdmin);
  }
  // Quem fala no grupo primeiro, e quem falou mais recentemente antes.
  return lista.sort((a, b) => (b.ultima_mensagem ?? "").localeCompare(a.ultima_mensagem ?? "") || b.mensagens_no_grupo - a.mensagens_no_grupo);
}

/** Nome, quantidade e última mensagem de cada participante nos grupos, pelos últimos meses. */
async function falasNosGrupos(
  admin: SupabaseClient,
  org: string,
  groupChatIds: string[],
): Promise<Map<string, { nome: string | null; quantidade: number; ultima: string }>> {
  const { data: conversas } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", org)
    .eq("is_group", true)
    .in("group_chat_id", groupChatIds);
  const ids = ((conversas ?? []) as Array<{ id: string }>).map((c) => c.id);
  const mapa = new Map<string, { nome: string | null; quantidade: number; ultima: string }>();
  if (ids.length === 0) return mapa;
  const desde = new Date(Date.now() - JANELA_DE_MENSAGENS_DIAS * 86_400_000).toISOString();
  const msgs = await lerTudo<{ metadata: unknown; created_at: string }>((a, b) =>
    admin
      .from("messages")
      .select("metadata, created_at")
      .eq("organization_id", org)
      .eq("direction", "inbound")
      .in("conversation_id", ids)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .range(a, b),
  ).catch(() => []);
  for (const m of msgs) {
    const r = lerRemetenteDeGrupo(m.metadata);
    const chave = chaveDeTelefone(r?.phone ?? null);
    if (!chave) continue;
    const atual = mapa.get(chave);
    if (atual) {
      atual.quantidade++;
      if (!atual.nome && r?.name) atual.nome = r.name;
    } else {
      // A lista vem da mais nova para a mais antiga: a primeira vista é a última fala.
      mapa.set(chave, { nome: r?.name ?? null, quantidade: 1, ultima: m.created_at });
    }
  }
  return mapa;
}

export interface ResultadoDaAbordagem {
  conversation_id: string;
  contact_id: string;
  enviadas: number;
}

/**
 * Abre o privado e manda a resposta rápida: primeiro o texto, depois cada mídia
 * na ordem dela. O ator é quem clicou — o envio é dele, como se tivesse
 * digitado no Inbox. Registra a abordagem para a pessoa sair da lista.
 */
export async function abordar(
  admin: SupabaseClient,
  org: string,
  e: { userId: string; requestId: string; telefone: string; nome: string | null; templateId: string | null },
): Promise<ResultadoDaAbordagem> {
  const chave = chaveDeTelefone(e.telefone);
  if (!chave) throw new Error("telefone_invalido");

  // Uma abordagem por pessoa: o segundo clique não manda a mensagem de novo.
  const { data: ja } = await admin
    .from("grupos_abordagens")
    .select("abordado_em, conversation_id")
    .eq("organization_id", org)
    .eq("telefone_chave", chave)
    .maybeSingle();
  if (ja) throw Object.assign(new Error("ja_abordado"), { detalhe: ja });

  // Sem modelo escolhido, vale a resposta rápida compartilhada cujo título
  // começa com "Abordagem" (a mensagem padrão da abordagem).
  let consulta = admin.from("message_templates").select("id, body, midias").eq("organization_id", org);
  consulta = e.templateId
    ? consulta.eq("id", e.templateId)
    : consulta.ilike("title", "abordagem%").is("owner_user_id", null).order("created_at", { ascending: true }).limit(1);
  const { data: tpl } = await consulta.maybeSingle();
  if (!tpl) throw new Error("modelo_nao_encontrado");
  const modelo = tpl as { id: string; body: string; midias: MidiaDeTemplate[] | null };

  // O número que fala é o mesmo do grupo onde a pessoa está.
  const { data: membro } = await admin
    .from("grupos_painel_membros")
    .select("grupo_id, grupos_painel!inner(channel_session_id)")
    .eq("organization_id", org)
    .eq("telefone_chave", chave)
    .limit(1)
    .maybeSingle();
  const sessao = (membro as { grupos_painel?: { channel_session_id?: string } } | null)?.grupos_painel?.channel_session_id;

  const telefone = `+${e.telefone.replace(/\D/g, "")}`;
  const aberta = await openSharedContactConversation(admin, org, {
    phone_number: telefone,
    ...(e.nome ? { name: e.nome } : {}),
    ...(sessao ? { channel_session_id: sessao } : {}),
  });

  const ctx = { organization_id: org, actor: { type: "user" as const, id: e.userId }, requestId: e.requestId };
  let enviadas = 0;
  const texto = interpolateTemplate(modelo.body, { name: e.nome }).trim();
  if (texto) {
    await sendMessageHandler(admin, ctx, {
      conversation_id: aberta.conversation_id,
      type: "text",
      body: texto,
      metadata: { source: "grupos_abordagem" },
    });
    enviadas++;
  }
  for (const midia of modelo.midias ?? []) {
    const { data } = await admin.storage.from(BUCKET_DAS_MIDIAS).createSignedUrl(midia.storage_path, 60 * 60 * 24);
    if (!data?.signedUrl) continue;
    await sendMessageHandler(admin, ctx, {
      conversation_id: aberta.conversation_id,
      type: midia.media_mime.startsWith("audio/") ? "audio" : midia.media_mime.startsWith("video/") ? "video" : "image",
      media_url: data.signedUrl,
      metadata: { source: "grupos_abordagem", media_mime: midia.media_mime },
    });
    enviadas++;
  }

  await admin.from("grupos_abordagens").upsert(
    {
      organization_id: org,
      telefone_chave: chave,
      contact_id: aberta.contact_id,
      conversation_id: aberta.conversation_id,
      template_id: modelo.id,
      abordado_por: e.userId,
      abordado_em: new Date().toISOString(),
    },
    { onConflict: "organization_id,telefone_chave" },
  );
  return { ...aberta, enviadas };
}
