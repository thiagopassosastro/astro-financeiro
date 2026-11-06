import { calculateItem, calculateSale } from "@/domain/finance";
import type { AccessRole, AppState, Customer, Expense, PaymentMethod, PaymentStatus, Product, ProductInput, Sale, Seller } from "@/domain/types";
import { emptyState } from "@/data/empty-state";
import { createClient } from "./client";

const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const money = (value: number) => value / 100;
const methodToDb: Record<PaymentMethod, string> = { PIX:"pix", Dinheiro:"cash", Transferência:"transfer", Boleto:"boleto", Cartão:"card", Cheque:"check", Outros:"other" };
const methodFromDb: Record<string, PaymentMethod> = { pix:"PIX", cash:"Dinheiro", transfer:"Transferência", boleto:"Boleto", card:"Cartão", check:"Cheque", other:"Outros" };
const statusFromDb = (status: string): PaymentStatus => status === "paid" ? "paid" : status === "overdue" ? "overdue" : status === "cancelled" ? "cancelled" : "pending";

function assert(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function loadAppState(): Promise<AppState> {
  const supabase = createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)throw new Error("Sessão expirada.");
  const snapshot=await supabase.rpc("load_application_state");assert(snapshot.error);
  const data=(snapshot.data||{}) as any;
  const profile=data.profile;
  const state: AppState = {
    ...emptyState,
    products: (data.products || []).map((row: any) => ({ id:row.id, name:row.name, sku:row.sku, category:row.category_name || "Sem categoria", origin:row.origin === "imported" ? "Importado" : "Fabricação própria", costCents:cents(row.current_cost), suggestedPriceCents:row.suggested_price == null ? undefined : cents(row.suggested_price), imageUrl:row.image_url || undefined, active:row.active, description:row.description || undefined, updatedAt:String(row.updated_at).slice(0,10) })),
    costHistory: (data.cost_history || []).map((row: any) => ({ id:row.id, productId:row.product_id, costCents:cents(row.cost), effectiveAt:String(row.effective_at).slice(0,10) })),
    productInputs: (data.product_inputs || []).map((row: any) => ({ id:row.id, productId:row.product_id, inventoryItemId:row.inventory_item_id, code:row.inventory?.code || row.code || undefined, name:row.inventory?.name || row.name, unit:row.inventory?.unit || row.unit, quantity:Number(row.quantity), unitCostCents:cents(row.inventory?.unit_cost ?? row.unit_cost), currentStock:Number(row.inventory?.current_stock || 0), minimumStock:Number(row.inventory?.minimum_stock || 0), notes:row.notes || undefined, createdAt:row.created_at })),
    inventoryMovements: (data.inventory_movements || []).map((row:any)=>({id:row.id,inventoryItemId:row.inventory_item_id,saleId:row.sale_id||undefined,productInputId:row.product_input_id||undefined,type:row.movement_type,quantity:Number(row.quantity),balanceAfter:Number(row.balance_after),notes:row.notes||undefined,createdAt:row.created_at,code:row.inventory?.code||undefined,name:row.inventory?.name||"Insumo",unit:row.inventory?.unit||"unidade"})),
    customers: (data.customers || []).map((row: any) => ({ id:row.id, name:row.name, company:row.company_name || row.name, document:row.document || "", phone:row.phone || "", email:row.email || "", address:row.address || "", city:row.city || "", state:row.state || "" })),
    sellers: (data.sellers || []).map((row: any) => ({ id:row.id, name:row.name, phone:row.phone || "", email:row.email || "", active:row.active })),
    sales: (data.sales || []).map((row: any) => ({ id:row.id, number:String(row.sale_number).padStart(6,"0"), date:row.sale_date, customerId:row.customer_id, sellerId:row.seller_id || "", discountCents:cents(row.discount_amount) - (row.items || []).reduce((sum:number,item:any)=>sum+cents(item.discount),0), surchargeCents:cents(row.surcharge_amount), freightCents:cents(row.freight_amount), commissionType:row.commission_type || "percentage", commissionPercentage:Number(row.commission_percentage || 0), commissionFixedCents:row.commission_type === "fixed" ? cents(row.commission_amount) : 0, shippingCents:cents(row.shipping_cost), feesCents:cents(row.fees), otherCostsCents:cents(row.other_costs), notes:row.notes || "", deliveryDeadline:row.delivery_deadline || undefined, deliveryLocation:row.delivery_location || undefined, createdAt:row.created_at, status:row.status, financialStatus:row.financial_status, confirmedAt:row.confirmed_at||undefined,pricedAt:row.priced_at||undefined,cancelledAt:row.cancelled_at||undefined,createdBy:row.created_by||undefined,confirmedBy:row.confirmed_by||undefined,pricedBy:row.priced_by||undefined,cancelledBy:row.cancelled_by||undefined,
      items:(row.items || []).map((item:any)=>({ id:item.id, productId:item.product_id, productNameSnapshot:item.product_name_snapshot, productSkuSnapshot:item.product_sku_snapshot, quantity:Number(item.quantity), unitSalePriceCents:cents(item.unit_sale_price), unitCostAtSaleCents:cents(item.unit_cost_at_sale), discountCents:cents(item.discount) })),
      installments:(row.receivables || []).sort((a:any,b:any)=>a.installment_number-b.installment_number).map((item:any)=>({ id:item.id, number:item.installment_number, total:item.installment_count, amountCents:cents(item.amount), dueDate:item.due_date, paidAt:item.received_at ? String(item.received_at).slice(0,10) : undefined, method:methodFromDb[item.payment_method] || "Outros", status:statusFromDb(item.status) })) })),
    expenses: (data.expenses || []).map((row:any)=>({ id:row.id, date:row.expense_date, supplier:row.supplier_name || "Sem fornecedor", category:row.category_name || "Outros", description:row.description, totalCents:cents(row.total_amount), notes:row.notes || undefined,
      installments:(row.payables || []).sort((a:any,b:any)=>a.installment_number-b.installment_number).map((item:any)=>({ id:item.id, number:item.installment_number, total:item.installment_count, amountCents:cents(item.amount), dueDate:item.due_date, paidAt:item.paid_at ? String(item.paid_at).slice(0,10) : undefined, method:methodFromDb[item.payment_method] || "Outros", status:statusFromDb(item.status) })) })),
    openingBalanceCents:cents(data.opening_balance),
    defaultCommissionPercentage:Number(data.default_commission ?? 10),
    currentProfile:{id:profile.id,fullName:profile.full_name,role:profile.role as AccessRole,active:profile.active??true,mustChangePassword:profile.must_change_password??false},
    users:(data.users||[]).map((row:any)=>({id:row.id,fullName:row.full_name,role:row.role as AccessRole,active:row.active??true,mustChangePassword:row.must_change_password??false})),
  };
  return state;
}

