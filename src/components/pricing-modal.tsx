"use client";

import { useMemo, useState } from "react";
import { Calculator, X } from "lucide-react";
import { brl, calculateSale, paidTotal, pendingTotal, splitInstallments, toCents } from "@/domain/finance";
import type { PaymentMethod, Sale } from "@/domain/types";
import { useStore } from "./store";
import { Field } from "./ui";

const inputMoney = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const methods: PaymentMethod[] = ["PIX", "Dinheiro", "Transferência", "Boleto", "Cartão", "Cheque", "Outros"];

export function PricingModal({order,close}:{order:Sale;close:()=>void}) {
  const {state,priceOperationalOrder}=useStore();
  const priced=order.financialStatus==="priced";
  const paid=paidTotal(order.installments);
  const pending=order.installments.filter(part=>part.status==="pending"||part.status==="overdue");
  const [prices,setPrices]=useState<Record<string,string>>(()=>Object.fromEntries(order.items.map(item=>[item.id,priced?inputMoney(item.unitSalePriceCents):""])));
  const [discounts,setDiscounts]=useState<Record<string,string>>(()=>Object.fromEntries(order.items.map(item=>[item.id,inputMoney(item.discountCents)])));
  const [generalDiscount,setGeneralDiscount]=useState(inputMoney(order.discountCents));
  const [freight,setFreight]=useState(inputMoney(order.freightCents||0));
  const [surcharge,setSurcharge]=useState(inputMoney(order.surchargeCents||0));
  const [shippingCost,setShippingCost]=useState(inputMoney(order.shippingCents));
  const [fees,setFees]=useState(inputMoney(order.feesCents));
  const [other,setOther]=useState(inputMoney(order.otherCostsCents));
  const [commissionType,setCommissionType]=useState<"percentage"|"fixed">(priced?order.commissionType:"percentage");
  const [commission,setCommission]=useState(priced?(order.commissionType==="fixed"?inputMoney(order.commissionFixedCents):String(order.commissionPercentage).replace(".",",")):String(state.defaultCommissionPercentage).replace(".",","));
  const [replan,setReplan]=useState(!priced);
  const [method,setMethod]=useState<PaymentMethod>(pending[0]?.method||"PIX");
  const [count,setCount]=useState(Math.max(1,pending.length));
  const [due,setDue]=useState(pending[0]?.dueDate||new Date().toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"}));
  const [error,setError]=useState("");const [saving,setSaving]=useState(false);

  const draft=useMemo<Sale>(()=>({...order,
    items:order.items.map(item=>({...item,unitSalePriceCents:toCents(prices[item.id]||""),discountCents:toCents(discounts[item.id]||"")})),
    discountCents:toCents(generalDiscount),freightCents:toCents(freight),surchargeCents:toCents(surcharge),
    shippingCents:toCents(shippingCost),feesCents:toCents(fees),otherCostsCents:toCents(other),commissionType,
    commissionPercentage:commissionType==="percentage"?Number(commission.replace(",",".")):0,
    commissionFixedCents:commissionType==="fixed"?toCents(commission):0,
  }),[order,prices,discounts,generalDiscount,freight,surcharge,shippingCost,fees,other,commissionType,commission]);
  const total=calculateSale(draft);const balance=total.netCents-paid;
  const save=async()=>{
    if(draft.items.some(item=>item.unitSalePriceCents<=0||item.discountCents<0||item.discountCents>item.unitSalePriceCents*item.quantity)||total.netCents<=0){setError("Informe preços positivos e descontos válidos para todos os equipamentos.");return}
    if([draft.discountCents,draft.freightCents||0,draft.surchargeCents||0,draft.shippingCents,draft.feesCents,draft.otherCostsCents,draft.commissionFixedCents,draft.commissionPercentage].some(value=>!Number.isFinite(value)||value<0)){setError("Os valores e a comissão devem ser números não negativos.");return}
    if(balance<0){setError(`O novo total não pode ser menor que os ${brl(paid)} já recebidos. Regularize o recebimento antes de reduzir o pedido abaixo desse valor.`);return}
    if(!replan&&balance!==pendingTotal(order.installments)){setError("O valor a receber mudou. Marque ‘Reorganizar parcelas pendentes’ para informar a nova forma de pagamento e os vencimentos.");return}
    if(replan&&balance>0&&(!due||count<1||count>36||balance<count)){setError("Informe vencimento e quantidade válida de parcelas; cada parcela deve ter pelo menos R$ 0,01.");return}
    const installments=replan&&balance>0?splitInstallments(balance,count,due,method):[];
    setSaving(true);setError("");
    try{await priceOperationalOrder({...draft,installments},replan);close()}catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar os dados financeiros.")}finally{setSaving(false)}
  };
  return <div className="modal-backdrop"><div className="modal pricing-modal" role="dialog" aria-modal="true" aria-label={`Dados financeiros do pedido ${order.number}`}>
    <div className="modal-head"><div><h3>{priced?"Editar venda":"Precificar pedido"} #{order.number}</h3><p>Pedido de {new Date(order.date+"T12:00").toLocaleDateString("pt-BR")}. Alterar os valores não movimenta o estoque.</p></div><button type="button" onClick={close} aria-label="Fechar"><X/></button></div>
    <div className="item-list">{draft.items.map(item=><div className="sale-item" key={item.id}><Field label="Equipamento"><div className="locked-value">{item.productNameSnapshot}<span>{item.quantity.toLocaleString("pt-BR")} unidade(s)</span></div></Field><Field label="Valor unitário"><input inputMode="decimal" value={prices[item.id]} onChange={event=>setPrices(current=>({...current,[item.id]:event.target.value}))} placeholder="0,00"/></Field><Field label="Desconto do item"><input inputMode="decimal" value={discounts[item.id]} onChange={event=>setDiscounts(current=>({...current,[item.id]:event.target.value}))}/></Field></div>)}</div>
    <div className="form-grid four"><Field label="Desconto geral"><input inputMode="decimal" value={generalDiscount} onChange={event=>setGeneralDiscount(event.target.value)}/></Field><Field label="Frete cobrado"><input inputMode="decimal" value={freight} onChange={event=>setFreight(event.target.value)}/></Field><Field label="Acréscimos"><input inputMode="decimal" value={surcharge} onChange={event=>setSurcharge(event.target.value)}/></Field><Field label="Outros custos"><input inputMode="decimal" value={other} onChange={event=>setOther(event.target.value)}/></Field><Field label="Custo de frete"><input inputMode="decimal" value={shippingCost} onChange={event=>setShippingCost(event.target.value)}/></Field><Field label="Taxas / custos"><input inputMode="decimal" value={fees} onChange={event=>setFees(event.target.value)}/></Field><Field label="Tipo de comissão"><select value={commissionType} onChange={event=>{setCommissionType(event.target.value as "percentage"|"fixed");setCommission("0")}}><option value="percentage">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select></Field><Field label={commissionType==="percentage"?"Comissão (%)":"Comissão fixa (R$)"}><input inputMode="decimal" value={commission} onChange={event=>setCommission(event.target.value)}/></Field></div>
    <div className="summary-lines"><p><span>Total da venda</span><strong>{brl(total.netCents)}</strong></p><p><span>Comissão calculada</span><strong>{brl(total.commissionCents)}</strong></p><p><span>Já recebido</span><strong>{brl(paid)}</strong></p><p><span>Saldo a receber</span><strong>{brl(balance)}</strong></p></div>
    {priced&&<label><input type="checkbox" checked={replan} onChange={event=>setReplan(event.target.checked)}/> Reorganizar parcelas pendentes</label>}
    {replan?<><p>Os recebimentos já registrados serão preservados. A forma e as parcelas abaixo se aplicam ao saldo a receber.</p>{balance>0&&<div className="form-grid three"><Field label="Forma de pagamento"><select value={method} onChange={event=>setMethod(event.target.value as PaymentMethod)}>{methods.map(option=><option key={option}>{option}</option>)}</select></Field><Field label="Parcelas do saldo"><input type="number" min="1" max="36" value={count} onChange={event=>setCount(Number(event.target.value))}/></Field><Field label="Primeiro vencimento"><input type="date" value={due} onChange={event=>setDue(event.target.value)}/></Field></div>}</>:<p>As parcelas atuais e seus vencimentos serão mantidos. Marque a opção acima para alterar o pagamento ou adequá-lo a um novo total.</p>}
    {error&&<div className="modal-form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" className="primary" disabled={saving} onClick={()=>void save()}><Calculator/>{saving?"Salvando...":"Salvar dados financeiros"}</button></div>
  </div></div>;
}
