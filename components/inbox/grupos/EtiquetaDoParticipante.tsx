"use client";
/**
 * A etiqueta em cima de quem fala num grupo (aba Grupos › Conversas).
 *
 * Arquivo LEVE de propósito: o `MessageBubble` importa daqui, então nada além
 * de contexto e menu entra. Quem carrega os dados e abre conversa é o
 * `ProvedorDeParticipantes` (arquivo ao lado). Sem provedor — o Inbox comum —
 * `EtiquetaDoParticipante` devolve `null` e o balão fica como sempre foi.
 */
import { createContext, useContext } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/hooks/i18n/useT";
import { ROTULO_DA_SITUACAO, type ClienteConhecido, type SituacaoDoCliente } from "@/lib/grupos-painel/situacao";
import { CaretDown, PaperPlaneTilt, WhatsappLogo } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export interface ValorDosParticipantes {
  situacaoDe: (telefone: string | null) => { situacao: SituacaoDoCliente; info: ClienteConhecido | null };
  chamarNoPrivado: (telefone: string, nome: string | null) => void;
  /** Manda a mensagem padrão da abordagem no privado, sem sair do grupo. */
  abordar: (telefone: string, nome: string | null, templateId?: string) => void;
  /** As respostas rápidas cujo título começa com "Abordagem" — cada uma é uma versão da mensagem. */
  modelosDeAbordagem: Array<{ id: string; title: string }>;
  abordando: boolean;
  marcar: (telefone: string, situacao: SituacaoDoCliente | null) => void;
  podeMarcar: boolean;
  abrindo: boolean;
}

export const ContextoDosParticipantes = createContext<ValorDosParticipantes | null>(null);

const COR: Record<SituacaoDoCliente, string> = {
  renovou: "border-transparent bg-success-bg text-success-fg",
  comprou: "border-transparent bg-info-bg text-info-fg",
  nao_cliente: "border-border bg-surface-elevated text-text-muted",
};

/** A etiqueta + menu em cima de quem falou num grupo. `null` fora da aba Grupos. */
export function EtiquetaDoParticipante({ telefone, nome }: { telefone: string | null; nome: string | null }) {
  const t = useT();
  const ctx = useContext(ContextoDosParticipantes);
  if (!ctx || !telefone) return null;
  const { situacao, info } = ctx.situacaoDe(telefone);
  const titulo =
    info && info.compras > 0
      ? t("{n} compra(s)").replace("{n}", String(info.compras))
      : t("Nenhuma compra encontrada por este telefone");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={titulo}
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-semibold leading-4",
            COR[situacao],
          )}
        >
          {t(ROTULO_DA_SITUACAO[situacao])}
          {info?.origem === "manual" ? " ✎" : ""}
          <CaretDown size={9} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">{nome ?? telefone}</DropdownMenuLabel>
        {situacao === "nao_cliente" &&
          (ctx.modelosDeAbordagem.length > 1 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={ctx.abordando}>
                <PaperPlaneTilt size={14} className="mr-2" aria-hidden />
                {t("Abordar no privado")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                {ctx.modelosDeAbordagem.map((m) => (
                  <DropdownMenuItem key={m.id} onSelect={() => ctx.abordar(telefone, nome, m.id)}>
                    {m.title}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem disabled={ctx.abordando} onSelect={() => ctx.abordar(telefone, nome, ctx.modelosDeAbordagem[0]?.id)}>
              <PaperPlaneTilt size={14} className="mr-2" aria-hidden />
              {t("Abordar no privado")}
            </DropdownMenuItem>
          ))}
        <DropdownMenuItem disabled={ctx.abrindo} onSelect={() => ctx.chamarNoPrivado(telefone, nome)}>
          <WhatsappLogo size={14} className="mr-2" aria-hidden />
          {t("Chamar no privado")}
        </DropdownMenuItem>
        {ctx.podeMarcar && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              {t("Marcar como")}
            </DropdownMenuLabel>
            {(["comprou", "renovou", "nao_cliente"] as const).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => ctx.marcar(telefone, s)}>
                {t(ROTULO_DA_SITUACAO[s])}
                {situacao === s ? " ✓" : ""}
              </DropdownMenuItem>
            ))}
            {info?.origem === "manual" && (
              <DropdownMenuItem onSelect={() => ctx.marcar(telefone, null)}>
                {t("Voltar ao que as vendas dizem")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
