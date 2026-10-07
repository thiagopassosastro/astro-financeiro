"use client";

import { CalendarClock, MapPin, Pencil, Search, Sheet, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Customer, Sale } from "@/domain/types";
import { useStore } from "./store";
import { Field } from "./ui";

const formatDate = (value?: string) => value ? new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString("pt-BR") : "Não informado";
const customerAddress = (customer?: Customer) => customer ? [customer.address, customer.city, customer.state].filter(Boolean).join(" - ") : "";

export function SalesSpreadsheetView() {
  const {state}=useStore();
  const [search,setSearch]=useState("");
  const [editing,setEditing]=useState<Sale>();
  const pending=useMemo(()=>state.sales
    .filter(sale=>sale.status!=="delivered"&&sale.status!=="cancelled")
    .filter(sale=>{
      const customer=state.customers.find(item=>item.id===sale.customerId);
      const seller=state.sellers.find(item=>item.id===sale.sellerId);
      const text=[sale.number,customer?.name,customer?.company,seller?.name,...sale.items.map(item=>item.productNameSnapshot)].join(" ").toLocaleLowerCase("pt-BR");
      return text.includes(search.trim().toLocaleLowerCase("pt-BR"));
    })
    .sort((a,b)=>(a.deliveryDeadline||"9999-12-31").localeCompare(b.deliveryDeadline||"9999-12-31")),[state.sales,state.customers,state.sellers,search]);

  return <>
    <div className="sales-sheet-summary">
      <article className="panel"><Sheet/><div><span>Pedidos em produção</span><strong>{pending.length}</strong><small>Saem da planilha quando forem marcados como entregues</small></div></article>
      <article className="panel"><CalendarClock/><div><span>Sem prazo informado</span><strong>{pending.filter(sale=>!sale.deliveryDeadline).length}</strong><small>Complete os pedidos antigos pelo botão de editar</small></div></article>
    </div>
    <div className="view-actions sales-sheet-actions"><div className="input-search"><Search size={17}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar pedido, cliente ou equipamento..."/></div><span>Atualização automática com as vendas do sistema</span></div>
    <section className="panel table-panel sales-sheet-table">
      <table><thead><tr><th>Pedido</th><th>Nome do cliente</th><th>Academia</th><th>Entrada no sistema</th><th>Prazo máximo</th><th>Vendedor</th><th>Equipamentos vendidos</th><th>Local de entrega</th><th/></tr></thead>
      <tbody>{pending.map(sale=>{const customer=state.customers.find(item=>item.id===sale.customerId);const seller=state.sellers.find(item=>item.id===sale.sellerId);const location=sale.deliveryLocation||customerAddress(customer);return <tr key={sale.id}>
        <td><strong>#{sale.number}</strong></td>
        <td><strong>{customer?.name||"Não informado"}</strong></td>
        <td>{customer?.company||"Não informada"}</td>
        <td className="sheet-date">{formatDate(sale.createdAt||sale.date)}</td>
        <td className={!sale.deliveryDeadline?"sheet-missing":"sheet-date"}>{formatDate(sale.deliveryDeadline)}</td>
        <td>{seller?.name||"Não informado"}</td>
        <td><div className="sheet-products">{sale.items.map(item=><span key={item.id}><b>{item.quantity.toLocaleString("pt-BR")}×</b> {item.productNameSnapshot}</span>)}</div></td>
        <td><div className={!location?"sheet-missing sheet-location":"sheet-location"}><MapPin/>{location||"Não informado"}</div></td>
        <td><button className="table-action sheet-edit" title="Editar prazo e local de entrega" onClick={()=>setEditing(sale)}><Pencil/></button></td>
      </tr>})}</tbody></table>
      {!pending.length&&<div className="sales-sheet-empty"><Sheet/><strong>Nenhum pedido aguardando entrega</strong><span>{search?"Nenhum pedido corresponde à busca.":"Os novos pedidos aparecerão aqui automaticamente."}</span></div>}
      <div className="table-footer">{pending.length} {pending.length===1?"pedido aguardando entrega":"pedidos aguardando entrega"}<span>Pedidos entregues são retirados automaticamente</span></div>
    </section>
    {editing&&<DeliveryInfoModal sale={editing} customer={state.customers.find(item=>item.id===editing.customerId)} close={()=>setEditing(undefined)}/>} 
  </>;
}

function DeliveryInfoModal({sale,customer,close}:{sale:Sale;customer?:Customer;close:()=>void}) {
  const {updateSaleDeliveryInfo}=useStore();
  const [deadline,setDeadline]=useState(sale.deliveryDeadline||"");
  const [location,setLocation]=useState(sale.deliveryLocation||customerAddress(customer));
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!deadline||!location.trim()){setError("Informe o prazo máximo e o local de entrega.");return}setSaving(true);setError("");try{await updateSaleDeliveryInfo(sale.id,deadline,location);close()}catch{setError("Não foi possível salvar as informações da entrega.")}finally{setSaving(false)}};
  return <div className="modal-backdrop"><form className="modal delivery-info-modal" onSubmit={submit}><div className="modal-head"><div><h3>Entrega do pedido #{sale.number}</h3><p>Complete ou altere as informações combinadas com o cliente.</p></div><button type="button" onClick={close}><X/></button></div><div className="form-grid"><Field label="Prazo máximo de entrega"><input type="date" min={sale.date} value={deadline} onChange={event=>setDeadline(event.target.value)} required/></Field><Field label="Local de entrega"><input value={location} onChange={event=>setLocation(event.target.value)} placeholder="Endereço completo" required/></Field></div>{error&&<div className="modal-form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Salvando...":"Salvar informações"}</button></div></form></div>;
}
