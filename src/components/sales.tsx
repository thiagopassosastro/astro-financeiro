"use client";

import { Eye, PackageCheck, Plus, Search, SlidersHorizontal, XCircle } from "lucide-react";
import { brl, calculateSale, paidTotal } from "@/domain/finance";
import { useStore } from "./store";
import { Badge } from "./ui";

export function SalesView({onNew}:{onNew:()=>void}){
  const {state,cancelSale,deliverSale}=useStore();
  const cancel=async(id:string,number:string)=>{if(!window.confirm(`Cancelar a venda #${number}? Os insumos consumidos retornarão ao estoque.`))return;await cancelSale(id)};
  const deliver=async(id:string,number:string)=>{if(!window.confirm(`Marcar a venda #${number} como pedido entregue?\n\nOs insumos permanecerão baixados do estoque.`))return;await deliverSale(id)};
  return <>
    <div className="view-actions"><div className="input-search"><Search size={17}/><input placeholder="Buscar venda, cliente ou equipamento..."/></div><button className="secondary"><SlidersHorizontal size={17}/>Filtros</button><button className="primary" onClick={onNew}><Plus size={17}/>Nova venda</button></div>
    <div className="panel table-panel"><table><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Valor líquido</th><th>Lucro</th><th>Situação</th><th>Recebimento</th><th/></tr></thead><tbody>{state.sales.map(s=>{const t=calculateSale(s),c=state.customers.find(c=>c.id===s.customerId),v=state.sellers.find(v=>v.id===s.sellerId),paid=paidTotal(s.installments),cancelled=s.status==="cancelled",delivered=s.status==="delivered";return <tr key={s.id} className={cancelled?"cancelled-row":""}><td><strong>#{s.number}</strong></td><td>{new Date(s.date+"T12:00").toLocaleDateString("pt-BR")}</td><td><strong>{c?.company}</strong></td><td>{v?.name}</td><td><strong>{brl(t.netCents)}</strong></td><td><span className={cancelled?"muted-text":"positive-text"}>{brl(t.profitCents)} · {t.margin.toFixed(1)}%</span></td><td><Badge tone={cancelled?"danger":delivered?"delivered":"success"}>{cancelled?"Cancelada":delivered?"Entregue":"Confirmada"}</Badge></td><td><Badge tone={cancelled?"danger":paid>=t.netCents?"success":"warning"}>{cancelled?"Cancelado":paid>=t.netCents?"Recebido":"Parcial"}</Badge></td><td><div className="sale-row-actions"><button className="table-action" title="Ver venda"><Eye size={17}/></button>{!cancelled&&!delivered&&<><button className="table-action deliver-action" title="Marcar pedido como entregue" onClick={()=>void deliver(s.id,s.number)}><PackageCheck size={17}/></button><button className="table-action cancel-action" title="Cancelar venda e estornar estoque" onClick={()=>void cancel(s.id,s.number)}><XCircle size={17}/></button></>}</div></td></tr>})}</tbody></table><div className="table-footer">{state.sales.length} vendas registradas <span>Pedidos entregues mantêm a baixa; cancelamentos devolvem os insumos</span></div></div>
  </>
}
