"use client";
/**
 * Grupos › Abordagem › robô automático. Liga/desliga, quantas por dia, em que
 * horário, qual mensagem abre a conversa e qual fluxo faz o questionário. Mostra
 * como está o dia: quantas hoje, intervalo médio e quantas pessoas na fila.
 */
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { ConfigDaAbordagemAuto } from "@/lib/grupos-painel/abordagem-automatica";
import { Robot } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Situacao {
  config: ConfigDaAbordagemAuto;
  hoje: number;
  ultima: string | null;
  intervalo_medio_min: number;
  na_fila: number;
}

interface Opcao {
  id: string;
  title?: string;
  name?: string;
  status?: string;
}

const CHAVE = ["grupos-painel", "abordagem-automatica"] as const;

export function AbordagemAutomatica() {
  const t = useT();
  const qc = useQueryClient();
  const situacao = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<{ data: Situacao }>("/api/v1/grupos-painel/abordagem-automatica").then((r) => r.data),
    refetchInterval: 60_000,
  });
  const modelos = useQuery({
    queryKey: ["grupos-painel", "abordagem-automatica", "modelos"],
    queryFn: () =>
      apiClient.get<{ data: Opcao[] }>("/api/v1/message-templates").then((r) => (Array.isArray(r.data) ? r.data : [])),
  });
  const fluxos = useQuery({
    queryKey: ["grupos-painel", "abordagem-automatica", "fluxos"],
    queryFn: () =>
      apiClient.get<{ data: Opcao[] }>("/api/v1/ai/followup-flows").then((r) => (Array.isArray(r.data) ? r.data : [])),
  });

  const [rascunho, setRascunho] = useState<ConfigDaAbordagemAuto | null>(null);
  const cfg = rascunho ?? situacao.data?.config ?? null;

  const salvar = useMutation({
    mutationFn: (c: ConfigDaAbordagemAuto) =>
      apiClient.put("/api/v1/grupos-painel/abordagem-automatica", {
        ativo: c.ativo,
        por_dia: c.por_dia,
        hora_inicio: c.hora_inicio,
        hora_fim: c.hora_fim,
        template_id: c.template_id,
        fluxo_id: c.fluxo_id,
      }),
    onSuccess: () => {
      setRascunho(null);
      toast.success(t("Abordagem automática salva."));
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Não foi possível salvar agora.")),
  });

  if (!cfg) return null;
  const mudar = (p: Partial<ConfigDaAbordagemAuto>) => setRascunho({ ...cfg, ...p });
  const s = situacao.data;

  return (
    <section className={cn("space-y-3 rounded-lg border bg-card p-4", cfg.ativo ? "border-primary/50" : "border-border")}>
      <div className="flex flex-wrap items-start gap-3">
        <Robot size={22} className={cn("mt-0.5 shrink-0", cfg.ativo ? "text-primary" : "text-muted-foreground")} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{t("Abordagem automática")}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "O CRM chama sozinho, um por vez e com intervalos variados, quem está nos grupos, não comprou e ainda não foi abordado. Quem mais fala nos grupos vai primeiro. Depois da abertura, o fluxo do questionário faz as perguntas e manda o link.",
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={cfg.ativo}
            onCheckedChange={(v) => salvar.mutate({ ...cfg, ativo: v })}
            disabled={salvar.isPending}
          />
          {cfg.ativo ? t("Ligada") : t("Desligada")}
        </label>
      </div>

      {s && (
        <p className="text-xs text-muted-foreground">
          {t("Hoje")}: <strong className="text-foreground tabular-nums">{s.hoje}</strong> / {cfg.por_dia} ·{" "}
          {t("um a cada")} ~{s.intervalo_medio_min} min · {s.na_fila} {t("na fila")}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("Por dia")}</span>
          <Input
            type="number"
            min={1}
            max={80}
            value={cfg.por_dia}
            onChange={(e) => mudar({ por_dia: Number(e.target.value) || 1 })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("Horário")}</span>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={0}
              max={23}
              value={cfg.hora_inicio}
              onChange={(e) => mudar({ hora_inicio: Number(e.target.value) })}
            />
            <span className="text-muted-foreground">{t("às")}</span>
            <Input
              type="number"
              min={1}
              max={24}
              value={cfg.hora_fim}
              onChange={(e) => mudar({ hora_fim: Number(e.target.value) })}
            />
          </div>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("Mensagem de abertura")}</span>
          <select
            value={cfg.template_id ?? ""}
            onChange={(e) => mudar({ template_id: e.target.value || null })}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">{t("Escolha…")}</option>
            {(modelos.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t("Fluxo do questionário")}</span>
          <select
            value={cfg.fluxo_id ?? ""}
            onChange={(e) => mudar({ fluxo_id: e.target.value || null })}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">{t("Escolha…")}</option>
            {(fluxos.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.status && f.status !== "active" ? ` (${t("não publicado")})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!rascunho || salvar.isPending} onClick={() => rascunho && salvar.mutate(rascunho)}>
          {salvar.isPending ? t("Salvando…") : t("Salvar")}
        </Button>
        <Link href="/app/ai/followups" className="text-xs text-primary hover:underline">
          {t("Ver o fluxo do questionário")}
        </Link>
        <span className="text-xs text-muted-foreground">
          {t("Conta junto com as abordagens que você faz à mão. Mais de 40 por dia aumenta o risco de bloqueio do número.")}
        </span>
      </div>
    </section>
  );
}
