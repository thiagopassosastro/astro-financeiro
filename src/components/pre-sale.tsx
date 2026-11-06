"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardEdit, PackagePlus, Plus, Save, Trash2, UserRound } from "lucide-react";
import { useStore } from "./store";
import { Field } from "./ui";

type OperationalItem={id:string;productId:string;quantity:number};

export function NewPreSaleView({onDone}:{onDone:()=>void}){
  const {state,createOperationalOrder}=useStore();
  const [customerId,setCustomerId]=useState("");
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [notes,setNotes]=useState("");
  const [deliveryDeadline,setDeliveryDeadline]=useState("");
  const [deliveryLocation,setDeliveryLocation]=useState("");
  const [items,setItems]=useState<OperationalItem[]>([]);
  const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  const nextNumber=String(Math.max(0,...state.sales.map(s=>Number(s.number)))+1).padStart(6,"0");
  const addItem=()=>{const product=state.products[0];if(product)setItems(current=>[...current,{id:crypto.randomUUID(),productId:product.id,quantity:1}])};
  const stockIssues=useMemo(()=>{
    const withoutInputs=items.filter(item=>!state.productInputs.some(input=>input.productId===item.productId)).map(item=>state.products.find(product=>product.id===item.productId)?.name||"Equipamento");
    const required=new Map<string,number>();
    for(const item of items)for(const input of state.productInputs.filter(input=>input.productId===item.productId))required.set(input.inventoryItemId,(required.get(input.inventoryItemId)||0)+input.quantity*item.quantity);
    const shortages=[...required].flatMap(([id,quantity])=>{const input=state.productInputs.find(candidate=>candidate.inventoryItemId===id);return input&&quantity>input.currentStock?[`${input.name}: disponível ${input.currentStock.toLocaleString("pt-BR")}, necessário ${quantity.toLocaleString("pt-BR")}`]:[]});
    return {withoutInputs,shortages};
  },[items,state.productInputs,state.products]);
  const submit=async(confirm:boolean)=>{
    if(!customerId||!items.length||items.some(item=>!item.productId||item.quantity<=0)){setError("Informe o cliente e ao menos um equipamento com quantidade válida.");return}
    if(confirm&&stockIssues.shortages.length){setError(`Não foi possível confirmar por falta de saldo: ${stockIssues.shortages.join("; ")}.`);return}
    setSaving(true);setError("");
    try{await createOperationalOrder({customerId,date,notes,deliveryDeadline,deliveryLocation,items:items.map(({productId,quantity})=>({productId,quantity}))},confirm);onDone()}
    catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar a pré-venda.")}finally{setSaving(false)}
  };
  return <div className="sale-layout"><div className="sale-main">
    <button className="back-link" onClick={onDone}><ArrowLeft size={16}/>Voltar para pedidos</button>
    {error&&<div className="form-error">{error}</div>}
    <section className="form-card"><div className="form-card-head"><div className="step-icon"><UserRound size={19}/></div><div><h3>Informações da pré-venda</h3><p>Cadastre somente os dados operacionais; nenhum valor é necessário nesta etapa.</p></div></div><div className="form-grid three">
      <Field label="Cliente"><select value={customerId} onChange={event=>{const id=event.target.value;setCustomerId(id);const customer=state.customers.find(item=>item.id===id);if(customer)setDeliveryLocation([customer.address,customer.city,customer.state].filter(Boolean).join(" - "))}}><option value="">Selecione o cliente</option>{state.customers.map(customer=><option key={customer.id} value={customer.id}>{customer.company}</option>)}</select></Field>
      <Field label="Data do pedido"><input type="date" value={date} onChange={event=>setDate(event.target.value)}/></Field>
      <Field label="Prazo de entrega (opcional)"><input type="date" min={date} value={deliveryDeadline} onChange={event=>setDeliveryDeadline(event.target.value)}/></Field>
      <Field label="Local de entrega (opcional)"><input value={deliveryLocation} onChange={event=>setDeliveryLocation(event.target.value)} placeholder="Endereço combinado"/></Field>
      <Field label="Observações operacionais"><input value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Cor, montagem, instruções..."/></Field>
    </div></section>
    <section className="form-card"><div className="form-card-head"><div className="step-icon"><PackagePlus size={19}/></div><div><h3>Equipamentos e quantidades</h3><p>Quando houver ficha técnica, a confirmação consumirá os insumos em uma única transação.</p></div><button className="secondary push" onClick={addItem}><Plus size={16}/>Adicionar equipamento</button></div>
      {!items.length?<button className="add-empty" onClick={addItem}><PackagePlus size={25}/><strong>Adicionar primeiro equipamento</strong><span>Os valores serão preenchidos depois pelo Financeiro.</span></button>:<div className="item-list">{items.map((item,index)=>{const product=state.products.find(candidate=>candidate.id===item.productId);return <div className="sale-item" key={item.id}><div className="item-number">{index+1}</div><Field label="Equipamento"><select value={item.productId} onChange={event=>setItems(current=>current.map(candidate=>candidate.id===item.id?{...candidate,productId:event.target.value}:candidate))}>{state.products.map(option=><option value={option.id} key={option.id}>{option.name}</option>)}</select><small>SKU {product?.sku}</small></Field><Field label="Quantidade"><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={event=>setItems(current=>current.map(candidate=>candidate.id===item.id?{...candidate,quantity:Number(event.target.value)}:candidate))}/></Field><button className="delete-item" onClick={()=>setItems(current=>current.filter(candidate=>candidate.id!==item.id))}><Trash2 size={17}/></button></div>})}</div>}
      {!!stockIssues.withoutInputs.length&&<div className="snapshot-note">Sem insumos cadastrados: {stockIssues.withoutInputs.join(", ")}. Esses produtos não gerarão baixa automática de insumos.</div>}
      {!!stockIssues.shortages.length&&<div className="form-error">Saldo insuficiente: {stockIssues.shortages.join("; ")}.</div>}
    </section>
  </div><aside className="sale-summary"><div className="summary-head"><span>PRÉ-VENDA</span><strong>#{nextNumber}</strong></div><div className="summary-lines"><p><span>Cliente</span><strong>{state.customers.find(customer=>customer.id===customerId)?.company||"Não informado"}</strong></p><p><span>Equipamentos</span><strong>{items.length}</strong></p><p><span>Unidades</span><strong>{items.reduce((sum,item)=>sum+item.quantity,0).toLocaleString("pt-BR")}</strong></p><p className="summary-net"><span>Status financeiro</span><strong>Pendente de precificação</strong></p></div><div className="snapshot-note"><ClipboardEdit size={16}/><span>Salvar rascunho não movimenta estoque. Confirmar aplica as baixas de insumos cadastrados uma única vez.</span></div><button className="secondary save-sale" disabled={saving} onClick={()=>void submit(false)}><Save size={17}/>{saving?"Salvando...":"Salvar rascunho"}</button><button className="primary save-sale" disabled={saving||!!stockIssues.shortages.length} onClick={()=>void submit(true)}><CheckCircle2 size={17}/>{saving?"Confirmando...":"Confirmar pré-venda"}</button></aside></div>;
}
