"use client";
/**
 * Carrega, uma vez, a situação de cada telefone conhecido
 * (`GET /api/v1/grupos-painel/clientes`) e dá aos balões de grupo o "Chamar no
 * privado" e o "Marcar como". Fica em volta do `InboxLayout modo="grupos"`.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useConversaNovaComEscolhaDeCanal } from "@/components/channels/SeletorDeCanalParaConversa";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { ROLE_RANK } from "@/lib/auth/types";
import type { ClienteConhecido, SituacaoDoCliente } from "@/lib/grupos-painel/situacao";
import { chaveDeTelefone } from "@/lib/grupos-painel/telefone";
import { assumirConversaAoAbrir } from "@/lib/inbox/assumir-conversa-ao-abrir";
import { ContextoDosParticipantes, type ValorDosParticipantes } from "./EtiquetaDoParticipante";

export const CHAVE_DOS_CLIENTES = ["grupos-painel", "clientes"] as const;

export function ProvedorDeParticipantes({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { user, activeOrg } = useAuth();
  const podeMarcar = !!activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  const clientes = useQuery({
    queryKey: [...CHAVE_DOS_CLIENTES, activeOrg?.orgId],
    enabled: !!activeOrg,
    staleTime: 60_000,
    queryFn: () => apiClient.get<{ data: Record<string, ClienteConhecido> }>("/api/v1/grupos-painel/clientes").then((r) => r.data),
  });

  const marcacao = useMutation({
    mutationFn: (v: { telefone: string; situacao: SituacaoDoCliente | null }) =>
      apiClient.put("/api/v1/grupos-painel/clientes", v),
    onSuccess: () => {
      toast.success(t("Etiqueta salva."));
      void qc.invalidateQueries({ queryKey: CHAVE_DOS_CLIENTES });
    },
    onError: () => toast.error(t("Não foi possível salvar a etiqueta.")),
  });

  const modelos = useQuery({
    queryKey: ["grupos-painel", "modelos-de-abordagem"],
    staleTime: 60_000,
    queryFn: () =>
      apiClient.get<{ data: Array<{ id: string; title: string }> }>("/api/v1/message-templates").then((r) => (Array.isArray(r.data) ? r.data : [])),
  });
  const modelosDeAbordagem = useMemo(
    () => (modelos.data ?? []).filter((m) => /^abordagem/i.test(m.title.trim())).map((m) => ({ id: m.id, title: m.title })),
    [modelos.data],
  );

  const abordagem = useMutation({
    mutationFn: (v: { telefone: string; nome: string | null; templateId?: string }) =>
      apiClient.post("/api/v1/grupos-painel/abordagem", { telefone: v.telefone, nome: v.nome, template_id: v.templateId ?? null }),
    onSuccess: (_r, v) => toast.success(t("Abordagem enviada no privado de {nome}.").replace("{nome}", v.nome ?? v.telefone)),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Não foi possível enviar a abordagem agora.")),
  });

  const { iniciarConversa, seletor, abrindo } = useConversaNovaComEscolhaDeCanal({
    aoAbrir: async (conversationId) => {
      await assumirConversaAoAbrir(conversationId, { userId: user.id, t });
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      router.push(`/app/inbox?id=${conversationId}`);
    },
  });

  const mapa = clientes.data;
  const situacaoDe = useCallback(
    (telefone: string | null) => {
      const chave = chaveDeTelefone(telefone);
      const info = chave && mapa ? (mapa[chave] ?? null) : null;
      return { situacao: info?.situacao ?? ("nao_cliente" as const), info };
    },
    [mapa],
  );

  const valor = useMemo<ValorDosParticipantes>(
    () => ({
      situacaoDe,
      chamarNoPrivado: (telefone, nome) =>
        void iniciarConversa({ phone_number: telefone, ...(nome ? { name: nome } : {}) }),
      marcar: (telefone, situacao) => marcacao.mutate({ telefone, situacao }),
      abordar: (telefone, nome, templateId) => abordagem.mutate({ telefone, nome, templateId }),
      modelosDeAbordagem,
      abordando: abordagem.isPending,
      podeMarcar,
      abrindo,
    }),
    [situacaoDe, iniciarConversa, marcacao, abordagem, modelosDeAbordagem, podeMarcar, abrindo],
  );

  return (
    <ContextoDosParticipantes.Provider value={valor}>
      {children}
      {seletor}
    </ContextoDosParticipantes.Provider>
  );
}

