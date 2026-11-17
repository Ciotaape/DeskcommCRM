"use client";
/**
 * A tela da Visão geral: cartões no estilo dos painéis de mercado (status das
 * oportunidades, valor, conversão, funil, distribuição por etapas, tarefas,
 * atendimento e vendas por grupo). Os dados chegam prontos do servidor; os
 * filtros (período e funil) só mudam a URL.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import type { VisaoGeral } from "@/lib/visao-geral/servico";
import { cn } from "@/lib/utils";

const PALETA = ["#3B82F6", "#22D3EE", "#818CF8", "#A78BFA", "#2563EB", "#67E8F9", "#38BDF8", "#93C5FD", "#60A5FA", "#F472B6", "#FB7185", "#34D399"];
const COR_STATUS = { aberto: "#3B82F6", ganho: "#22D3EE", perdido: "#818CF8" } as const;

function Cartao({ titulo, sub, acao, children, className }: { titulo: string; sub?: string; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)}>
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{titulo}</h2>
          {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        {acao}
      </header>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}

function Legenda({ itens }: { itens: Array<{ cor: string; rotulo: string; valor: string }> }) {
  return (
    <ul className="space-y-1.5 text-xs">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex items-center gap-2">
          <span className="h-2.5 w-3.5 shrink-0 rounded-sm" style={{ background: i.cor }} />
          <span className="truncate text-muted-foreground">{i.rotulo}</span>
          <span className="ml-auto font-medium tabular-nums">{i.valor}</span>
        </li>
      ))}
    </ul>
  );
}

function Rosca({ dados, centro }: { dados: Array<{ nome: string; valor: number; cor: string }>; centro: string }) {
  const vazio = dados.every((d) => d.valor === 0);
  return (
    <div className="relative h-44 w-44 shrink-0">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={vazio ? [{ nome: "-", valor: 1, cor: "#334155" }] : dados}
            dataKey="valor"
            nameKey="nome"
            innerRadius="72%"
            outerRadius="100%"
            paddingAngle={vazio ? 0 : 2}
            stroke="none"
            isAnimationActive={false}
          >
            {(vazio ? [{ cor: "#334155" }] : dados).map((d, i) => (
              <Cell key={i} fill={d.cor} />
            ))}
          </Pie>
          {!vazio && <Tooltip formatter={(v) => String(v)} />}
        </PieChart>
      </ResponsiveContainer>
      <span className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums">{centro}</span>
    </div>
  );
}

export function VisaoGeralClient({ dados, de, ate }: { dados: VisaoGeral; de: string; ate: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const router = useRouter();
  const pathname = usePathname();
  const [carregando, iniciar] = useTransition();

  const reais = (c: number) => (c / 100).toLocaleString(tag, { style: "currency", currency: "BRL" });
  const pct = (n: number) => `${n.toLocaleString(tag, { maximumFractionDigits: 2 })}%`;

  const ir = (mudar: Record<string, string | null>) => {
    const q = new URLSearchParams({ de, ate, ...(dados.pipelineId ? { pipeline: dados.pipelineId } : {}) });
    for (const [k, v] of Object.entries(mudar)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    iniciar(() => router.push(`${pathname}?${q.toString()}`));
  };

  // O "agora" é lido uma vez, ao montar (render puro).
  const [agora] = useState(() => Date.now());
  const menosDias = (n: number) =>
    new Date(agora - n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const hoje = menosDias(0);
  const atalhos = [
    { rotulo: t("Hoje"), de: hoje, ate: hoje },
    { rotulo: t("7 dias"), de: menosDias(6), ate: hoje },
    { rotulo: t("30 dias"), de: menosDias(29), ate: hoje },
    { rotulo: t("Este mês"), de: `${hoje.slice(0, 8)}01`, ate: hoje },
    { rotulo: t("90 dias"), de: menosDias(89), ate: hoje },
  ];

  const s = dados.status;
  const statusRosca = [
    { nome: t("Aberto"), valor: s.aberto.quantidade, cor: COR_STATUS.aberto },
    { nome: t("Ganhou"), valor: s.ganho.quantidade, cor: COR_STATUS.ganho },
    { nome: t("Perdido"), valor: s.perdido.quantidade, cor: COR_STATUS.perdido },
  ];
  const valorBarras = [
    { nome: t("Aberto"), valor: s.aberto.valor_cents / 100, cor: COR_STATUS.aberto },
    { nome: t("Ganhou"), valor: s.ganho.valor_cents / 100, cor: COR_STATUS.ganho },
    { nome: t("Perdido"), valor: s.perdido.valor_cents / 100, cor: COR_STATUS.perdido },
  ];
  const receitaTotal = s.aberto.valor_cents + s.ganho.valor_cents + s.perdido.valor_cents;
  const maiorEtapa = Math.max(1, ...dados.funil.map((e) => e.quantidade));
  const etapasCor = dados.funil.map((e, i) => e.cor ?? PALETA[i % PALETA.length] ?? "#3B82F6");

  const seletorDePipeline = (
    <select
      value={dados.pipelineId ?? ""}
      onChange={(e) => ir({ pipeline: e.target.value || null })}
      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
      aria-label={t("Funil")}
    >
      <option value="">{t("Todos os funis")}</option>
      {dados.pipelines.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
        </option>
      ))}
    </select>
  );

  return (
    <div className={cn("flex flex-col gap-4 p-4 md:p-6", carregando && "opacity-60 transition-opacity")}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">{t("Visão geral")}</h1>
          <p className="text-sm text-muted-foreground">{t("Oportunidades criadas no período, funil, tarefas, atendimento e vendas.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {atalhos.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => ir({ de: a.de, ate: a.ate })}
              className={cn(
                "h-8 rounded-md border px-2.5 text-xs",
                a.de === de && a.ate === ate ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
              )}
            >
              {a.rotulo}
            </button>
          ))}
          <input type="date" value={de} max={ate} onChange={(e) => e.target.value && ir({ de: e.target.value })} className="h-8 rounded-md border border-border bg-background px-2 text-xs" aria-label={t("De")} />
          <span className="text-xs text-muted-foreground">–</span>
          <input type="date" value={ate} min={de} onChange={(e) => e.target.value && ir({ ate: e.target.value })} className="h-8 rounded-md border border-border bg-background px-2 text-xs" aria-label={t("Até")} />
          {seletorDePipeline}
        </div>
      </header>

      {/* Números rápidos */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { r: t("Oportunidades"), v: String(dados.total), href: "/app/kanban" },
          { r: t("Receita ganha"), v: reais(s.ganho.valor_cents), href: "/app/kanban" },
          { r: t("Contatos novos"), v: String(dados.atendimento.contatosNovos), href: "/app/contacts" },
          { r: t("Conversas abertas"), v: String(dados.atendimento.privadoAbertas), href: "/app/inbox" },
          { r: t("Aguardando resposta"), v: String(dados.atendimento.aguardandoResposta), href: "/app/inbox" },
          { r: t("Vendas Kiwify"), v: `${dados.vendasExternas.quantidade} · ${reais(dados.vendasExternas.valor_cents)}`, href: "/app/grupos?aba=painel" },
        ].map((k) => (
          <Link key={k.r} href={k.href} className="rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/60">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k.r}</p>
            <p className="mt-1 truncate text-xl font-semibold tabular-nums">{k.v}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao titulo={t("Status das oportunidades")} sub={t("Criadas no período")}>
          <div className="flex items-center gap-6">
            <Rosca dados={statusRosca} centro={String(dados.total)} />
            <div className="min-w-0 flex-1">
              <Legenda itens={statusRosca.map((x) => ({ cor: x.cor, rotulo: x.nome, valor: String(x.valor) }))} />
            </div>
          </div>
        </Cartao>

        <Cartao titulo={t("Valor das oportunidades")} sub={t("Soma do valor por status")}>
          <div className="h-36">
            <ResponsiveContainer>
              <BarChart data={valorBarras} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke="rgba(148,163,184,.15)" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `R$${v}`} />
                <YAxis type="category" dataKey="nome" tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(v) => reais(Number(v) * 100)} cursor={{ fill: "rgba(148,163,184,.08)" }} />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {valorBarras.map((b) => (
                    <Cell key={b.nome} fill={b.cor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">{t("Receita total")}</p>
          <p className="text-center text-lg font-semibold tabular-nums">{reais(receitaTotal)}</p>
        </Cartao>

        <Cartao titulo={t("Taxa de conversão")} sub={t("Ganhas ÷ criadas no período")}>
          <div className="flex flex-col items-center">
            <Rosca
              dados={[
                { nome: t("Ganhou"), valor: s.ganho.quantidade, cor: "#3B82F6" },
                { nome: t("Restante"), valor: Math.max(0, dados.total - s.ganho.quantidade), cor: "rgba(148,163,184,.18)" },
              ]}
              centro={pct(dados.conversao_pct)}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t("Receita ganha")}</p>
            <p className="text-lg font-semibold tabular-nums">{reais(s.ganho.valor_cents)}</p>
          </div>
        </Cartao>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo={t("Funil")} sub={t("Onde estão as oportunidades criadas no período")}>
          {dados.funil.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("Nenhum funil configurado.")}</p>
          ) : (
            <div className="max-h-[22rem] overflow-y-auto pr-1">
              <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-x-2 gap-y-1.5 text-xs">
                <span />
                <span className="text-center text-[10px] text-muted-foreground">{t("Cumulativo")}</span>
                <span className="text-center text-[10px] text-muted-foreground">{t("Próxima etapa")}</span>
                {dados.funil.map((e, i) => (
                  <FunilLinha
                    key={e.id}
                    nome={e.nome}
                    cor={etapasCor[i] ?? "#3B82F6"}
                    largura={(e.quantidade / maiorEtapa) * 100}
                    quantidade={e.quantidade}
                    valor={reais(e.valor_cents)}
                    ganho={e.ganho}
                    cumulativo={e.perdido ? "—" : pct(e.cumulativo_pct)}
                    proxima={e.proxima_pct === null ? "—" : pct(e.proxima_pct)}
                  />
                ))}
              </div>
            </div>
          )}
        </Cartao>

        <Cartao titulo={t("Distribuição por etapas")} sub={t("Quantidade e valor em cada etapa")}>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Rosca
              dados={dados.funil.map((e, i) => ({ nome: e.nome, valor: e.quantidade, cor: etapasCor[i] ?? "#3B82F6" }))}
              centro={String(dados.funil.reduce((a, e) => a + e.quantidade, 0))}
            />
            <div className="max-h-56 min-w-0 flex-1 overflow-y-auto pr-1">
              <Legenda
                itens={dados.funil.map((e, i) => ({
                  cor: etapasCor[i] ?? "#3B82F6",
                  rotulo: e.nome,
                  valor: `${e.quantidade} · ${reais(e.valor_cents)}`,
                }))}
              />
            </div>
          </div>
        </Cartao>
      </div>

      <Cartao titulo={t("Oportunidades por dia")} sub={t("Criadas e ganhas em cada dia do período")}>
        <div className="h-48">
          <ResponsiveContainer>
            <AreaChart data={dados.serieDiaria.map((d) => ({ ...d, rotulo: d.dia.slice(8, 10) + "/" + d.dia.slice(5, 7) }))}>
              <defs>
                <linearGradient id="vgCriados" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,.15)" />
              <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
              <Tooltip />
              <Area type="monotone" dataKey="criados" name={t("Criadas")} stroke="#3B82F6" fill="url(#vgCriados)" isAnimationActive={false} />
              <Area type="monotone" dataKey="ganhos" name={t("Ganhas")} stroke="#22D3EE" fill="transparent" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Cartao>

      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao
          titulo={t("Tarefas")}
          sub={`${dados.tarefas.abertas} ${t("abertas")} · ${dados.tarefas.atrasadas} ${t("atrasadas")}`}
          acao={<Link href="/app/tasks" className="text-xs text-primary hover:underline">{t("Ver todas")}</Link>}
        >
          {dados.tarefas.proximas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("Nenhuma tarefa pendente.")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {dados.tarefas.proximas.map((tf) => {
                const atrasada = !!tf.prazo && new Date(tf.prazo).getTime() < agora;
                return (
                  <li key={tf.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate">{tf.titulo}</span>
                    <span className={cn("shrink-0 text-xs tabular-nums", atrasada ? "text-destructive" : "text-muted-foreground")}>
                      {tf.prazo ? new Date(tf.prazo).toLocaleDateString(tag, { timeZone: "America/Sao_Paulo" }) : t("sem prazo")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>

        <Cartao titulo={t("Atendimento agora")} acao={<Link href="/app/inbox" className="text-xs text-primary hover:underline">{t("Abrir Inbox")}</Link>}>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { r: t("Privado em aberto"), v: dados.atendimento.privadoAbertas },
              { r: t("Aguardando resposta"), v: dados.atendimento.aguardandoResposta },
              { r: t("Grupos"), v: dados.atendimento.grupos },
            ].map((k) => (
              <div key={k.r}>
                <p className="text-2xl font-semibold tabular-nums">{k.v}</p>
                <p className="text-[11px] text-muted-foreground">{k.r}</p>
              </div>
            ))}
          </div>
        </Cartao>

        <Cartao
          titulo={t("Vendas da Kiwify por grupo")}
          sub={`${dados.vendasExternas.quantidade} ${t("vendas pagas no período")}`}
          acao={<Link href="/app/grupos?aba=painel" className="text-xs text-primary hover:underline">{t("Painel de vendas")}</Link>}
        >
          {dados.vendasExternas.porGrupo.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("Nenhuma venda no período.")}</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {dados.vendasExternas.porGrupo.map((g) => {
                const max = dados.vendasExternas.porGrupo[0]?.quantidade || 1;
                return (
                  <li key={g.codigo} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
                    <span className="truncate text-muted-foreground">{g.codigo}</span>
                    <span className="h-2 rounded-full bg-muted">
                      <span className="block h-2 rounded-full bg-primary" style={{ width: `${(g.quantidade / max) * 100}%` }} />
                    </span>
                    <span className="tabular-nums">
                      {g.quantidade} · {reais(g.valor_cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
      </div>
    </div>
  );
}

function FunilLinha(p: {
  nome: string;
  cor: string;
  largura: number;
  quantidade: number;
  valor: string;
  ganho: boolean;
  cumulativo: string;
  proxima: string;
}) {
  return (
    <>
      <div className="relative h-7 overflow-hidden rounded-sm bg-muted/60" title={`${p.nome}: ${p.quantidade}`}>
        <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.max(p.largura, 2)}%`, background: p.cor }} />
        <span className="relative flex h-full items-center gap-2 truncate px-2 text-[11px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          {p.nome}
          {p.ganho ? " ✓" : ""}
          <span className="font-normal opacity-90">
            {p.quantidade} · {p.valor}
          </span>
        </span>
      </div>
      <span className="rounded-sm bg-muted/60 py-1 text-center tabular-nums">{p.cumulativo}</span>
      <span className="rounded-sm bg-muted/60 py-1 text-center tabular-nums">{p.proxima}</span>
    </>
  );
}
