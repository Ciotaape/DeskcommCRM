import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { carregarModulosDaLateral } from "@/app/actions/inbox/modulosDaLateral";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { cn } from "@/lib/utils";
import { ConversasDosGrupos } from "./_components/ConversasDosGrupos";
import { MensagensProgramadas } from "./_components/MensagensProgramadas";
import { PainelDeGrupos } from "./_components/PainelDeGrupos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grupos" };

const ABAS = ["conversas", "painel", "programadas"] as const;
type Aba = (typeof ABAS)[number];

/**
 * A aba Grupos: as conversas dos grupos do WhatsApp (só aqui — o Inbox ficou
 * com o privado), o painel de vendas por grupo e as mensagens programadas.
 * Conversas é para quem atende (agent+); painel e programadas, para gerente.
 */
export default async function GruposPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; id?: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.agent) redirect("/403");
  const gerente = ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const t = (texto: string) => traduzir(texto, user.idioma);
  const { aba: abaNaUrl, id } = await searchParams;
  const pedida: Aba = (ABAS as readonly string[]).includes(abaNaUrl ?? "") ? (abaNaUrl as Aba) : "conversas";
  const aba: Aba = gerente ? pedida : "conversas";

  const rotulos: Record<Aba, string> = {
    conversas: t("Conversas"),
    painel: t("Painel de vendas"),
    programadas: t("Mensagens programadas"),
  };

  const abas = (
    <nav className="flex shrink-0 gap-1 border-b border-border px-3 pt-2" aria-label={t("Grupos")}>
      {ABAS.filter((a) => gerente || a === "conversas").map((a) => (
        <Link
          key={a}
          href={`/app/grupos?aba=${a}`}
          aria-current={a === aba ? "page" : undefined}
          className={cn(
            "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            a === aba ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulos[a]}
        </Link>
      ))}
    </nav>
  );

  if (aba === "conversas") {
    const painelRecolhido = (await cookies()).get("inbox_painel_recolhido")?.value === "1";
    const { modulos } = await carregarModulosDaLateral();
    return (
      <div className="flex h-full min-h-0 flex-col">
        {abas}
        <div className="min-h-0 flex-1">
          <ConversasDosGrupos
            initialSelectedId={id ?? null}
            painelRecolhidoInicial={painelRecolhido}
            modulosDaLateral={modulos}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {abas}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6">
        {aba === "painel" ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t(
                "Os grupos do WhatsApp que você administra: quantos membros têm, quantos compraram e quanto cada um vende. As vendas chegam da Kiwify pelo link com ?src= de cada grupo e pelo telefone de quem está no grupo.",
              )}
            </p>
            <PainelDeGrupos podeConectar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin} />
          </>
        ) : (
          <MensagensProgramadas />
        )}
      </div>
    </div>
  );
}
