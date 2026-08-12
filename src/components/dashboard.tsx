"use client";
import { ArrowRight, Banknote, Boxes, CircleDollarSign, CreditCard, HandCoins, PackageCheck, Receipt, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import { useStore } from "./store";
import { brl, calculateSale, dashboardMetrics } from "@/domain/finance";
import { Badge, MetricCard } from "./ui";

const bars=[32,44,39,58,52,68,62,81,76,88,73,94]; const expenseBars=[28,31,35,41,38,45,48,51,54,58,47,62];
export function DashboardView({onNavigate}:{onNavigate:(id:string)=>void}){
 const {state}=useStore(); const activeSales=state.sales.filter(s=>s.status!=="cancelled"); const monthSales=activeSales.filter(s=>s.date.startsWith("2026-08")); const monthExpenses=state.expenses.filter(e=>e.date.startsWith("2026-08")); const m=dashboardMetrics(monthSales,monthExpenses,state.openingBalanceCents);
 const recent=activeSales.slice(0,4); const due=activeSales.flatMap(s=>s.installments.map(i=>({...i,sale:s}))).filter(x=>x.status==="pending"||x.status==="overdue").slice(0,4);
 return <>
  <div className="welcome-row"><div><span className="eyebrow">TERÇA-FEIRA, 11 DE AGOSTO</span><h2>Bom dia, Thiago <span>👋</span></h2><p>Aqui está o resumo financeiro da Astro neste mês.</p></div><button className="primary" onClick={()=>onNavigate("new-sale")}><ShoppingBag size={17}/>Registrar venda</button></div>
  <section className="metrics-grid">
   <MetricCard label="Faturamento bruto" value={m.grossCents} change={12.4} icon={TrendingUp}/><MetricCard label="Faturamento líquido" value={m.netCents} change={10.8} icon={CircleDollarSign} tone="cyan"/>
   <MetricCard label="Total recebido" value={m.receivedCents} change={8.2} icon={HandCoins} tone="green"/><MetricCard label="Total de despesas" value={m.expenseTotalCents} change={-4.1} icon={Receipt} tone="red"/>
   <MetricCard label="Custo dos equipamentos" value={m.productsCostCents} change={6.3} icon={Boxes} tone="purple"/><MetricCard label="Lucro bruto" value={m.grossProfitCents} change={14.7} icon={PackageCheck} tone="indigo"/>
   <MetricCard label="Lucro líquido" value={m.netProfitCents} change={9.6} icon={Banknote} tone="green"/><MetricCard label="Saldo de caixa" value={m.cashBalanceCents} change={5.2} icon={Wallet} tone="navy"/>
  </section>
  <section className="dashboard-grid">
   <article className="panel chart-panel"><div className="panel-head"><div><h3>Receitas x despesas</h3><p>Comparativo mensal de movimentações</p></div><select><option>Este ano</option><option>Últimos 6 meses</option></select></div>
    <div className="chart-legend"><span><i className="blue-dot"/>Receitas</span><span><i className="gray-dot"/>Despesas</span></div>
    <div className="bar-chart">{bars.map((h,i)=><div className="bar-month" key={i}><div className="bar-pair"><i style={{height:`${h}%`}}/><i style={{height:`${expenseBars[i]}%`}}/></div><span>{["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][i]}</span></div>)}</div>
   </article>
   <article className="panel result-panel"><div className="panel-head"><div><h3>Resultado do mês</h3><p>Composição do faturamento líquido</p></div></div><div className="donut-wrap"><div className="donut"><div><strong>31,8%</strong><span>Margem</span></div></div><div className="donut-list"><div><i className="profit"/><span>Lucro operacional</span><strong>{brl(m.netProfitCents)}</strong></div><div><i className="cost"/><span>Custo de produtos</span><strong>{brl(m.productsCostCents)}</strong></div><div><i className="expense"/><span>Despesas</span><strong>{brl(m.expenseTotalCents)}</strong></div></div></div></article>
  </section>
  <section className="dashboard-grid tables">
   <article className="panel"><div className="panel-head"><div><h3>Vendas recentes</h3><p>Últimas negociações registradas</p></div><button className="link-btn" onClick={()=>onNavigate("sales")}>Ver todas <ArrowRight size={15}/></button></div><div className="mini-table">{recent.map(s=>{const t=calculateSale(s),c=state.customers.find(c=>c.id===s.customerId);return <div className="mini-row" key={s.id}><div className="initials">{c?.company.slice(0,2).toUpperCase()}</div><div><strong>{c?.company}</strong><span>Venda #{s.number} · {new Date(s.date+"T12:00").toLocaleDateString("pt-BR")}</span></div><div className="align-right"><strong>{brl(t.netCents)}</strong><Badge tone="success">Confirmada</Badge></div></div>})}</div></article>
   <article className="panel"><div className="panel-head"><div><h3>Próximos recebimentos</h3><p>Parcelas com vencimento próximo</p></div><button className="link-btn" onClick={()=>onNavigate("receivables")}>Ver agenda <ArrowRight size={15}/></button></div><div className="mini-table">{due.map(x=>{const c=state.customers.find(c=>c.id===x.sale.customerId);return <div className="mini-row due-row" key={x.id}><div className="date-box"><strong>{new Date(x.dueDate+"T12:00").getDate()}</strong><span>AGO</span></div><div><strong>{c?.company}</strong><span>Parcela {x.number}/{x.total} · {x.method}</span></div><div className="align-right"><strong>{brl(x.amountCents)}</strong><Badge tone="warning">Pendente</Badge></div></div>})}</div></article>
  </section>
 </>
}
