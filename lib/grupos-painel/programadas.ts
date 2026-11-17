/**
 * Mensagens programadas para grupos — leitura, validação e o envio do cron.
 * `admin` é service role: toda consulta filtra `organization_id` vindo da
 * sessão (rota) ou da própria linha (cron).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { roleAtLeast } from "@/lib/auth/types";
import { proximoEnvioDiario } from "./programacao";

export const COLUNAS_DA_PROGRAMADA =
  "id, conversation_ids, corpo, frequencia, horario, dias_semana, variacao_min, proximo_envio, ultimo_envio, ultimo_resultado, ativa, created_by_user_id, created_at";

export interface Programada {
  id: string;
  conversation_ids: string[];
  corpo: string;
  frequencia: "unica" | "diaria";
  horario: string | null;
  dias_semana: number[];
  variacao_min: number;
  proximo_envio: string | null;
  ultimo_envio: string | null;
  ultimo_resultado: string | null;
  ativa: boolean;
  created_by_user_id: string;
  created_at: string;
}

export const programadaSchema = z
  .object({
    conversation_ids: z.array(z.string().uuid()).min(1).max(50),
    corpo: z.string().trim().min(1).max(4000),
    frequencia: z.enum(["unica", "diaria"]),
    enviar_em: z.string().datetime({ offset: true }).optional(),
    horario: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    dias_semana: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    variacao_min: z.number().int().min(0).max(120).default(0),
  })
  .refine((p) => (p.frequencia === "unica" ? !!p.enviar_em : !!p.horario), {
    message: "informe a data (uma vez) ou o horário (todo dia)",
  });
export type ProgramadaInput = z.infer<typeof programadaSchema>;

/** Os grupos (conversas de grupo) da organização, para escolher onde mandar. */
export async function gruposDaOrganizacao(admin: SupabaseClient, org: string) {
  const { data, error } = await admin
    .from("conversations")
    .select("id, group_chat_id, channel_session_id, contacts:contact_id(name)")
    .eq("organization_id", org)
    .eq("is_group", true)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((c) => {
    const contato = (Array.isArray(c.contacts) ? c.contacts[0] : c.contacts) as { name?: string | null } | null;
    return { conversation_id: c.id as string, nome: contato?.name ?? (c.group_chat_id as string) };
  });
}

/** Ids que NÃO são conversa de grupo desta organização (vazio = tudo certo). */
export async function idsForaDaOrganizacao(admin: SupabaseClient, org: string, ids: readonly string[]): Promise<string[]> {
  const { data, error } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", org)
    .eq("is_group", true)
    .in("id", [...ids]);
  if (error) throw error;
  const achados = new Set((data ?? []).map((c) => c.id as string));
  return ids.filter((id) => !achados.has(id));
}

export function primeiroEnvio(p: ProgramadaInput, agora = new Date()): Date {
  if (p.frequencia === "unica") return new Date(p.enviar_em as string);
  return proximoEnvioDiario(agora, { horario: p.horario as string, dias_semana: p.dias_semana, variacao_min: p.variacao_min });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia uma programada a todos os grupos dela, pelo MESMO caminho de quem
 * responde no Inbox (ator = quem programou). Um grupo que falha não segura os
 * outros. Pausa entre grupos: anti-banimento.
 */
export async function enviarProgramada(
  admin: SupabaseClient,
  org: string,
  p: Pick<Programada, "id" | "conversation_ids" | "corpo" | "created_by_user_id">,
  requestId: string,
  pausaMs = 4000,
): Promise<{ enviadas: number; falhas: number; motivo?: string }> {
  const { data: vinculo } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", org)
    .eq("user_id", p.created_by_user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!roleAtLeast(vinculo?.role, "agent")) return { enviadas: 0, falhas: p.conversation_ids.length, motivo: "sem_acesso" };

  const validos = new Set(await idsValidos(admin, org, p.conversation_ids));
  let enviadas = 0;
  let falhas = 0;
  let primeira = true;
  for (const conversationId of p.conversation_ids) {
    if (!validos.has(conversationId)) {
      falhas++;
      continue;
    }
    if (!primeira) await esperar(pausaMs);
    primeira = false;
    try {
      const msg = await sendMessageHandler(
        admin,
        { organization_id: org, actor: { type: "user", id: p.created_by_user_id }, requestId },
        {
          conversation_id: conversationId,
          type: "text",
          body: p.corpo,
          metadata: { source: "grupos_programada", grupos_programada_id: p.id },
        },
      );
      if (msg.status === "failed") falhas++;
      else enviadas++;
    } catch {
      falhas++;
    }
  }
  return { enviadas, falhas };
}

async function idsValidos(admin: SupabaseClient, org: string, ids: readonly string[]): Promise<string[]> {
  const fora = new Set(await idsForaDaOrganizacao(admin, org, ids));
  return ids.filter((id) => !fora.has(id));
}
