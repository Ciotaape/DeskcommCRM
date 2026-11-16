import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { PainelDeGrupos } from "./_components/PainelDeGrupos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grupos" };

export default async function GruposPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Grupos")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Os grupos do WhatsApp que você administra: quantos membros têm, quantos compraram e quanto cada um vende. As vendas chegam da Kiwify pelo link com ?src= de cada grupo e pelo telefone de quem está no grupo.",
          )}
        </p>
      </header>
      <PainelDeGrupos podeConectar={ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin} />
    </div>
  );
}
