"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, ChevronLeft, ChevronRight, CircleDollarSign, Search, SlidersHorizontal } from "lucide-react";
import { brl } from "@/domain/finance";
import type { Installment } from "@/domain/types";
import { useStore } from "./store";
import { Badge } from "./ui";

type BoletoRow = { installment: Installment; parentId: string; kind: "sale" | "expense"; direction: "receive" | "pay"; name: string; reference: string };
const today = "2026-08-11";
const dayDiff = (date: string) => Math.ceil((new Date(`${date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);

export function BoletosView() {
  const { state, markInstallment } = useStore();
  const [scope, setScope] = useState<"all" | "receive" | "pay">("all");
  const [range, setRange] = useState<"all" | "overdue" | "today" | "7" | "30" | "paid">("all");
  const [query, setQuery] = useState("");
  const rows = useMemo<BoletoRow[]>(() => [
    ...state.sales.flatMap((sale) => sale.installments.filter((item) => item.method === "Boleto").map((installment) => ({ installment, parentId: sale.id, kind: "sale" as const, direction: "receive" as const, name: state.customers.find((customer) => customer.id === sale.customerId)?.company || "Cliente", reference: `Venda #${sale.number} · Parcela ${installment.number}/${installment.total}` }))),
    ...state.expenses.flatMap((expense) => expense.installments.filter((item) => item.method === "Boleto").map((installment) => ({ installment, parentId: expense.id, kind: "expense" as const, direction: "pay" as const, name: expense.supplier, reference: `${expense.description} · Parcela ${installment.number}/${installment.total}` }))),
  ].sort((a, b) => a.installment.dueDate.localeCompare(b.installment.dueDate)), [state]);
  const pending = rows.filter((row) => row.installment.status !== "paid" && row.installment.status !== "cancelled");
  const overdue = pending.filter((row) => dayDiff(row.installment.dueDate) < 0);
  const dueToday = pending.filter((row) => dayDiff(row.installment.dueDate) === 0);
  const nextSeven = pending.filter((row) => dayDiff(row.installment.dueDate) >= 0 && dayDiff(row.installment.dueDate) <= 7);
  const nextThirty = pending.filter((row) => dayDiff(row.installment.dueDate) >= 0 && dayDiff(row.installment.dueDate) <= 30);
  const visible = rows.filter((row) => {
    if (scope !== "all" && row.direction !== scope) return false;
    if (!(row.name + row.reference).toLowerCase().includes(query.toLowerCase())) return false;
    const diff = dayDiff(row.installment.dueDate), paid = row.installment.status === "paid";
    if (range === "overdue") return !paid && diff < 0;
    if (range === "today") return !paid && diff === 0;
    if (range === "7") return !paid && diff >= 0 && diff <= 7;
    if (range === "30") return !paid && diff >= 0 && diff <= 30;
    if (range === "paid") return paid;
    return true;
  });
  return <>
    <section className="boleto-metrics">
      <BoletoMetric label="Atrasados" rows={overdue} icon={AlertTriangle} active={range === "overdue"} danger onClick={() => setRange("overdue")}/>
      <BoletoMetric label="Vencem hoje" rows={dueToday} icon={CalendarClock} active={range === "today"} onClick={() => setRange("today")}/>
      <BoletoMetric label="Próximos 7 dias" rows={nextSeven} icon={CalendarClock} active={range === "7"} onClick={() => setRange("7")}/>
      <BoletoMetric label="Próximos 30 dias" rows={nextThirty} icon={CircleDollarSign} active={range === "30"} onClick={() => setRange("30")}/>
    </section>
    <div className="boleto-toolbar"><div className="segmented"><button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>Todos</button><button className={scope === "receive" ? "active" : ""} onClick={() => setScope("receive")}>A receber</button><button className={scope === "pay" ? "active" : ""} onClick={() => setScope("pay")}>A pagar</button></div><div className="input-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar boleto..."/></div><button className="secondary"><SlidersHorizontal size={16}/>Mais filtros</button></div>
    <div className="panel boleto-calendar-head"><button><ChevronLeft/></button><div><strong>Agosto de 2026</strong><span>{pending.length} boletos pendentes</span></div><button><ChevronRight/></button></div>
    <div className="panel table-panel boleto-table"><table><thead><tr><th>Tipo</th><th>Cliente / fornecedor</th><th>Referência</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th/></tr></thead><tbody>{visible.map((row) => { const diff = dayDiff(row.installment.dueDate), paid = row.installment.status === "paid", late = !paid && diff < 0; return <tr key={row.installment.id}><td><Badge tone={row.direction === "receive" ? "success" : "warning"}>{row.direction === "receive" ? "A receber" : "A pagar"}</Badge></td><td><strong>{row.name}</strong></td><td>{row.reference}</td><td><div className="due-date"><strong>{new Date(`${row.installment.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</strong><span className={late ? "negative-text" : ""}>{paid ? `Baixado em ${new Date(`${row.installment.paidAt}T12:00:00`).toLocaleDateString("pt-BR")}` : late ? `${Math.abs(diff)} ${Math.abs(diff) === 1 ? "dia" : "dias"} em atraso` : diff === 0 ? "Vence hoje" : `Vence em ${diff} ${diff === 1 ? "dia" : "dias"}`}</span></div></td><td><strong>{brl(row.installment.amountCents)}</strong></td><td><Badge tone={paid ? "success" : late ? "danger" : "warning"}>{paid ? (row.direction === "receive" ? "Recebido" : "Pago") : late ? "Atrasado" : "Pendente"}</Badge></td><td>{!paid && <button className="check-action boleto-check" title={row.direction === "receive" ? "Marcar como recebido" : "Marcar como pago"} onClick={() => markInstallment(row.kind, row.parentId, row.installment.id)}><Check size={15}/><span>Dar baixa</span></button>}</td></tr>})}</tbody></table>{visible.length === 0 && <div className="boleto-empty">Nenhum boleto encontrado para este filtro.</div>}<div className="table-footer">{visible.length} boletos encontrados <span>Baixas manuais atualizam o fluxo de caixa</span></div></div>
  </>;
}

function BoletoMetric({ label, rows, icon: Icon, active, danger, onClick }: { label: string; rows: BoletoRow[]; icon: React.ElementType; active: boolean; danger?: boolean; onClick: () => void }) {
  return <button className={`${active ? "active" : ""} ${danger ? "danger" : ""}`} onClick={onClick}><Icon/><span>{label}</span><strong>{rows.length}</strong><small>{brl(rows.reduce((sum, row) => sum + row.installment.amountCents, 0))}</small></button>;
}
