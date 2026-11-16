"use client";
/**
 * Detalhe de um grupo: cada membro com "comprou / não comprou", e quem comprou
 * pelo link do grupo mas não está (ou não está mais) nele. A lista de quem não
 * comprou pode ser baixada em CSV para remarketing.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { neutralizarFormula } from "@/lib/csv/neutralizar-formula";
import type { DetalheDoGrupo as Detalhe } from "@/lib/grupos-painel/servico";
import { ArrowLeft, DownloadSimple } from "@/lib/ui/icons";

const reais = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const fone = (d: string | null) => (d ? `+${d}` : "número oculto");

function baixarCsv(nome: string, linhas: string[][]) {
  const csv = linhas.map((l) => l.map((c) => `"${neutralizarFormula(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export function DetalheDoGrupo({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const t = useT();
  const [filtro, setFiltro] = useState<"todos" | "compraram" | "nao">("todos");
  const q = useQuery({
    queryKey: ["grupos-painel", id],
    queryFn: async () => {
      const res = await fetch(`/api/v1/grupos-painel/${id}`);
      const body = (await res.json()) as { data?: Detalhe; error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Erro ${res.status}`);
      return body.data as Detalhe;
    },
  });
  const membros = useMemo(() => {
    const m = q.data?.membros ?? [];
    if (filtro === "compraram") return m.filter((x) => x.comprou);
    if (filtro === "nao") return m.filter((x) => !x.comprou);
    return m;
  }, [q.data, filtro]);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message}</p>;
  const d = q.data;
  const compraram = d.membros.filter((m) => m.comprou).length;
  const comTelefone = d.membros.filter((m) => m.telefone).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft /> {t("Voltar")}
        </Button>
        <h2 className="text-xl font-semibold">{d.grupo.subject}</h2>
        {d.grupo.codigoOrigem && <Badge variant="info">?src={d.grupo.codigoOrigem}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">
        {d.membros.length} {t("membros")} · {comTelefone} {t("com número visível")} · {compraram} {t("compraram")} ·{" "}
        {t("atualizado em")} {data(d.grupo.sincronizadoEm)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(["todos", "compraram", "nao"] as const).map((f) => (
          <Button key={f} size="sm" variant={filtro === f ? "primary" : "outline"} onClick={() => setFiltro(f)}>
            {f === "todos" ? t("Todos") : f === "compraram" ? t("Compraram") : t("Não compraram")}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            baixarCsv(
              `${(d.grupo.subject ?? "grupo").replace(/[^\w-]+/g, "_")}-nao-compraram.csv`,
              [["telefone"], ...d.membros.filter((m) => !m.comprou && m.telefone).map((m) => [m.telefone as string])],
            )
          }
        >
          <DownloadSimple /> {t("Baixar quem não comprou")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">{t("Telefone")}</th>
              <th className="p-3">{t("Nome na compra")}</th>
              <th className="p-3">{t("Situação")}</th>
              <th className="p-3 text-right">{t("Compras")}</th>
              <th className="p-3 text-right">{t("Valor")}</th>
              <th className="p-3">{t("Última compra")}</th>
            </tr>
          </thead>
          <tbody>
            {membros.slice(0, 1000).map((m, i) => (
              <tr key={`${m.telefone ?? "x"}-${i}`} className="border-t">
                <td className="p-3 tabular-nums">
                  {fone(m.telefone)}
                  {m.admin && <Badge variant="neutral" className="ml-2">admin</Badge>}
                </td>
                <td className="p-3">{m.nome ?? "—"}</td>
                <td className="p-3">
                  {m.comprou ? <Badge variant="success">{t("Comprou")}</Badge> : <Badge variant="neutral">{t("Não comprou")}</Badge>}
                </td>
                <td className="p-3 text-right tabular-nums">{m.compras || "—"}</td>
                <td className="p-3 text-right tabular-nums">{m.valorCents ? reais(m.valorCents) : "—"}</td>
                <td className="p-3">{data(m.ultimaCompraEm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.compradoresForaDoGrupo.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">
            {t("Compraram pelo link deste grupo, mas não estão nele")} ({d.compradoresForaDoGrupo.length})
          </h3>
          <ul className="divide-y rounded-lg border text-sm">
            {d.compradoresForaDoGrupo.slice(0, 300).map((c, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 p-3">
                <span>{c.nome ?? "—"}</span>
                <span className="tabular-nums text-muted-foreground">
                  {fone(c.telefone)} · {data(c.compradoEm)} · {reais(c.valorCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
