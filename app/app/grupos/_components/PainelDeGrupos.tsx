"use client";
/**
 * Painel de Grupos: a tabela dos grupos acompanhados (membros, vendas,
 * conversão), a lista dos outros grupos para ligar o acompanhamento, a
 * importação da planilha da Kiwify e a URL do webhook.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import type { ResumoDoGrupo, ResumoGeral } from "@/lib/grupos-painel/servico";
import { ArrowsClockwise, Copy, MagnifyingGlass, UploadSimple, UsersThree } from "@/lib/ui/icons";
import { DetalheDoGrupo } from "./DetalheDoGrupo";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `Erro ${res.status}`);
  return body?.data as T;
}

const reais = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

export function PainelDeGrupos({ podeConectar }: { podeConectar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  const resumo = useQuery({
    queryKey: ["grupos-painel"],
    queryFn: () => api<ResumoGeral>("/api/v1/grupos-painel"),
  });
  const kiwify = useQuery({
    queryKey: ["grupos-painel", "kiwify"],
    queryFn: () => api<{ conectada: boolean; url?: string; comToken?: boolean }>("/api/v1/grupos-painel/kiwify"),
    enabled: podeConectar,
  });

  const sincronizar = useMutation({
    mutationFn: () => api<{ grupos: number; membros: number; numeros: number }>("/api/v1/grupos-painel/sincronizar", { method: "POST" }),
    onSuccess: (r) => {
      toast.success(`${r.grupos} ${t("grupos lidos")}, ${r.membros} ${t("membros atualizados")}`);
      void qc.invalidateQueries({ queryKey: ["grupos-painel"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const alterar = useMutation({
    mutationFn: (v: { id: string; acompanhar?: boolean; codigo_origem?: string | null }) =>
      api(`/api/v1/grupos-painel/${v.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acompanhar: v.acompanhar, codigo_origem: v.codigo_origem }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["grupos-painel"] }),
    onError: (e) => toast.error(e.message),
  });
  const importar = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return api<{ linhas: number; gravadas: number }>("/api/v1/grupos-painel/vendas/importar", { method: "POST", body: fd });
    },
    onSuccess: (r) => {
      toast.success(`${r.gravadas} ${t("vendas importadas")}`);
      void qc.invalidateQueries({ queryKey: ["grupos-painel"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const conectar = useMutation({
    mutationFn: () => api("/api/v1/grupos-painel/kiwify", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["grupos-painel", "kiwify"] }),
    onError: (e) => toast.error(e.message),
  });

  const grupos = resumo.data?.grupos ?? [];
  const acompanhados = useMemo(
    () => grupos.filter((g) => g.acompanhar).sort((a, b) => b.compradores - a.compradores),
    [grupos],
  );
  const outros = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return grupos
      .filter((g) => !g.acompanhar)
      .filter((g) => !q || (g.subject ?? "").toLowerCase().includes(q))
      .sort((a, b) => Number(b.souAdmin === true) - Number(a.souAdmin === true) || (b.membrosTotal ?? 0) - (a.membrosTotal ?? 0));
  }, [grupos, busca]);

  if (resumo.isLoading) return <Skeleton className="h-64 w-full" />;
  if (resumo.error) return <p className="text-sm text-destructive">{(resumo.error as Error).message}</p>;
  const r = resumo.data as ResumoGeral;
  const membrosTotais = acompanhados.reduce((a, g) => a + (g.membrosTotal ?? 0), 0);

  if (aberto) return <DetalheDoGrupo id={aberto} onVoltar={() => setAberto(null)} />;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero rotulo={t("Grupos acompanhados")} valor={String(acompanhados.length)} />
        <Numero rotulo={t("Membros nesses grupos")} valor={membrosTotais.toLocaleString("pt-BR")} />
        <Numero rotulo={t("Vendas pagas")} valor={r.vendasTotais.toLocaleString("pt-BR")} />
        <Numero rotulo={t("Faturamento")} valor={reais(r.faturamentoTotalCents)} />
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <Button onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending}>
          <ArrowsClockwise /> {sincronizar.isPending ? t("Sincronizando…") : t("Sincronizar com o WhatsApp")}
        </Button>
        <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={importar.isPending}>
          <UploadSimple /> {importar.isPending ? t("Importando…") : t("Importar planilha da Kiwify")}
        </Button>
        <input
          ref={arquivo}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importar.mutate(f);
            e.target.value = "";
          }}
        />
        {r.vendasSemGrupo > 0 && (
          <span className="text-sm text-muted-foreground">
            {r.vendasSemGrupo} {t("vendas sem grupo identificado (link sem ?src= ou código não cadastrado)")}
          </span>
        )}
      </section>

      <section className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">{t("Grupo")}</th>
              <th className="p-3">{t("Código do link")}</th>
              <th className="p-3 text-right">{t("Membros")}</th>
              <th className="p-3 text-right">{t("Vendas pelo link")}</th>
              <th className="p-3 text-right">{t("Membros que compraram")}</th>
              <th className="p-3 text-right">{t("Conversão")}</th>
              <th className="p-3 text-right">{t("Faturamento")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {acompanhados.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  {t("Nenhum grupo acompanhado ainda. Clique em Sincronizar e ligue os seus grupos na lista abaixo.")}
                </td>
              </tr>
            )}
            {acompanhados.map((g) => (
              <LinhaDoGrupo key={g.id} g={g} onAbrir={() => setAberto(g.id)} onCodigo={(c) => alterar.mutate({ id: g.id, codigo_origem: c })} onDesligar={() => alterar.mutate({ id: g.id, acompanhar: false })} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("Outros grupos do número")}</h2>
          <div className="relative">
            <MagnifyingGlass className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder={t("Buscar grupo")} value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        {grupos.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("Clique em Sincronizar com o WhatsApp para trazer os grupos do número conectado.")}</p>
        )}
        <ul className="divide-y rounded-lg border">
          {outros.slice(0, 80).map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{g.subject ?? g.groupChatId}</p>
                <p className="text-xs text-muted-foreground">
                  {g.membrosTotal ?? "?"} {t("membros")}
                  {g.souAdmin ? ` · ${t("você é admin")}` : ""}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                {t("Acompanhar")}
                <Switch checked={false} onCheckedChange={() => alterar.mutate({ id: g.id, acompanhar: true })} />
              </label>
            </li>
          ))}
        </ul>
      </section>

      {podeConectar && (
        <section className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">{t("Vendas automáticas da Kiwify")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Cole esta URL na Kiwify em Apps → Webhooks, com os eventos Compra aprovada, Compra reembolsada, Chargeback e Assinatura renovada. Cada venda nova entra aqui sozinha, já no grupo do link.")}
          </p>
          {kiwify.data?.conectada && kiwify.data.url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-muted px-2 py-1 text-xs">{kiwify.data.url}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(kiwify.data?.url ?? "");
                  toast.success(t("URL copiada"));
                }}
              >
                <Copy /> {t("Copiar")}
              </Button>
            </div>
          ) : (
            <Button className="self-start" onClick={() => conectar.mutate()} disabled={conectar.isPending}>
              {t("Gerar URL do webhook")}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

function LinhaDoGrupo({
  g,
  onAbrir,
  onCodigo,
  onDesligar,
}: {
  g: ResumoDoGrupo;
  onAbrir: () => void;
  onCodigo: (c: string | null) => void;
  onDesligar: () => void;
}) {
  const t = useT();
  const [codigo, setCodigo] = useState(g.codigoOrigem ?? "");
  return (
    <tr className="border-t align-middle">
      <td className="p-3">
        <button type="button" className="flex items-center gap-2 text-left font-medium hover:underline" onClick={onAbrir}>
          <UsersThree className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{g.subject ?? g.groupChatId}</span>
        </button>
        {g.souAdmin === false && <Badge variant="warning" className="mt-1">{t("você não é admin")}</Badge>}
      </td>
      <td className="p-3">
        <Input
          className="h-8 w-28"
          placeholder="grupo1"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onBlur={() => {
            const novo = codigo.trim().toLowerCase();
            if (novo !== (g.codigoOrigem ?? "")) onCodigo(novo || null);
          }}
        />
      </td>
      <td className="p-3 text-right tabular-nums">{g.membrosTotal ?? "—"}</td>
      <td className="p-3 text-right tabular-nums">{g.vendasPeloLink}</td>
      <td className="p-3 text-right tabular-nums">{g.membrosQueCompraram}</td>
      <td className="p-3 text-right tabular-nums">{pct(g.conversao)}</td>
      <td className="p-3 text-right tabular-nums">{reais(g.faturamentoCents)}</td>
      <td className="p-3 text-right">
        <Button variant="ghost" size="sm" onClick={onDesligar}>
          {t("Parar")}
        </Button>
      </td>
    </tr>
  );
}
