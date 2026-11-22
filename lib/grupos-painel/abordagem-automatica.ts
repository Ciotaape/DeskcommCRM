/**
 * Grupos › Abordagem automática — o robô que chama no privado, sozinho e
 * devagar, quem está nos grupos, não comprou e ainda não foi abordado.
 *
 * Cada rodada (cron por minuto) faz NO MÁXIMO uma abordagem por organização:
 *   1. só dentro do horário (`hora_inicio`–`hora_fim`, hora de Maceió);
 *   2. só enquanto o dia não bateu `por_dia` — contando TODAS as abordagens do
 *      dia, manuais e automáticas, porque o risco de bloqueio é do número, não
 *      de quem clicou;
 *   3. respeitando o espaçamento: o dia útil dividido por `por_dia`, com
 *      variação aleatória (nunca o mesmo intervalo seguido — ritmo de robô é o
 *      que o WhatsApp detecta);
 *   4. escolhe quem mais fala nos grupos primeiro (quem participa responde
 *      mais), manda a abertura (a resposta rápida escolhida), garante o card no
 *      funil e inscreve a pessoa no fluxo do questionário, que daí em diante
 *      pergunta, espera, escolhe o gancho pela resposta e manda o link.
 *
 * A configuração mora em `organizations.settings.grupos_abordagem_auto`.
 * `admin` é service role: toda consulta filtra `organization_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { enrollFollowupFlow } from "@/lib/followup/enroll";
import { garantirLeadDaConversa } from "@/lib/leads/nascimento-do-lead";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { abordar, pessoasParaAbordar, type PessoaParaAbordar } from "./abordagem";
import { chaveDeTelefone } from "./telefone";

export interface ConfigDaAbordagemAuto {
  ativo: boolean;
  por_dia: number;
  hora_inicio: number;
  hora_fim: number;
  /** Resposta rápida da ABERTURA (a primeira mensagem). */
  template_id: string | null;
  /** Fluxo de follow-up do questionário (inscrito logo depois da abertura). */
  fluxo_id: string | null;
  /** Em nome de quem as mensagens saem (quem ligou o robô). */
  ator_user_id: string | null;
}

export const CONFIG_PADRAO: ConfigDaAbordagemAuto = {
  ativo: false,
  por_dia: 30,
  hora_inicio: 9,
  hora_fim: 19,
  template_id: null,
  fluxo_id: null,
  ator_user_id: null,
};

const CHAVE = "grupos_abordagem_auto";
/** Maceió não tem horário de verão: UTC−3 o ano inteiro. */
const FUSO_MIN = -180;

export function horaLocal(agora: Date): number {
  return new Date(agora.getTime() + FUSO_MIN * 60_000).getUTCHours();
}

export function inicioDoDiaLocal(agora: Date): Date {
  const local = new Date(agora.getTime() + FUSO_MIN * 60_000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - FUSO_MIN * 60_000);
}

/** Intervalo médio entre abordagens: o dia útil dividido pela meta do dia. */
export function intervaloMedioMs(c: ConfigDaAbordagemAuto): number {
  const horas = Math.max(1, c.hora_fim - c.hora_inicio);
  return Math.floor((horas * 3_600_000) / Math.max(1, c.por_dia));
}

/**
 * Hora de abordar? Nunca antes de 75% do intervalo médio; depois disso, uma
 * chance por minuto (25%) até 125%, quando passa a ser certo. O resultado é um
 * espaçamento que varia de verdade, sem relógio fixo.
 */
export function horaDaProxima(decorridoMs: number, intervaloMs: number, sorteio: number): boolean {
  if (decorridoMs < intervaloMs * 0.75) return false;
  if (decorridoMs >= intervaloMs * 1.25) return true;
  return sorteio < 0.25;
}

export async function lerConfig(admin: SupabaseClient, org: string): Promise<ConfigDaAbordagemAuto> {
  const { data } = await admin.from("organizations").select("settings").eq("id", org).maybeSingle();
  const bruto = ((data as { settings?: Record<string, unknown> } | null)?.settings ?? {})[CHAVE];
  return { ...CONFIG_PADRAO, ...((bruto as Partial<ConfigDaAbordagemAuto> | undefined) ?? {}) };
}

/**
 * Escreve com o cliente ADMIN criado aqui mesmo: `organizations` só aceita
 * escrita do service role (a RLS deixaria zero linhas e devolveria sucesso).
 * O filtro de organização é responsabilidade desta função.
 */
export async function gravarConfig(org: string, novo: ConfigDaAbordagemAuto): Promise<ConfigDaAbordagemAuto> {
  const admin = createAdminClient();
  const { data } = await admin.from("organizations").select("settings").eq("id", org).maybeSingle();
  const settings = { ...(((data as { settings?: Record<string, unknown> } | null)?.settings ?? {}) as Record<string, unknown>) };
  settings[CHAVE] = novo;
  const { error } = await admin.from("organizations").update({ settings }).eq("id", org);
  if (error) throw error;
  return novo;
}

export interface SituacaoDoDia {
  hoje: number;
  ultima: string | null;
}

