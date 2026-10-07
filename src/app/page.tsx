"use client";
import { useEffect, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Bell, CalendarDays, ChevronDown, CircleDollarSign, ClipboardList, FileClock, FileSpreadsheet, Layers3, LayoutDashboard, LogOut, Menu, Package, Plus, ReceiptText, Search, Settings, ShoppingCart, TrendingUp, Truck, UserRound, UsersRound, WalletCards, X } from "lucide-react";
import { DashboardView } from "@/components/dashboard";
import { ProductsView } from "@/components/products";
import { SalesView } from "@/components/sales";
import { NewSaleView } from "@/components/new-sale";
import { LedgerView } from "@/components/ledger";
import { ProjectionView } from "@/components/projection";
import { DirectoryView } from "@/components/directory";
import { ReportsView } from "@/components/reports";
import { BoletosView } from "@/components/boletos";
import { useStore } from "@/components/store";
import { ProductInputsView } from "@/components/product-inputs";
import { StockAlertsView } from "@/components/stock-alerts";
import { AccessSettingsView } from "@/components/access-settings";
import { SalesSpreadsheetView } from "@/components/sales-spreadsheet";
import { GlobalSearch } from "@/components/global-search";

const groups = [
  {label:"Visão geral",items:[{id:"dashboard",label:"Dashboard",icon:LayoutDashboard}]},
  {label:"Operações",items:[{id:"sales",label:"Vendas",icon:ShoppingCart},{id:"sales-spreadsheet",label:"Planilha de vendas",icon:FileSpreadsheet},{id:"boletos",label:"Boletos",icon:FileClock},{id:"receivables",label:"Contas a receber",icon:WalletCards},{id:"expenses",label:"Despesas",icon:ReceiptText},{id:"payables",label:"Contas a pagar",icon:ClipboardList}]},
  {label:"Cadastros",items:[{id:"products",label:"Equipamentos",icon:Package},{id:"product-inputs",label:"Insumos",icon:Layers3},{id:"stock-alerts",label:"Alertas de estoque",icon:AlertTriangle},{id:"customers",label:"Clientes",icon:UsersRound},{id:"suppliers",label:"Fornecedores",icon:Truck},{id:"sellers",label:"Vendedores",icon:UserRound}]},
  {label:"Análises",items:[{id:"cashflow",label:"Fluxo de caixa",icon:Activity},{id:"projection",label:"Projeção financeira",icon:TrendingUp},{id:"reports",label:"Relatórios",icon:BarChart3}]},
];
const titles:Record<string,{title:string;subtitle:string}>={
  dashboard:{title:"Visão geral",subtitle:"Acompanhe os principais indicadores da Astro."}, sales:{title:"Vendas",subtitle:"Negociações, rentabilidade e recebimentos."}, "sales-spreadsheet":{title:"Planilha de vendas",subtitle:"Pedidos em produção e prazos de entrega."},
  receivables:{title:"Contas a receber",subtitle:"Parcelas de clientes e próximos vencimentos."}, expenses:{title:"Despesas",subtitle:"Custos e despesas operacionais."}, payables:{title:"Contas a pagar",subtitle:"Compromissos e pagamentos da empresa."},
  boletos:{title:"Central de boletos",subtitle:"Acompanhe todos os vencimentos a receber e a pagar."},
  products:{title:"Equipamentos",subtitle:"Catálogo, custos atuais e histórico."}, customers:{title:"Clientes",subtitle:"Relacionamento e posição financeira."}, suppliers:{title:"Fornecedores",subtitle:"Parceiros e histórico de compras."}, sellers:{title:"Vendedores",subtitle:"Performance comercial e comissões."},
  "product-inputs":{title:"Insumos de equipamentos",subtitle:"Composição detalhada do custo de fabricação."},
  "stock-alerts":{title:"Alertas de estoque",subtitle:"Insumos abaixo da quantidade mínima e lista de reposição."},
  "access-settings":{title:"Usuários e acessos",subtitle:"Defina os cargos e as áreas disponíveis para cada usuário."},
  cashflow:{title:"Fluxo de caixa",subtitle:"Entradas e saídas efetivamente realizadas."}, projection:{title:"Projeção financeira",subtitle:"Previsão do caixa para os próximos meses."}, reports:{title:"Relatórios",subtitle:"Rentabilidade e fechamento gerencial."}
};

