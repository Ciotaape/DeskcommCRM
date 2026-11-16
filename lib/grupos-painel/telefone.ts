/**
 * Chave de cruzamento de telefone entre a venda (Kiwify) e o membro do grupo
 * (WhatsApp).
 *
 * O mesmo cliente aparece de dois jeitos: a Kiwify grava o celular digitado no
 * checkout (`+5592993933434`, com o nono dígito) e o WhatsApp de conta antiga
 * devolve o número sem ele (`559293933434`). Comparar os dígitos crus perderia
 * esse cliente. No Brasil a chave é DDI + DDD + os 8 últimos dígitos; fora do
 * Brasil, os dígitos inteiros.
 */
export function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

export function chaveDeTelefone(valor: string | null | undefined): string | null {
  let d = somenteDigitos(valor);
  if (d.length < 8) return null;
  // Número brasileiro sem DDI (10 ou 11 dígitos). Com DDI ele teria 12 ou 13,
  // então mesmo o DDD 55 (RS) sem DDI cai aqui sem ambiguidade.
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    return `55${ddd}${d.slice(-8)}`;
  }
  return d;
}
