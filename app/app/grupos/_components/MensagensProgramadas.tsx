"use client";
/**
 * Grupos › Mensagens programadas: uma mensagem para um ou vários grupos, uma
 * vez ou todo dia (com dias da semana e variação aleatória do horário). Quem
 * envia é o cron `grupos-programadas`, pelo mesmo caminho do Inbox.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { Programada } from "@/lib/grupos-painel/programadas";
import { PaperPlaneTilt, Trash } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Resposta {
  programadas: Programada[];
  grupos: Array<{ conversation_id: string; nome: string }>;
}

const CHAVE = ["grupos-painel", "programadas"] as const;

function quando(iso: string | null, tag: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(tag, { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export function MensagensProgramadas() {
  const t = useT();
  const tag = useTagDeIdioma();
  const DIAS = [t("Dom"), t("Seg"), t("Ter"), t("Qua"), t("Qui"), t("Sex"), t("Sáb")];
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<{ data: Resposta }>("/api/v1/grupos-painel/programadas").then((r) => r.data),
  });

  const [corpo, setCorpo] = useState("");
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [frequencia, setFrequencia] = useState<"unica" | "diaria">("diaria");
  const [enviarEm, setEnviarEm] = useState("");
  const [horario, setHorario] = useState("09:00");
  const [dias, setDias] = useState<Set<number>>(new Set());
  const [variacao, setVariacao] = useState(15);

  const grupos = consulta.data?.grupos ?? [];
  const nomeDe = useMemo(() => new Map(grupos.map((g) => [g.conversation_id, g.nome])), [grupos]);

  const erro = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t("Não foi possível salvar agora."));
  const atualizar = () => qc.invalidateQueries({ queryKey: CHAVE });

  const criar = useMutation({
    mutationFn: () =>
      apiClient.post("/api/v1/grupos-painel/programadas", {
        conversation_ids: [...escolhidos],
        corpo,
        frequencia,
        ...(frequencia === "unica"
          ? { enviar_em: new Date(`${enviarEm}:00-03:00`).toISOString() }
          : { horario, dias_semana: [...dias].sort(), variacao_min: variacao }),
        ...(frequencia === "unica" ? { variacao_min: 0 } : {}),
      }),
    onSuccess: () => {
      toast.success(t("Mensagem programada."));
      setCorpo("");
      setEscolhidos(new Set());
      void atualizar();
    },
    onError: erro,
  });

  const alterar = useMutation({
    mutationFn: (v: { id: string; ativa?: boolean; enviar_agora?: true }) =>
      apiClient.patch(`/api/v1/grupos-painel/programadas/${v.id}`, { ativa: v.ativa, enviar_agora: v.enviar_agora }),
    onSuccess: (_d, v) => {
      if (v.enviar_agora) toast.success(t("Sai no próximo minuto."));
      void atualizar();
    },
    onError: erro,
  });

  const apagar = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/grupos-painel/programadas/${id}`),
    onSuccess: () => void atualizar(),
    onError: erro,
  });

  const podeCriar =
    corpo.trim().length > 0 && escolhidos.size > 0 && (frequencia === "diaria" ? !!horario : !!enviarEm) && !criar.isPending;

  const alternar = <T,>(conjunto: Set<T>, valor: T) => {
    const novo = new Set(conjunto);
    if (novo.has(valor)) novo.delete(valor);
    else novo.add(valor);
    return novo;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">{t("Nova mensagem programada")}</h2>

        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="msg-programada">
            {t("Mensagem")}
          </label>
          <Textarea
            id="msg-programada"
            rows={6}
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            placeholder={t("Bom dia, rede! Hoje tem fornecedor novo no Mapa…")}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("Grupos")}</span>
            {grupos.length > 0 && (
              <button
                type="button"
                className="text-xs text-primary underline-offset-2 hover:underline"
                onClick={() =>
                  setEscolhidos(escolhidos.size === grupos.length ? new Set() : new Set(grupos.map((g) => g.conversation_id)))
                }
              >
                {escolhidos.size === grupos.length ? t("Desmarcar todos") : t("Marcar todos")}
              </button>
            )}
          </div>
          {consulta.isLoading ? (
            <Skeleton className="h-24" />
          ) : grupos.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("Nenhum grupo na aba Conversas ainda. Ligue \"Acompanhar\" no Painel de vendas e clique em Sincronizar; o grupo aparece aqui depois da primeira mensagem nele.")}
            </p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {grupos.map((g) => (
                <label key={g.conversation_id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/60">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={escolhidos.has(g.conversation_id)}
                    onChange={() => setEscolhidos(alternar(escolhidos, g.conversation_id))}
                  />
                  <span className="truncate">{g.nome}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">{t("Quando")}</span>
          <div className="flex gap-2">
            {(["diaria", "unica"] as const).map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={frequencia === f ? "default" : "outline"}
                onClick={() => setFrequencia(f)}
              >
                {f === "diaria" ? t("Todo dia") : t("Uma vez")}
              </Button>
            ))}
          </div>
          {frequencia === "unica" ? (
            <Input type="datetime-local" value={enviarEm} onChange={(e) => setEnviarEm(e.target.value)} />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input type="time" className="w-32" value={horario} onChange={(e) => setHorario(e.target.value)} />
                <span className="text-xs text-muted-foreground">{t("horário de Brasília")}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {DIAS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={dias.has(i)}
                    onClick={() => setDias(alternar(dias, i))}
                    className={cn(
                      "h-8 rounded-full border px-3 text-xs",
                      dias.has(i) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("Nenhum dia marcado = todos os dias.")}</p>
              <label className="flex items-center gap-2 text-sm">
                {t("Variar até")}
                <Input
                  type="number"
                  min={0}
                  max={120}
                  className="w-20"
                  value={variacao}
                  onChange={(e) => setVariacao(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
                />
                {t("min depois (anti-banimento)")}
              </label>
            </div>
          )}
        </div>

        <Button className="w-full" disabled={!podeCriar} onClick={() => criar.mutate()}>
          {criar.isPending ? t("Salvando…") : t("Programar")}
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("Programadas")}</h2>
        {consulta.isLoading ? (
          <Skeleton className="h-32" />
        ) : (consulta.data?.programadas ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhuma mensagem programada ainda.")}</p>
        ) : (
          (consulta.data?.programadas ?? []).map((p) => (
            <article key={p.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={p.ativa ? "success" : "neutral"}>{p.ativa ? t("Ativa") : t("Pausada")}</Badge>
                <span className="text-xs text-muted-foreground">
                  {p.frequencia === "diaria"
                    ? `${t("Todo dia")} ${p.horario}${p.dias_semana?.length ? ` (${p.dias_semana.map((d) => DIAS[d] ?? "").join(", ")})` : ""}${p.variacao_min ? ` +${p.variacao_min}min` : ""}`
                    : t("Uma vez")}
                </span>
                <span className="text-xs text-muted-foreground">· {t("Próxima")}: {quando(p.proximo_envio, tag)}</span>
                <div className="ml-auto flex items-center gap-2">
                  <Switch
                    checked={p.ativa}
                    aria-label={t("Ativa")}
                    onCheckedChange={(v) => alterar.mutate({ id: p.id, ativa: v })}
                  />
                  <Button size="sm" variant="outline" onClick={() => alterar.mutate({ id: p.id, enviar_agora: true })}>
                    <PaperPlaneTilt size={14} className="mr-1" aria-hidden />
                    {t("Enviar agora")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("Apagar")}
                    onClick={() => {
                      if (window.confirm(t("Apagar esta programação?"))) apagar.mutate(p.id);
                    }}
                  >
                    <Trash size={14} aria-hidden />
                  </Button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm">{p.corpo}</p>
              <p className="text-xs text-muted-foreground">
                {p.conversation_ids.map((id) => nomeDe.get(id) ?? t("grupo removido")).join(" · ")}
              </p>
              {p.ultimo_envio && (
                <p className="text-xs text-muted-foreground">
                  {t("Último envio")}: {quando(p.ultimo_envio, tag)} — {p.ultimo_resultado}
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
