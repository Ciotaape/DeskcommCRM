import { describe, expect, it } from "vitest";

import { codigoDoGrupo, dataDaKiwify, reaisParaCentavos, vendaDaPlanilha, vendaDoWebhook } from "./kiwify";
import { chaveDeTelefone } from "./telefone";

describe("chaveDeTelefone", () => {
  it("casa o celular com e sem o nono dígito", () => {
    expect(chaveDeTelefone("+5592993933434")).toBe(chaveDeTelefone("559293933434"));
    expect(chaveDeTelefone("(92) 99393-3434")).toBe("559293933434");
  });
  it("número do RS sem DDI não vira DDI", () => {
    expect(chaveDeTelefone("55991234567")).toBe("555591234567");
  });
  it("lixo não vira chave", () => {
    expect(chaveDeTelefone("123")).toBeNull();
    expect(chaveDeTelefone(null)).toBeNull();
  });
});

describe("codigoDoGrupo", () => {
  it("normaliza o src e corrige link colado duas vezes", () => {
    expect(codigoDoGrupo("grupo10")).toBe("grupo10");
    expect(codigoDoGrupo("grupo1src=grupo9")).toBe("grupo9");
    expect(codigoDoGrupo("grupo9](https://pay.kiwify.com.br/X?src=grupo9")).toBe("grupo9");
    expect(codigoDoGrupo("Grupo 03")).toBe("grupo3");
    expect(codigoDoGrupo("youtube")).toBe("youtube");
    expect(codigoDoGrupo("")).toBeNull();
  });
});

describe("valores e datas", () => {
  it("converte reais para centavos", () => {
    expect(reaisParaCentavos("197.90")).toBe(19790);
    expect(reaisParaCentavos("1.197,90")).toBe(119790);
    expect(reaisParaCentavos("99,9")).toBe(9990);
  });
  it("lê data brasileira como horário de Brasília", () => {
    expect(dataDaKiwify("16/11/2026 17:17:56")).toBe("2026-11-16T20:17:56.000Z");
    expect(dataDaKiwify("2026-11-16 17:17")).toBe("2026-11-16T20:17:00.000Z");
  });
});

describe("vendaDaPlanilha", () => {
  it("lê a linha exportada", () => {
    const v = vendaDaPlanilha({
      "ID da venda": "PLOfIUd",
      Status: "paid",
      Produto: "Mapa dos Fornecedores",
      Cliente: "Fulano",
      Email: "Fulano@Ex.com",
      Celular: "+5592993933434",
      "Preço base do produto": "197.90",
      "Valor líquido": "177.62",
      Moeda: "BRL",
      "Tracking src": "grupo1src=grupo8",
      "Data de Criação": "16/11/2026 17:17:56",
    });
    expect(v).toMatchObject({
      id_externo: "PLOfIUd",
      status: "paga",
      cliente_email: "fulano@ex.com",
      telefone_chave: "559293933434",
      valor_cents: 19790,
      valor_liquido_cents: 17762,
      codigo_grupo: "grupo8",
    });
  });
});

describe("vendaDoWebhook", () => {
  it("lê compra aprovada e reembolso", () => {
    const base = {
      order_id: "abc-123",
      Product: { product_name: "Mapa dos Fornecedores" },
      Customer: { full_name: "Fulana", email: "a@b.com", mobile: "+5511987654321" },
      Commissions: { product_base_price: 19790, my_commission: 17762, currency: "BRL" },
      TrackingParameters: { src: "grupo10" },
      approved_date: "2026-11-16 17:17",
    };
    expect(vendaDoWebhook({ ...base, order_status: "paid", webhook_event_type: "order_approved" })).toMatchObject({
      id_externo: "abc-123",
      status: "paga",
      valor_cents: 19790,
      codigo_grupo: "grupo10",
      telefone_chave: "551187654321",
    });
    expect(vendaDoWebhook({ ...base, order_status: "refunded", webhook_event_type: "order_refunded" })?.status).toBe("reembolsada");
    expect(vendaDoWebhook({ ...base, order_status: "chargedback" })?.status).toBe("chargeback");
  });
  it("sem id do pedido não é venda", () => {
    expect(vendaDoWebhook({ hello: "world" })).toBeNull();
  });
});
