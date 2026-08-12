import { describe, expect, it } from "vitest";
import { calculateSale, dashboardMetrics, splitInstallments } from "./finance";
import type { Sale } from "./types";

const sale: Sale = { id:"1", number:"1", date:"2026-08-01", customerId:"c", sellerId:"s", notes:"", createdAt:"",
  items:[{ id:"i", productId:"p", productNameSnapshot:"AX", productSkuSnapshot:"AX", quantity:1, unitSalePriceCents:5_000_000, unitCostAtSaleCents:2_500_000, discountCents:0 }],
  discountCents:500_000, commissionType:"percentage", commissionPercentage:10, commissionFixedCents:0,
  shippingCents:150_000, feesCents:50_000, otherCostsCents:0, installments:[] };

describe("finance", () => {
  it("calcula lucro sem ponto flutuante monetário", () => expect(calculateSale(sale).profitCents).toBe(1_350_000));
  it("distribui centavos sem perder valor", () => expect(splitInstallments(10_000_001, 3, "2026-08-10", "Boleto").reduce((s,x)=>s+x.amountCents,0)).toBe(10_000_001));
  it("preserva o custo congelado no item", () => expect(calculateSale(sale).productsCostCents).toBe(2_500_000));
  it("ignora vendas canceladas nos indicadores", () => expect(dashboardMetrics([{...sale,status:"cancelled"}],[],0).netCents).toBe(0));
});
