"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, PackagePlus, Save, Search } from "lucide-react";
import type { ProductInput } from "@/domain/types";
import { useStore } from "./store";

const amount=(value:number)=>value.toLocaleString("pt-BR",{maximumFractionDigits:4});

export function StockAlertsView(){
  const {state,addInventoryEntry}=useStore();
  const [query,setQuery]=useState("");
  const [notice,setNotice]=useState("");
  const inventory=[...new Map(state.productInputs.map(input=>[input.inventoryItemId,input])).values()];
  const allAlerts=inventory.filter(input=>input.currentStock<=input.minimumStock).sort((a,b)=>(a.currentStock-a.minimumStock)-(b.currentStock-b.minimumStock));
  const term=query.trim().toLocaleLowerCase("pt-BR");
  const alerts=allAlerts.filter(input=>[input.name,input.code,input.unit].join(" ").toLocaleLowerCase("pt-BR").includes(term));
  const normal=inventory.length-allAlerts.length;
  return <>
    <div className="stock-summary">
      <article className="panel danger"><AlertTriangle/><div><span>Precisam de reposição</span><strong>{allAlerts.length}</strong></div></article>
      <article className="panel"><CheckCircle2/><div><span>Estoque normal</span><strong>{normal}</strong></div></article>
      <article className="panel"><Boxes/><div><span>Insumos monitorados</span><strong>{inventory.length}</strong></div></article>
    </div>
    <div className="view-actions"><div className="input-search"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar insumo para reposição..."/></div></div>
    {notice&&<div className="inventory-entry-notice" role="status">{notice}</div>}
    <section className="panel stock-alert-panel">
      <div className="panel-head"><div><h3>Lista de reposição</h3><p>Insumos que atingiram ou ficaram abaixo da quantidade mínima.</p></div><span className="stock-live"><i/>Atualizado automaticamente</span></div>
      {alerts.length?<div className="table-panel"><table><thead><tr><th>Código</th><th>Insumo</th><th>Estoque atual</th><th>Estoque mínimo</th><th>Quantidade até o mínimo</th><th>Entrada de reposição</th><th>Situação</th></tr></thead><tbody>{alerts.map(input=>{const missing=Math.max(0,input.minimumStock-input.currentStock);return <tr key={input.inventoryItemId}><td>{input.code||"—"}</td><td><strong>{input.name}</strong><small className="stock-unit">{input.unit.toUpperCase()}</small></td><td><strong className="negative-text">{amount(input.currentStock)}</strong></td><td>{amount(input.minimumStock)}</td><td><strong>{amount(missing)}</strong></td><td><RestockEditor input={input} save={addInventoryEntry} onSaved={(balance)=>setNotice(`Entrada registrada para ${input.name}. Saldo atual: ${amount(balance.currentStock)} ${input.unit}.${balance.currentStock>balance.minimumStock?" O insumo saiu dos alertas.":" O insumo permanece no alerta até o saldo ficar acima do mínimo."}`)}/></td><td><span className="stock-status low"><AlertTriangle/>Repor estoque</span></td></tr>})}</tbody></table></div>:<div className="stock-all-good"><PackagePlus/><h3>Nenhum insumo precisa de reposição</h3><p>Os saldos atuais estão acima das quantidades mínimas definidas.</p></div>}
    </section>
  </>
}

function RestockEditor({input,save,onSaved}:{input:ProductInput;save:(id:string,quantity:number,requestKey:string)=>Promise<{currentStock:number;minimumStock:number}>;onSaved:(balance:{currentStock:number;minimumStock:number})=>void}){
  const suggested=Math.max(0,input.minimumStock-input.currentStock);const [quantity,setQuantity]=useState(String(suggested||""));const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  const pending=useRef<{quantity:number;key:string}|null>(null);const inFlight=useRef(false);
  useEffect(()=>{setQuantity(String(Math.max(0,input.minimumStock-input.currentStock)||""))},[input.currentStock,input.minimumStock]);
  const submit=async()=>{
    const value=Number(quantity);if(!Number.isFinite(value)||value<=0){setError("Informe uma quantidade maior que zero.");return}
    if(inFlight.current)return;inFlight.current=true;setSaving(true);setError("");
    if(!pending.current||pending.current.quantity!==value)pending.current={quantity:value,key:crypto.randomUUID()};
    try{const balance=await save(input.inventoryItemId,value,pending.current.key);pending.current=null;onSaved(balance)}catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível registrar a entrada. Tente novamente.")}finally{inFlight.current=false;setSaving(false)}
  };
  return <div><div className="restock-editor"><input aria-label={`Quantidade recebida de ${input.name}`} type="number" min="0.0001" step="0.0001" value={quantity} onChange={event=>setQuantity(event.target.value)}/><button title="Adicionar ao estoque" disabled={saving} onClick={()=>void submit()}><Save/>{saving?"Salvando":"Dar entrada"}</button></div>{error&&<small className="inventory-entry-error" role="alert">{error}</small>}</div>
}
