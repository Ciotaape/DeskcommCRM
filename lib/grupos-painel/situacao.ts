/**
 * A etiqueta que aparece em cima de quem fala num grupo: comprou o produto,
 * renovou, ou ainda não é cliente. Puro — a tela e o servidor usam o mesmo.
 */
export const SITUACOES_DO_CLIENTE = ["nao_cliente", "comprou", "renovou"] as const;
export type SituacaoDoCliente = (typeof SITUACOES_DO_CLIENTE)[number];

export interface ClienteConhecido {
  situacao: SituacaoDoCliente;
  /** `manual` quando alguém marcou à mão — vence o que as vendas dizem. */
  origem: "vendas" | "manual";
  compras: number;
  valor_cents: number;
  ultima_compra: string | null;
}

export const ROTULO_DA_SITUACAO: Record<SituacaoDoCliente, string> = {
  nao_cliente: "Ainda não é cliente",
  comprou: "Comprou",
  renovou: "Renovou",
};
