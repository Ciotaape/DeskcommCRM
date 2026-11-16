/**
 * Tradução de venda da Kiwify (webhook e planilha exportada) para a linha de
 * `vendas_externas`.
 *
 * O payload do webhook da Kiwify não tem contrato tipado público estável, então
 * a leitura é defensiva: cada campo é procurado nos nomes conhecidos e o que
 * não vier fica `null`. O corpo inteiro vai para `payload` — se um campo novo
 * importar amanhã, ele está guardado.
 */
import { chaveDeTelefone, somenteDigitos } from "./telefone";

export type StatusDaVenda = "paga" | "reembolsada" | "chargeback" | "recusada" | "pendente";

export interface VendaNormalizada {
  id_externo: string;
  status: StatusDaVenda;
  produto: string | null;
  cliente_nome: string | null;
  cliente_email: string | null;
  cliente_telefone: string | null;
  telefone_chave: string | null;
  valor_cents: number | null;
  valor_liquido_cents: number | null;
  moeda: string;
  origem_src: string | null;
  codigo_grupo: string | null;
  comprado_em: string | null;
}

/**
 * `?src=grupo10` vira `grupo10`. Links colados duas vezes chegam como
 * `grupo1src=grupo9` (medido na planilha real: 54 vendas) — vale o ÚLTIMO
 * `grupoN`, que é o do link que a pessoa clicou.
 */
export function codigoDoGrupo(src: string | null | undefined): string | null {
  const s = (src ?? "").trim().toLowerCase();
  if (!s) return null;
  const grupos = [...s.matchAll(/grupo\s*0*(\d+)/g)];
  const ultimo = grupos.at(-1)?.[1];
  if (ultimo) return `grupo${Number(ultimo)}`;
  const limpo = s.replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return limpo || null;
}

function texto(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Reais (ponto ou vírgula decimal) para centavos. */
export function reaisParaCentavos(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  const s = texto(v);
  if (!s) return null;
  // Vírgula presente = formato brasileiro (`1.197,90`): ponto é milhar.
  // Sem vírgula = formato da Kiwify (`197.90`): ponto é decimal.
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function statusDaKiwify(orderStatus: string | null, evento: string | null): StatusDaVenda {
  const s = `${orderStatus ?? ""} ${evento ?? ""}`.toLowerCase();
  if (/chargeback|chargedback/.test(s)) return "chargeback";
  if (/refund|reembols/.test(s)) return "reembolsada";
  if (/refused|recusad/.test(s)) return "recusada";
  if (/\bpaid\b|approved|aprovad|renewed|renovad/.test(s)) return "paga";
  return "pendente";
}

/** Data `dd/mm/aaaa hh:mm:ss` (planilha) ou ISO/`aaaa-mm-dd hh:mm` (webhook) → ISO UTC (hora de Brasília). */
export function dataDaKiwify(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, dd, mm, aaaa, hh = "00", mi = "00", ss = "00"] = br;
    return new Date(`${aaaa}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`).toISOString();
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (iso && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const [, aaaa, mm, dd, hh, mi, ss = "00"] = iso;
    return new Date(`${aaaa}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`).toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Corpo do webhook da Kiwify → venda. `null` quando não há id do pedido. */
export function vendaDoWebhook(corpo: unknown): VendaNormalizada | null {
  const raiz = obj(corpo);
  // Alguns envios embrulham o pedido em `order`.
  const o = Object.keys(obj(raiz.order)).length ? obj(raiz.order) : raiz;
  const id = texto(o.order_id) ?? texto(o.order_ref) ?? texto(o.id);
  if (!id) return null;
  const produto = obj(o.Product);
  const cliente = obj(o.Customer);
  const comissao = obj(o.Commissions);
  const tracking = obj(o.TrackingParameters);
  const src = texto(tracking.src) ?? texto(tracking.utm_source);
  const telefone = texto(cliente.mobile) ?? texto(cliente.phone);
  const centavos = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
    const s = texto(v);
    return s && /^\d+$/.test(s) ? Number(s) : null;
  };
  return {
    id_externo: id,
    status: statusDaKiwify(texto(o.order_status), texto(o.webhook_event_type)),
    produto: texto(produto.product_name),
    cliente_nome: texto(cliente.full_name) ?? texto(cliente.first_name),
    cliente_email: texto(cliente.email)?.toLowerCase() ?? null,
    cliente_telefone: telefone ? somenteDigitos(telefone) : null,
    telefone_chave: chaveDeTelefone(telefone),
    valor_cents: centavos(comissao.product_base_price) ?? centavos(comissao.charge_amount),
    valor_liquido_cents: centavos(comissao.my_commission),
    moeda: texto(comissao.product_base_price_currency) ?? texto(comissao.currency) ?? "BRL",
    origem_src: src,
    codigo_grupo: codigoDoGrupo(src),
    comprado_em: dataDaKiwify(o.approved_date) ?? dataDaKiwify(o.created_at),
  };
}

/** Linha da planilha "Vendas → Exportar" da Kiwify → venda. */
export function vendaDaPlanilha(linha: Record<string, string>): VendaNormalizada | null {
  const id = texto(linha["ID da venda"]);
  if (!id) return null;
  const telefone = texto(linha["Celular"]);
  const src = texto(linha["Tracking src"]) ?? texto(linha["Tracking utm_source"]);
  return {
    id_externo: id,
    status: statusDaKiwify(texto(linha["Status"]), null),
    produto: texto(linha["Produto"]),
    cliente_nome: texto(linha["Cliente"]),
    cliente_email: texto(linha["Email"])?.toLowerCase() ?? null,
    cliente_telefone: telefone ? somenteDigitos(telefone) : null,
    telefone_chave: chaveDeTelefone(telefone),
    valor_cents: reaisParaCentavos(linha["Preço base do produto"]),
    valor_liquido_cents: reaisParaCentavos(linha["Valor líquido"]),
    moeda: texto(linha["Moeda"]) ?? "BRL",
    origem_src: src,
    codigo_grupo: codigoDoGrupo(src),
    comprado_em: dataDaKiwify(linha["Data de Criação"]),
  };
}
