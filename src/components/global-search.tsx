"use client";

import { AlertTriangle, FileSpreadsheet, Layers3, Package, ReceiptText, Search, ShoppingCart, UserRound, UsersRound, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";

type SearchResult={id:string;label:string;detail:string;view:string;kind:string;icon:React.ElementType};
const normalize=(value:string)=>value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLocaleLowerCase("pt-BR");

export function GlobalSearch({open,setOpen,onNavigate,isAdmin}:{open:boolean;setOpen:(value:boolean)=>void;onNavigate:(view:string)=>void;isAdmin:boolean}){
  const {state}=useStore();const [query,setQuery]=useState("");const inputRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setOpen(!open)}if(event.key==="Escape")setOpen(false)};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler)},[open,setOpen]);
  useEffect(()=>{if(open){setQuery("");setTimeout(()=>inputRef.current?.focus(),30)}},[open]);
  const results=useMemo(()=>{
    const rows:SearchResult[]=[];
    const add=(result:SearchResult)=>rows.push(result);
    const sections=isAdmin?[{id:"sales",label:"Vendas",detail:"Pedidos e negociações",icon:ShoppingCart},{id:"sales-spreadsheet",label:"Planilha de vendas",detail:"Pedidos aguardando entrega",icon:FileSpreadsheet},{id:"boletos",label:"Boletos",detail:"Vencimentos a pagar e receber",icon:WalletCards},{id:"receivables",label:"Contas a receber",detail:"Recebimentos de clientes",icon:WalletCards},{id:"expenses",label:"Despesas",detail:"Custos e compromissos",icon:ReceiptText},{id:"customers",label:"Clientes",detail:"Cadastro de clientes",icon:UsersRound},{id:"sellers",label:"Vendedores",detail:"Equipe comercial",icon:UserRound}]:[];
    [...sections,{id:"products",label:"Equipamentos",detail:"Catálogo de equipamentos",icon:Package},{id:"product-inputs",label:"Insumos",detail:"Composição e estoque",icon:Layers3},{id:"stock-alerts",label:"Alertas de estoque",detail:"Itens para reposição",icon:AlertTriangle}].forEach(item=>add({id:`section-${item.id}`,label:item.label,detail:item.detail,view:item.id,kind:"Área do sistema",icon:item.icon}));
    state.products.forEach(item=>add({id:`product-${item.id}`,label:item.name,detail:`Equipamento · SKU ${item.sku}`,view:"products",kind:"Equipamento",icon:Package}));
    [...new Map(state.productInputs.map(item=>[item.inventoryItemId,item])).values()].forEach(item=>add({id:`input-${item.inventoryItemId}`,label:item.name,detail:`Insumo${item.code?` · Código ${item.code}`:""}`,view:"product-inputs",kind:"Insumo",icon:Layers3}));
    if(isAdmin){
      state.customers.forEach(item=>add({id:`customer-${item.id}`,label:item.company,detail:`Cliente · ${item.name}${item.city?` · ${item.city}/${item.state}`:""}`,view:"customers",kind:"Cliente",icon:UsersRound}));
      state.sellers.forEach(item=>add({id:`seller-${item.id}`,label:item.name,detail:"Vendedor",view:"sellers",kind:"Vendedor",icon:UserRound}));
      state.sales.forEach(item=>{const customer=state.customers.find(customer=>customer.id===item.customerId);add({id:`sale-${item.id}`,label:`Venda #${item.number}`,detail:`${customer?.company||"Cliente"} · ${item.items.map(product=>product.productNameSnapshot).join(", ")}`,view:"sales",kind:"Venda",icon:ShoppingCart})});
      state.expenses.forEach(item=>add({id:`expense-${item.id}`,label:item.description,detail:`Despesa · ${item.supplier} · ${item.category}`,view:"expenses",kind:"Despesa",icon:ReceiptText}));
    }
    const term=normalize(query.trim());return (term?rows.filter(item=>normalize(`${item.label} ${item.detail} ${item.kind}`).includes(term)):rows.filter(item=>item.id.startsWith("section-"))).slice(0,40);
  },[state,isAdmin,query]);
  if(!open)return null;
  const choose=(result:SearchResult)=>{onNavigate(result.view);setOpen(false)};
  return <div className="global-search-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}><section className="global-search-modal" role="dialog" aria-label="Busca geral"><div className="global-search-input"><Search/><input ref={inputRef} value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar em todo o sistema..."/><kbd>ESC</kbd><button onClick={()=>setOpen(false)} title="Fechar busca"><X/></button></div><div className="global-search-results">{results.map(result=><button key={result.id} onClick={()=>choose(result)}><span className="global-search-icon"><result.icon/></span><span><strong>{result.label}</strong><small>{result.detail}</small></span><em>{result.kind}</em></button>)}{!results.length&&<div className="global-search-empty"><Search/><strong>Nenhum resultado encontrado</strong><span>Tente pesquisar por nome, código, número da venda ou responsável.</span></div>}</div><footer><span>Pesquise por clientes, pedidos, equipamentos, insumos e outras áreas.</span><kbd>Ctrl K</kbd></footer></section></div>;
}
