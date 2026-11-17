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
      podeMarcar,
      abrindo,
    }),
    [situacaoDe, iniciarConversa, marcacao, podeMarcar, abrindo],
  );

  return (
    <ContextoDosParticipantes.Provider value={valor}>
      {children}
      {seletor}
    </ContextoDosParticipantes.Provider>
  );
}

