"use client";
/**
 * Grupos › Abordagem: quem está nos grupos e ainda não comprou, com um botão
 * "Abordar" por pessoa. O clique manda a resposta rápida escolhida no privado
 * (texto com o nome + imagens/áudio dela) e abre a conversa no Inbox — dali em
 * diante é você quem conversa. Uma pessoa por vez, nunca em lote.
 */
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { PessoaParaAbordar } from "@/lib/grupos-painel/abordagem";
import { PaperPlaneTilt } from "@/lib/ui/icons";

interface Modelo {
  id: string;
  title: string;
  body: string;
  midias?: unknown[] | null;
}

const CHAVE = ["grupos-painel", "abordagem"] as const;
const CHAVE_DO_MODELO = "konect_abordagem_modelo";

function lerModeloSalvo(): string {
  try {
    return window.localStorage.getItem(CHAVE_DO_MODELO) ?? "";
  } catch {
    return "";
  }
}

export function AbordagemDosGrupos() {
  const t = useT();
  const tag = useTagDeIdioma();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [soQuemFala, setSoQuemFala] = useState(true);
  const [mostrarAbordados, setMostrarAbordados] = useState(false);
  const [modeloId, setModeloId] = useState<string>("");
  // A última mensagem escolhida volta ao abrir (lida depois de montar: o
  // servidor não tem localStorage).
  useEffect(() => {
    const salvo = lerModeloSalvo();
    if (salvo) setModeloId(salvo);
  }, []);
  const [enviados, setEnviados] = useState<Record<string, string>>({});

  const pessoas = useQuery({
    queryKey: CHAVE,
    queryFn: () => apiClient.get<{ data: PessoaParaAbordar[] }>("/api/v1/grupos-painel/abordagem").then((r) => r.data),
  });
  const modelos = useQuery({
    queryKey: ["message-templates"],
    queryFn: () => apiClient.get<{ data: Modelo[] }>("/api/v1/message-templates").then((r) => r.data),
  });

  const escolher = (id: string) => {
    setModeloId(id);
    try {
      window.localStorage.setItem(CHAVE_DO_MODELO, id);
    } catch {
      // sem storage: só não lembra na próxima visita
    }
  };

  const abordar = useMutation({
    mutationFn: (p: PessoaParaAbordar) =>
      apiClient
        .post<{ data: { conversation_id: string; enviadas: number } }>("/api/v1/grupos-painel/abordagem", {
          telefone: p.telefone,
          nome: p.nome,
          template_id: modeloId,
        })
        .then((r) => ({ pessoa: p, ...r.data })),
    onSuccess: (r) => {
      setEnviados((e) => ({ ...e, [r.pessoa.telefone_chave]: r.conversation_id }));
      toast.success(t("Abordagem enviada. A conversa já está no seu Inbox."));
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("Não foi possível enviar a abordagem agora.")),
  });

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (pessoas.data ?? []).filter((p) => {
      if (soQuemFala && p.mensagens_no_grupo === 0) return false;
      if (!mostrarAbordados && p.abordado_em && !enviados[p.telefone_chave]) return false;
      if (!termo) return true;
      return (p.nome ?? "").toLowerCase().includes(termo) || p.telefone.includes(termo.replace(/\D/g, "") || "§");
    });
  }, [pessoas.data, busca, soQuemFala, mostrarAbordados, enviados]);

  const modelo = (modelos.data ?? []).find((m) => m.id === modeloId);
  const total = pessoas.data?.length ?? 0;
  const jaAbordados = (pessoas.data ?? []).filter((p) => p.abordado_em).length;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold">{t("Abordagem no privado")}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "Quem está nos grupos e ainda não comprou. Clique em Abordar: a mensagem escolhida vai no privado da pessoa, com o nome dela, e a conversa abre no seu Inbox para você continuar.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium" htmlFor="modelo-abordagem">
            {t("Mensagem")}
          </label>
          <select
            id="modelo-abordagem"
            value={modeloId}
            onChange={(e) => escolher(e.target.value)}
            className="h-9 min-w-64 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">{t("Escolha uma resposta rápida")}</option>
            {(modelos.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
          <Link href="/app/templates" className="text-xs text-primary hover:underline">
            {t("Editar respostas rápidas")}
          </Link>
        </div>
        {modelo && (
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <p className="line-clamp-4 whitespace-pre-wrap">{modelo.body}</p>
            {(modelo.midias?.length ?? 0) > 0 && (
              <p className="mt-1 text-muted-foreground">
                + {modelo.midias?.length} {t("anexo(s)")}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Input className="h-9 w-64" placeholder={t("Buscar nome ou telefone")} value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={soQuemFala} onCheckedChange={setSoQuemFala} />
          {t("Só quem fala no grupo")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={mostrarAbordados} onCheckedChange={setMostrarAbordados} />
          {t("Mostrar quem já foi abordado")}
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {total} {t("sem compra")} · {jaAbordados} {t("já abordados")}
        </span>
      </div>

      {pessoas.isLoading ? (
        <Skeleton className="h-64" />
      ) : lista.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("Ninguém para abordar com esses filtros. Sincronize os grupos no Painel de vendas para atualizar os membros.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("Pessoa")}</th>
                <th className="px-3 py-2">{t("Grupo")}</th>
                <th className="px-3 py-2 text-right">{t("Mensagens no grupo")}</th>
                <th className="px-3 py-2">{t("Última mensagem")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.slice(0, 300).map((p) => {
                const conversa = enviados[p.telefone_chave];
                const enviando = abordar.isPending && abordar.variables?.telefone_chave === p.telefone_chave;
                return (
                  <tr key={p.telefone_chave}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{p.nome ?? t("Sem nome")}</p>
                      <p className="text-xs text-muted-foreground">+{p.telefone.replace(/\D/g, "")}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.grupos.join(", ")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.mensagens_no_grupo}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {p.ultima_mensagem ? new Date(p.ultima_mensagem).toLocaleDateString(tag) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {conversa ? (
                        <Link href={`/app/inbox?id=${conversa}`} className="text-xs text-primary hover:underline">
                          {t("Abrir conversa")}
                        </Link>
                      ) : p.abordado_em ? (
                        <Badge variant="neutral">
                          {t("Abordado em")} {new Date(p.abordado_em).toLocaleDateString(tag)}
                        </Badge>
                      ) : (
                        <Button size="sm" disabled={!modeloId || enviando} onClick={() => abordar.mutate(p)}>
                          <PaperPlaneTilt size={14} className="mr-1" aria-hidden />
                          {enviando ? t("Enviando…") : t("Abordar")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lista.length > 300 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("Mostrando os 300 primeiros. Use a busca para achar outros.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