export default function Home(){
  const [view,setView]=useState("dashboard"); const [mobile,setMobile]=useState(false); const [searchOpen,setSearchOpen]=useState(false); const meta=titles[view]||titles.dashboard; const {state,signOut}=useStore();
  const isAdmin=state.currentProfile?.role==="admin";
  const lowStockCount=[...new Map(state.productInputs.map(input=>[input.inventoryItemId,input])).values()].filter(input=>input.currentStock<=input.minimumStock).length;
  useEffect(()=>{if(state.currentProfile&&!isAdmin&&!['products','product-inputs','stock-alerts'].includes(view))setView('products')},[state.currentProfile,isAdmin,view]);
  const navigate=(id:string)=>{if(!isAdmin&&!['products','product-inputs','stock-alerts'].includes(id))return;setView(id);setMobile(false)};
  const visibleGroups=isAdmin?groups:groups.map(group=>({...group,items:group.items.filter(item=>['products','product-inputs','stock-alerts'].includes(item.id))})).filter(group=>group.items.length);
  return <div className="app-shell">
    {mobile&&<button className="scrim" onClick={()=>setMobile(false)} aria-label="Fechar menu"/>}
    <aside className={`sidebar ${mobile?"open":""}`}>
      <div className="brand"><div className="brand-logo"><img src="/astro-brand.jpg" alt="Astro Equipamentos Esportivos"/></div><button className="mobile-close" onClick={()=>setMobile(false)}><X size={20}/></button></div>
      {isAdmin&&<button className="new-sale" onClick={()=>navigate("new-sale")}><Plus size={18}/>Nova venda</button>}
      <nav>{visibleGroups.map(group=><div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map(item=><button key={item.id} onClick={()=>navigate(item.id)} className={view===item.id?"active":""}><item.icon size={18}/><span>{item.label}</span>{item.id==="receivables"&&<em>7</em>}{item.id==="stock-alerts"&&lowStockCount>0&&<em className="stock-count">{lowStockCount}</em>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom">{isAdmin&&<button onClick={()=>navigate("access-settings")} className={view==="access-settings"?"active":""}><Settings size={18}/>Usuários e acessos</button>}<div className="user-card"><div className="avatar">{state.currentProfile?.fullName.slice(0,2).toUpperCase()||"AS"}</div><div><strong>{state.currentProfile?.fullName||"Astro"}</strong><small>{isAdmin?"Administrador":"Operador de Estoque"}</small></div><button className="logout-button" title="Sair" onClick={()=>void signOut()}><LogOut size={16}/></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><button className="menu-button" onClick={()=>setMobile(true)}><Menu size={22}/></button><div><h1>{view==="new-sale"?"Nova venda":meta.title}</h1><p>{view==="new-sale"?"Registre a negociação e simule o resultado em tempo real.":meta.subtitle}</p></div><div className="top-actions"><button className="search" onClick={()=>setSearchOpen(true)}><Search size={18}/><span>Buscar em todo o sistema...</span><kbd>Ctrl K</kbd></button><button className="period"><CalendarDays size={17}/>Agosto 2026<ChevronDown size={15}/></button><button className="icon-button stock-bell" title="Alertas de estoque" onClick={()=>navigate("stock-alerts")}><Bell size={20}/>{lowStockCount>0&&<b>{lowStockCount}</b>}</button><button className="icon-button"><CircleDollarSign size={20}/><i/></button></div></header>
      <div className="content">
        {view==="dashboard"&&<DashboardView onNavigate={navigate}/>} {view==="products"&&<ProductsView/>}
        {view==="product-inputs"&&<ProductInputsView/>}
        {view==="stock-alerts"&&<StockAlertsView/>}
        {view==="access-settings"&&isAdmin&&<AccessSettingsView/>}
        {view==="sales"&&<SalesView onNew={()=>setView("new-sale")}/>} {view==="new-sale"&&<NewSaleView onDone={()=>setView("sales")}/>} 
        {view==="sales-spreadsheet"&&<SalesSpreadsheetView/>}
        {view==="boletos"&&<BoletosView/>}
        {["receivables","payables","expenses","cashflow"].includes(view)&&<LedgerView mode={view as "receivables"|"payables"|"expenses"|"cashflow"}/>} 
        {view==="projection"&&<ProjectionView/>} {["customers","suppliers","sellers"].includes(view)&&<DirectoryView mode={view as "customers"|"suppliers"|"sellers"}/>} {view==="reports"&&<ReportsView/>}
      </div>
    </main>
    <GlobalSearch open={searchOpen} setOpen={setSearchOpen} onNavigate={navigate} isAdmin={isAdmin}/>
  </div>
}
