import type { Expense, Installment, Sale, SaleItem } from "./types";

export const brl = (cents: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL", minimumFractionDigits: 2,
}).format(cents / 100);

export const shortBrl = (cents: number) => Math.abs(cents) >= 1_000_000
  ? `R$ ${(cents / 100_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
  : brl(cents);

export const toCents = (value: string | number) => {
  if (typeof value === "number") return Math.round(value * 100);
  const normalized = value.replace(/[^\d,-]/g, "").replace(".", "").replace(",", ".");
  return Math.round((Number(normalized) || 0) * 100);
};

export function calculateItem(item: SaleItem) {
  const grossCents = item.unitSalePriceCents * item.quantity;
  const netCents = grossCents - item.discountCents;
  const costCents = item.unitCostAtSaleCents * item.quantity;
  const profitCents = netCents - costCents;
  return { grossCents, netCents, costCents, profitCents, margin: netCents ? (profitCents / netCents) * 100 : 0 };
}

export function calculateSale(sale: Sale) {
  const items = sale.items.map(calculateItem);
  const grossCents = items.reduce((sum, item) => sum + item.grossCents, 0);
  const itemDiscountsCents = items.reduce((sum, item) => sum + (item.grossCents - item.netCents), 0);
  const discountCents = itemDiscountsCents + sale.discountCents;
  const netCents = grossCents - discountCents;
  const productsCostCents = items.reduce((sum, item) => sum + item.costCents, 0);
  const commissionCents = sale.commissionType === "percentage"
    ? Math.round(netCents * sale.commissionPercentage / 100) : sale.commissionFixedCents;
  const grossProfitCents = netCents - productsCostCents;
  const profitCents = grossProfitCents - commissionCents - sale.shippingCents - sale.feesCents - sale.otherCostsCents;
  return { grossCents, discountCents, netCents, productsCostCents, commissionCents, grossProfitCents, profitCents,
    shippingCents: sale.shippingCents, feesCents: sale.feesCents, otherCostsCents: sale.otherCostsCents,
    margin: netCents ? (profitCents / netCents) * 100 : 0 };
}

export function splitInstallments(totalCents: number, count: number, firstDueDate: string, method: Installment["method"]): Installment[] {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const first = new Date(`${firstDueDate}T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const due = new Date(first); due.setMonth(first.getMonth() + index);
    return { id: crypto.randomUUID(), number: index + 1, total: count, amountCents: base + (index < remainder ? 1 : 0),
      dueDate: due.toISOString().slice(0, 10), method, status: "pending" };
  });
}

export const paidTotal = (installments: Installment[]) => installments
  .filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amountCents, 0);
export const pendingTotal = (installments: Installment[]) => installments
  .filter((item) => item.status === "pending" || item.status === "overdue").reduce((sum, item) => sum + item.amountCents, 0);

export function dashboardMetrics(sales: Sale[], expenses: Expense[], openingBalanceCents: number) {
  const activeSales = sales.filter(sale => sale.status !== "cancelled");
  const saleTotals = activeSales.map(calculateSale);
  const grossCents = saleTotals.reduce((s, x) => s + x.grossCents, 0);
  const netCents = saleTotals.reduce((s, x) => s + x.netCents, 0);
  const productsCostCents = saleTotals.reduce((s, x) => s + x.productsCostCents, 0);
  const grossProfitCents = saleTotals.reduce((s, x) => s + x.grossProfitCents, 0);
  const saleProfitCents = saleTotals.reduce((s, x) => s + x.profitCents, 0);
  const receivedCents = activeSales.reduce((s, x) => s + paidTotal(x.installments), 0);
  const receivableCents = activeSales.reduce((s, x) => s + pendingTotal(x.installments), 0);
  const expenseTotalCents = expenses.reduce((s, x) => s + x.totalCents, 0);
  const paidCents = expenses.reduce((s, x) => s + paidTotal(x.installments), 0);
  const payableCents = expenses.reduce((s, x) => s + pendingTotal(x.installments), 0);
  return { grossCents, netCents, receivedCents, expenseTotalCents, productsCostCents, grossProfitCents,
    netProfitCents: saleProfitCents - expenseTotalCents, receivableCents, payableCents,
    cashBalanceCents: openingBalanceCents + receivedCents - paidCents };
}