export async function situacaoDoDia(admin: SupabaseClient, org: string, agora: Date): Promise<SituacaoDoDia> {
  const desde = inicioDoDiaLocal(agora).toISOString();
  const { count } = await admin
    .from("grupos_abordagens")
    .select("telefone_chave", { count: "exact", head: true })
    .eq("organization_id", org)
    .gte("abordado_em", desde);
  const { data: ultima } = await admin
    .from("grupos_abordagens")
    .select("abordado_em")
    .eq("organization_id", org)
    .order("abordado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { hoje: count ?? 0, ultima: (ultima as { abordado_em?: string } | null)?.abordado_em ?? null };
}

/** Quem vem primeiro: quem mais fala nos grupos; empate, quem falou por último. */
export function proximaPessoa(pessoas: PessoaParaAbordar[]): PessoaParaAbordar | null {
  const livres = pessoas.filter((p) => !p.abordado_em);
  livres.sort(
    (a, b) =>
      b.mensagens_no_grupo - a.mensagens_no_grupo || (b.ultima_mensagem ?? "").localeCompare(a.ultima_mensagem ?? ""),
  );
  return livres[0] ?? null;
}

/**
 * Depois de a abertura sair: garante o card no funil e inscreve no questionário.
 * Usado pelo robô e pelo botão "Abordar" quando a mensagem escolhida é a
 * abertura do questionário. Falha aqui não desfaz a abertura (já foi): fica no log.
 */
export async function iniciarQuestionario(
  admin: SupabaseClient,
  org: string,
  e: { contactId: string; conversationId: string; nome: string | null; fluxoId: string; requestId: string },
): Promise<boolean> {
  try {
    await garantirLeadDaConversa(admin, {
      organizationId: org,
      contactId: e.contactId,
      conversationId: e.conversationId,
      nomeDoContato: e.nome,
    });
  } catch (err) {
    logger.warn("abordagem-automatica: card não criado", { requestId: e.requestId, causa: String(err) });
  }
  const r = await enrollFollowupFlow(admin, {
    organizationId: org,
    pointerId: e.fluxoId,
    contactId: e.contactId,
    actorUserId: null,
    requestId: e.requestId,
  });
  if (!r.ok) {
    logger.warn("abordagem-automatica: questionário não iniciado", {
      requestId: e.requestId,
      codigo: r.code,
      causa: r.message,
    });
  }
  return r.ok;
}

export type ResultadoDaRodada =
  | { acao: "desligado" | "incompleto" | "fora_do_horario" | "limite_do_dia" | "aguardando" | "ninguem" }
  | { acao: "abordou"; telefone: string; conversation_id: string; questionario: boolean }
  | { acao: "falhou"; telefone: string | null; motivo: string };

export async function rodadaDaOrg(
  admin: SupabaseClient,
  org: string,
  agora: Date,
  requestId: string,
  sorteio: number = Math.random(),
): Promise<ResultadoDaRodada> {
  const cfg = await lerConfig(admin, org);
  if (!cfg.ativo) return { acao: "desligado" };
  if (!cfg.template_id || !cfg.fluxo_id || !cfg.ator_user_id) return { acao: "incompleto" };

  const hora = horaLocal(agora);
  if (hora < cfg.hora_inicio || hora >= cfg.hora_fim) return { acao: "fora_do_horario" };

  const dia = await situacaoDoDia(admin, org, agora);
  if (dia.hoje >= cfg.por_dia) return { acao: "limite_do_dia" };
  if (dia.ultima) {
    const decorrido = agora.getTime() - new Date(dia.ultima).getTime();
    if (!horaDaProxima(decorrido, intervaloMedioMs(cfg), sorteio)) return { acao: "aguardando" };
  }

  const pessoa = proximaPessoa(await pessoasParaAbordar(admin, org));
  if (!pessoa) return { acao: "ninguem" };

  try {
    const r = await abordar(admin, org, {
      userId: cfg.ator_user_id,
      requestId,
      telefone: pessoa.telefone,
      nome: pessoa.nome,
      templateId: cfg.template_id,
    });
    const questionario = await iniciarQuestionario(admin, org, {
      contactId: r.contact_id,
      conversationId: r.conversation_id,
      nome: pessoa.nome,
      fluxoId: cfg.fluxo_id,
      requestId,
    });
    return { acao: "abordou", telefone: pessoa.telefone, conversation_id: r.conversation_id, questionario };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    // Número desconectado ou mensagem sumida: problema da operação, não da
    // pessoa — ela continua na fila para a próxima rodada.
    if (motivo === "session_unavailable" || motivo === "modelo_nao_encontrado") {
      return { acao: "falhou", telefone: pessoa.telefone, motivo };
    }
    // Problema com ESTA pessoa (número inválido, recusa do envio): ela sai da
    // fila, senão o robô tentaria a mesma pessoa a cada minuto para sempre.
    const chave = chaveDeTelefone(pessoa.telefone);
    if (chave && motivo !== "ja_abordado") {
      await admin.from("grupos_abordagens").upsert(
        {
          organization_id: org,
          telefone_chave: chave,
          template_id: cfg.template_id,
          abordado_por: cfg.ator_user_id,
          abordado_em: agora.toISOString(),
        },
        { onConflict: "organization_id,telefone_chave" },
      );
    }
    return { acao: "falhou", telefone: pessoa.telefone, motivo };
  }
}
