"use client";
/**
 * Fechar a venda sem sair da conversa.
 *
 * Ao lado do status da conversa fica a situação do NEGÓCIO dessa pessoa
 * ("Aberto", "Ganho", "Perdido"). Clicando em "Aberto" desce o menu; em
 * "Ganho" o CRM pede o valor da venda e, num passo só:
 *
 *   1. grava o valor no negócio (`PATCH /api/v1/leads/[id]`);
 *   2. fecha como ganho (`POST /api/v1/leads/[id]/win`), que leva o card para a
 *      etapa de ganho do funil (no Konect, "Fechou ✓") — e com isso a Visão
 *      geral, o funil e a receita ganha passam a contar a venda;
 *   3. marca o telefone como "Comprou" no painel dos grupos
 *      (`PUT /api/v1/grupos-painel/clientes`), que é a etiqueta que aparece no
 *      nome dele dentro dos grupos.
 *
 * Os três passos são as mesmas rotas que as telas do funil e dos grupos já
 * usam, então as regras (papel, auditoria, gatilhos do funil) são as de lá.
 * Se um passo falha, os anteriores continuam valendo e a mensagem diz qual
 * faltou — o vendedor nunca fica sem saber se a venda entrou.
 */
import { useCallback, useContext, useEffect, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { CaretDown, CheckCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface NegocioResumo {
  id: string;
  status: string;
  value_cents: number | null;
  currency: string | null;
  updated_at: string;
}

/** Avisa a lateral do CRM (e quem mais ouvir) que o negócio desta pessoa mudou. */
export const EVENTO_NEGOCIO_MUDOU = "deskcomm:negocio-mudou";

const ROTULO: Record<string, string> = { open: "Aberto", won: "Ganho", lost: "Perdido" };

function centavosDoTexto(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.]/g, "");
  if (!limpo) return null;
  // "1.234,56" e "1234,56" (Brasil) e "1234.56" valem; o último separador é o decimal.
  const ultimo = Math.max(limpo.lastIndexOf(","), limpo.lastIndexOf("."));
  const inteiro = ultimo >= 0 ? limpo.slice(0, ultimo).replace(/[.,]/g, "") : limpo;
  const fracao = ultimo >= 0 ? limpo.slice(ultimo + 1).padEnd(2, "0").slice(0, 2) : "00";
  const n = Number(`${inteiro || "0"}.${fracao}`);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export function VendaRapida({ contactId, telefone }: { contactId: string; telefone: string | null }) {
  const t = useT();
  // Opcional de propósito: o cabeçalho também é desenhado fora do provedor
  // (testes, telas soltas), e a venda não pode derrubar o cabeçalho por isso.
  const qc = useContext(QueryClientContext);
  const [negocio, setNegocio] = useState<NegocioResumo | null>(null);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let cancelado = false;
    apiClient
      .get<{ data: { leads: NegocioResumo[] } }>(`/api/v1/contacts/${contactId}/crm-summary`)
      .then((r) => {
        if (cancelado) return;
        const leads = Array.isArray(r?.data?.leads) ? r.data.leads : [];
        // O negócio em andamento manda; sem nenhum aberto, mostra o mais recente.
        const ordenar = (a: NegocioResumo, b: NegocioResumo) => b.updated_at.localeCompare(a.updated_at);
        const abertos = leads.filter((l) => l.status === "open").sort(ordenar);
        setNegocio(abertos[0] ?? [...leads].sort(ordenar)[0] ?? null);
      })
      .catch(() => {
        if (!cancelado) setNegocio(null);
      });
    return () => {
      cancelado = true;
    };
  }, [contactId, versao]);

  useEffect(() => {
    const ouvir = (e: Event) => {
      const alvo = (e as CustomEvent<{ contactId?: string }>).detail?.contactId;
      if (alvo === contactId) recarregar();
    };
    window.addEventListener(EVENTO_NEGOCIO_MUDOU, ouvir);
    return () => window.removeEventListener(EVENTO_NEGOCIO_MUDOU, ouvir);
  }, [contactId, recarregar]);

  const [pedindoValor, setPedindoValor] = useState(false);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);

  if (!negocio) return null;

  const status = negocio.status;
  const ganho = status === "won";

  async function confirmar() {
    if (!negocio) return;
    const cents = centavosDoTexto(valor);
    if (cents === null) {
      toast.error(t("Digite o valor da venda."));
      return;
    }
    setSalvando(true);
    try {
      await apiClient.patch(`/api/v1/leads/${negocio.id}`, { value_cents: cents });
      await apiClient.post(`/api/v1/leads/${negocio.id}/win`, {});
    } catch (e) {
      setSalvando(false);
      toast.error(e instanceof Error && e.message ? e.message : t("Não foi possível fechar a venda."));
      return;
    }
    let etiquetaOk = true;
    if (telefone) {
      try {
        await apiClient.put(`/api/v1/grupos-painel/clientes`, { telefone, situacao: "comprou" });
      } catch {
        etiquetaOk = false;
      }
    }
    setSalvando(false);
    setPedindoValor(false);
    if (etiquetaOk) toast.success(t("Venda registrada: negócio ganho e etiqueta Comprou nos grupos."));
    else toast.warning(t("Venda registrada, mas a etiqueta dos grupos não foi atualizada."));
    void qc?.invalidateQueries({ queryKey: ["grupos-painel"] });
    void qc?.invalidateQueries({ queryKey: ["board"] });
    window.dispatchEvent(new CustomEvent(EVENTO_NEGOCIO_MUDOU, { detail: { contactId } }));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition-colors duration-200",
              ganho
                ? "border-success/40 bg-success-bg text-success-fg"
                : status === "lost"
                  ? "border-error/40 bg-error-bg text-error-fg"
                  : "border-border text-muted-foreground hover:border-accent hover:text-foreground",
            )}
            aria-label={t("Situação do negócio")}
          >
            {ganho && <CheckCircle size={11} weight="fill" aria-hidden />}
            {t(ROTULO[status] ?? status)}
            <CaretDown size={10} weight="bold" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            onSelect={() => {
              setValor(negocio.value_cents ? (negocio.value_cents / 100).toFixed(2).replace(".", ",") : "");
              setPedindoValor(true);
            }}
          >
            <CheckCircle size={16} weight="fill" className="text-success" aria-hidden />
            {ganho ? t("Corrigir valor da venda") : t("Ganho: registrar venda")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pedindoValor} onOpenChange={(v) => !salvando && setPedindoValor(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Registrar venda")}</DialogTitle>
            <DialogDescription>
              {t("O negócio vai para Fechou, a venda entra na receita e a etiqueta nos grupos vira Comprou.")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmar();
            }}
            className="space-y-2"
          >
            <Label htmlFor="valor-da-venda">{t("Valor da venda (R$)")}</Label>
            <Input
              id="valor-da-venda"
              inputMode="decimal"
              autoFocus
              placeholder="197,90"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setPedindoValor(false)} disabled={salvando}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando ? t("Registrando…") : t("Registrar venda")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
