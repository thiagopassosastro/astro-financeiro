"use client";

import { AlertTriangle, Boxes, CheckCircle2, PackagePlus } from "lucide-react";
import { useStore } from "./store";

const amount=(value:number)=>value.toLocaleString("pt-BR",{maximumFractionDigits:4});

export function StockAlertsView(){
  const {state}=useStore();
  const inventory=[...new Map(state.productInputs.map(input=>[input.inventoryItemId,input])).values()];
  const alerts=inventory.filter(input=>input.currentStock<=input.minimumStock).sort((a,b)=>(a.currentStock-a.minimumStock)-(b.currentStock-b.minimumStock));
  const normal=inventory.length-alerts.length;
  return <>
    <div className="stock-summary">
      <article className="panel danger"><AlertTriangle/><div><span>Precisam de reposição</span><strong>{alerts.length}</strong></div></article>
      <article className="panel"><CheckCircle2/><div><span>Estoque normal</span><strong>{normal}</strong></div></article>
      <article className="panel"><Boxes/><div><span>Insumos monitorados</span><strong>{inventory.length}</strong></div></article>
    </div>
    <section className="panel stock-alert-panel">
      <div className="panel-head"><div><h3>Lista de reposição</h3><p>Insumos que atingiram ou ficaram abaixo da quantidade mínima.</p></div><span className="stock-live"><i/>Atualizado automaticamente</span></div>
      {alerts.length?<div className="table-panel"><table><thead><tr><th>Código</th><th>Insumo</th><th>Estoque atual</th><th>Estoque mínimo</th><th>Quantidade para repor</th><th>Situação</th></tr></thead><tbody>{alerts.map(input=>{const missing=Math.max(0,input.minimumStock-input.currentStock);return <tr key={input.inventoryItemId}><td>{input.code||"—"}</td><td><strong>{input.name}</strong><small className="stock-unit">{input.unit.toUpperCase()}</small></td><td><strong className="negative-text">{amount(input.currentStock)}</strong></td><td>{amount(input.minimumStock)}</td><td><strong>{amount(missing)}</strong></td><td><span className="stock-status low"><AlertTriangle/>Repor estoque</span></td></tr>})}</tbody></table></div>:<div className="stock-all-good"><PackagePlus/><h3>Nenhum insumo precisa de reposição</h3><p>Os saldos atuais estão acima das quantidades mínimas definidas.</p></div>}
    </section>
  </>
}
