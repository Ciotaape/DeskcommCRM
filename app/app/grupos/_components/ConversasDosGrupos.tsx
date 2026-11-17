"use client";
import type { ComponentProps } from "react";

import { InboxLayout } from "@/components/inbox/InboxLayout";
import { ProvedorDeParticipantes } from "@/components/inbox/grupos/ProvedorDeParticipantes";

/** O Inbox dos grupos: a mesma caixa, só com grupos, e cada participante com a etiqueta de cliente. */
export function ConversasDosGrupos(props: Omit<NonNullable<ComponentProps<typeof InboxLayout>>, "modo">) {
  return (
    <ProvedorDeParticipantes>
      <InboxLayout {...props} modo="grupos" />
    </ProvedorDeParticipantes>
  );
}