export async function saveProduct(product: Product) {
  const supabase=createClient(); let category=(await supabase.from("product_categories").select("id").eq("name",product.category).maybeSingle()).data;
  if(!category){const result=await supabase.from("product_categories").insert({name:product.category}).select("id").single();assert(result.error);category=result.data}
  let imageUrl=product.imageUrl;
  if(imageUrl?.startsWith("data:")){
    const {data:{user}}=await supabase.auth.getUser(); const blob=await (await fetch(imageUrl)).blob(); const extension=blob.type.split("/")[1]||"jpg"; const path=`${user!.id}/${product.id}.${extension}`;
    const upload=await supabase.storage.from("product-images").upload(path,blob,{contentType:blob.type,upsert:true});assert(upload.error);
    imageUrl=supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  }
  const result=await supabase.rpc("save_product_secure",{p_product:{id:product.id,name:product.name,sku:product.sku,category_id:category!.id,origin:product.origin==="Importado"?"imported":"manufactured",current_cost:money(product.costCents),suggested_price:product.suggestedPriceCents?money(product.suggestedPriceCents):"",image_url:imageUrl||""}});assert(result.error);
}
export async function saveProductCost(productId:string,costCents:number){const result=await createClient().rpc("set_product_cost_secure",{p_product_id:productId,p_cost:money(costCents)});assert(result.error)}
export async function deleteProduct(productId:string){
  const response=await fetch(`/api/products/${productId}`,{method:"DELETE"});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"Não foi possível excluir o equipamento.");
}
export async function saveProductInput(input:ProductInput){
  const result=await createClient().rpc("save_product_input_secure",{p_input:{id:input.id,product_id:input.productId,inventory_item_id:input.inventoryItemId,code:input.code?.trim().toUpperCase()||"",name:input.name,unit:input.unit,quantity:input.quantity,unit_cost:money(input.unitCostCents),current_stock:input.currentStock,minimum_stock:input.minimumStock,notes:input.notes||""}});assert(result.error);
}
export async function deleteProductInput(id:string){const result=await createClient().from("product_inputs").update({deleted_at:new Date().toISOString()}).eq("id",id);assert(result.error)}
export async function adjustInventoryStock(id:string,currentStock:number,minimumStock:number,notes?:string){const result=await createClient().rpc("adjust_inventory_stock",{p_inventory_item_id:id,p_new_stock:currentStock,p_minimum_stock:minimumStock,p_notes:notes||""});assert(result.error)}
const customerPayload=(customer:Customer)=>({name:customer.name,company_name:customer.company,document:customer.document||null,phone:customer.phone||null,email:customer.email||null,address:customer.address||null,city:customer.city||null,state:customer.state||null});
export async function saveCustomer(customer:Customer){const result=await createClient().from("customers").insert({id:customer.id,...customerPayload(customer)});assert(result.error)}
export async function updateCustomer(customer:Customer){const result=await createClient().from("customers").update(customerPayload(customer)).eq("id",customer.id);assert(result.error)}
export async function saveSeller(seller:Seller){const result=await createClient().from("sellers").insert({id:seller.id,name:seller.name,phone:seller.phone||null,email:seller.email||null,active:seller.active});assert(result.error)}
export interface OperationalOrderInput { customerId:string; date:string; notes:string; deliveryDeadline?:string; deliveryLocation?:string; items:Array<{productId:string;quantity:number}> }
const operationalPayload=(order:OperationalOrderInput)=>({customer_id:order.customerId,sale_date:order.date,notes:order.notes||"",delivery_deadline:order.deliveryDeadline||"",delivery_location:order.deliveryLocation||""});
const operationalItems=(order:OperationalOrderInput)=>order.items.map(item=>({product_id:item.productId,quantity:item.quantity}));
export async function createPreSale(order:OperationalOrderInput,confirm:boolean){
  const result=await createClient().rpc("create_pre_sale",{p_order:operationalPayload(order),p_items:operationalItems(order),p_confirm:confirm,p_request_key:crypto.randomUUID()});assert(result.error);return result.data;
}
export async function confirmPreSale(id:string){const result=await createClient().rpc("confirm_pre_sale",{p_sale_id:id,p_request_key:crypto.randomUUID()});assert(result.error)}
export async function updatePreSale(id:string,order:OperationalOrderInput){const result=await createClient().rpc("update_pre_sale_operational",{p_sale_id:id,p_order:operationalPayload(order),p_items:operationalItems(order),p_request_key:crypto.randomUUID()});assert(result.error)}
export async function pricePreSale(sale:Sale){
  const totals=calculateSale(sale);
  if(totals.netCents<=0)throw new Error("O valor líquido deve ser maior que zero.");
  const items=sale.items.map(item=>{const total=calculateItem(item);return{id:item.id,unit_sale_price:money(item.unitSalePriceCents),unit_cost_at_sale:money(item.unitCostAtSaleCents),discount:money(item.discountCents),total_sale:money(total.netCents),total_cost:money(total.costCents),profit:money(total.profitCents),profit_margin:total.margin}});
  const receivables=sale.installments.map(item=>({number:item.number,total:item.total,amount:money(item.amountCents),due_date:item.dueDate,paid_at:item.paidAt||"",payment_method:methodToDb[item.method],status:item.status}));
  const result=await createClient().rpc("price_pre_sale",{p_sale_id:sale.id,p_sale:{gross_amount:money(totals.grossCents),discount_amount:money(totals.discountCents),surcharge_amount:money(totals.surchargeCents),freight_amount:money(totals.freightCents),net_amount:money(totals.netCents),products_cost:money(totals.productsCostCents),commission_type:sale.commissionType,commission_percentage:sale.commissionPercentage,commission_amount:money(totals.commissionCents),shipping_cost:money(sale.shippingCents),fees:money(sale.feesCents),other_costs:money(sale.otherCostsCents),gross_profit:money(totals.grossProfitCents),profit:money(totals.profitCents),profit_margin:totals.margin},p_items:items,p_receivables:receivables,p_request_key:crypto.randomUUID()});assert(result.error);
}
export async function saveSale(sale:Sale){const supabase=createClient(), totals=calculateSale(sale);const items=sale.items.map(item=>{const total=calculateItem(item);return{product_id:item.productId,product_name_snapshot:item.productNameSnapshot,product_sku_snapshot:item.productSkuSnapshot,quantity:item.quantity,unit_sale_price:money(item.unitSalePriceCents),unit_cost_at_sale:money(item.unitCostAtSaleCents),discount:money(item.discountCents),total_sale:money(total.netCents),total_cost:money(total.costCents),profit:money(total.profitCents),profit_margin:total.margin}});const receivables=sale.installments.map(item=>({number:item.number,total:item.total,amount:money(item.amountCents),due_date:item.dueDate,paid_at:item.paidAt||"",payment_method:methodToDb[item.method],status:item.status}));const result=await supabase.rpc("create_complete_sale_with_delivery",{p_sale:{customer_id:sale.customerId,seller_id:sale.sellerId,sale_date:sale.date,delivery_deadline:sale.deliveryDeadline||"",delivery_location:sale.deliveryLocation||"",gross_amount:money(totals.grossCents),discount_amount:money(totals.discountCents),net_amount:money(totals.netCents),products_cost:money(totals.productsCostCents),commission_type:sale.commissionType,commission_percentage:sale.commissionPercentage,commission_amount:money(totals.commissionCents),shipping_cost:money(sale.shippingCents),fees:money(sale.feesCents),other_costs:money(sale.otherCostsCents),gross_profit:money(totals.grossProfitCents),profit:money(totals.profitCents),profit_margin:totals.margin,notes:sale.notes},p_items:items,p_receivables:receivables});assert(result.error)}
export async function updateSaleDeliveryInfo(id:string,deliveryDeadline:string,deliveryLocation:string){const result=await createClient().from("sales").update({delivery_deadline:deliveryDeadline||null,delivery_location:deliveryLocation.trim()||null}).eq("id",id);assert(result.error)}
export async function saveExpense(expense:Expense){const supabase=createClient();let supplier=(await supabase.from("suppliers").select("id").ilike("name",expense.supplier).maybeSingle()).data;if(!supplier){const result=await supabase.from("suppliers").insert({name:expense.supplier}).select("id").single();assert(result.error);supplier=result.data}let category=(await supabase.from("expense_categories").select("id").eq("name",expense.category).is("parent_id",null).maybeSingle()).data;if(!category){const result=await supabase.from("expense_categories").insert({name:expense.category}).select("id").single();assert(result.error);category=result.data}const method=expense.installments[0]?.method||"Outros";const result=await supabase.rpc("create_complete_expense",{p_expense:{expense_date:expense.date,supplier_id:supplier!.id,category_id:category!.id,description:expense.description,total_amount:money(expense.totalCents),payment_method:methodToDb[method],notes:expense.notes||""},p_payables:expense.installments.map(item=>({number:item.number,total:item.total,amount:money(item.amountCents),due_date:item.dueDate,paid_at:item.paidAt||"",payment_method:methodToDb[item.method],status:item.status}))});assert(result.error)}
export async function settleInstallment(kind:"sale"|"expense",id:string){const table=kind==="sale"?"receivables":"payables",dateField=kind==="sale"?"received_at":"paid_at";const result=await createClient().from(table).update({status:"paid",[dateField]:new Date().toISOString()}).eq("id",id);assert(result.error)}
export async function cancelSale(id:string){const result=await createClient().rpc("cancel_sale_and_restore_stock",{p_sale_id:id});assert(result.error)}
export async function deliverSale(id:string){const result=await createClient().rpc("mark_sale_delivered",{p_sale_id:id});assert(result.error)}
export async function saveUserRole(id:string,role:AccessRole){const result=await createClient().from("profiles").update({role}).eq("id",id);assert(result.error)}
