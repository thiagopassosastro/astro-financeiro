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
  const profile=await supabase.from("profiles").select("id, full_name, role, active, must_change_password").eq("id",user.id).single();assert(profile.error);
  const isAdmin=profile.data!.role==="admin";
  const emptyResult=Promise.resolve({data:[],error:null} as any);
  const [products, history, inputs, inventoryMovements, customers, sellers, sales, expenses, accounts, settings, users] = await Promise.all([
    supabase.from("products").select("*, product_categories(name)").is("deleted_at", null).order("name"),
    supabase.from("product_cost_history").select("*").order("effective_at", { ascending:false }),
    supabase.from("product_inputs").select("*, inventory_items(*)").is("deleted_at", null).order("created_at"),
    supabase.from("inventory_movements").select("*, inventory_items(code,name,unit)").order("created_at", { ascending:false }).limit(5000),
    isAdmin?supabase.from("customers").select("*").is("deleted_at", null).order("company_name"):emptyResult,
    isAdmin?supabase.from("sellers").select("*").is("deleted_at", null).order("name"):emptyResult,
    isAdmin?supabase.from("sales").select("*, sale_items(*), receivables(*)").is("deleted_at", null).order("sale_date", { ascending:false }):emptyResult,
    isAdmin?supabase.from("expenses").select("*, suppliers(name), expense_categories(name), payables(*)").is("deleted_at", null).order("expense_date", { ascending:false }):emptyResult,
    isAdmin?supabase.from("bank_accounts").select("opening_balance").eq("active", true):emptyResult,
    isAdmin?supabase.from("settings").select("value").eq("key", "default_commission_percentage").maybeSingle():Promise.resolve({data:null,error:null} as any),
    isAdmin?supabase.from("profiles").select("id, full_name, role, active, must_change_password").order("created_at"):Promise.resolve({data:[profile.data],error:null} as any),
  ]);
  [products, history, inputs, inventoryMovements, customers, sellers, sales, expenses, accounts, settings, users].forEach((result) => assert(result.error));
  const state: AppState = {
    ...emptyState,
    products: (products.data || []).map((row: any) => ({ id:row.id, name:row.name, sku:row.sku, category:row.product_categories?.name || "Sem categoria", origin:row.origin === "imported" ? "Importado" : "Fabricação própria", costCents:cents(row.current_cost), suggestedPriceCents:row.suggested_price == null ? undefined : cents(row.suggested_price), imageUrl:row.image_url || undefined, active:row.active, description:row.description || undefined, updatedAt:String(row.updated_at).slice(0,10) })),
    costHistory: (history.data || []).map((row: any) => ({ id:row.id, productId:row.product_id, costCents:cents(row.cost), effectiveAt:String(row.effective_at).slice(0,10) })),
    productInputs: (inputs.data || []).map((row: any) => ({ id:row.id, productId:row.product_id, inventoryItemId:row.inventory_item_id, code:row.inventory_items?.code || row.code || undefined, name:row.inventory_items?.name || row.name, unit:row.inventory_items?.unit || row.unit, quantity:Number(row.quantity), unitCostCents:cents(row.inventory_items?.unit_cost ?? row.unit_cost), currentStock:Number(row.inventory_items?.current_stock || 0), minimumStock:Number(row.inventory_items?.minimum_stock || 0), notes:row.notes || undefined, createdAt:row.created_at })),
    inventoryMovements: (inventoryMovements.data || []).map((row:any)=>({id:row.id,inventoryItemId:row.inventory_item_id,saleId:row.sale_id||undefined,productInputId:row.product_input_id||undefined,type:row.movement_type,quantity:Number(row.quantity),balanceAfter:Number(row.balance_after),notes:row.notes||undefined,createdAt:row.created_at,code:row.inventory_items?.code||undefined,name:row.inventory_items?.name||"Insumo",unit:row.inventory_items?.unit||"unidade"})),
    customers: (customers.data || []).map((row: any) => ({ id:row.id, name:row.name, company:row.company_name || row.name, document:row.document || "", phone:row.phone || "", email:row.email || "", address:row.address || "", city:row.city || "", state:row.state || "" })),
    sellers: (sellers.data || []).map((row: any) => ({ id:row.id, name:row.name, phone:row.phone || "", email:row.email || "", active:row.active })),
    sales: (sales.data || []).map((row: any) => ({ id:row.id, number:String(row.sale_number).padStart(6,"0"), date:row.sale_date, customerId:row.customer_id, sellerId:row.seller_id || "", discountCents:cents(row.discount_amount) - (row.sale_items || []).reduce((sum:number,item:any)=>sum+cents(item.discount),0), commissionType:row.commission_type, commissionPercentage:Number(row.commission_percentage || 0), commissionFixedCents:row.commission_type === "fixed" ? cents(row.commission_amount) : 0, shippingCents:cents(row.shipping_cost), feesCents:cents(row.fees), otherCostsCents:cents(row.other_costs), notes:row.notes || "", createdAt:row.created_at, status:row.status,
      items:(row.sale_items || []).map((item:any)=>({ id:item.id, productId:item.product_id, productNameSnapshot:item.product_name_snapshot, productSkuSnapshot:item.product_sku_snapshot, quantity:Number(item.quantity), unitSalePriceCents:cents(item.unit_sale_price), unitCostAtSaleCents:cents(item.unit_cost_at_sale), discountCents:cents(item.discount) })),
      installments:(row.receivables || []).sort((a:any,b:any)=>a.installment_number-b.installment_number).map((item:any)=>({ id:item.id, number:item.installment_number, total:item.installment_count, amountCents:cents(item.amount), dueDate:item.due_date, paidAt:item.received_at ? String(item.received_at).slice(0,10) : undefined, method:methodFromDb[item.payment_method] || "Outros", status:statusFromDb(item.status) })) })),
    expenses: (expenses.data || []).map((row:any)=>({ id:row.id, date:row.expense_date, supplier:row.suppliers?.name || "Sem fornecedor", category:row.expense_categories?.name || "Outros", description:row.description, totalCents:cents(row.total_amount), notes:row.notes || undefined,
      installments:(row.payables || []).sort((a:any,b:any)=>a.installment_number-b.installment_number).map((item:any)=>({ id:item.id, number:item.installment_number, total:item.installment_count, amountCents:cents(item.amount), dueDate:item.due_date, paidAt:item.paid_at ? String(item.paid_at).slice(0,10) : undefined, method:methodFromDb[item.payment_method] || "Outros", status:statusFromDb(item.status) })) })),
    openingBalanceCents:(accounts.data || []).reduce((sum:any,row:any)=>sum+cents(row.opening_balance),0),
    defaultCommissionPercentage:Number(settings.data?.value ?? 10),
    currentProfile:{id:profile.data!.id,fullName:profile.data!.full_name,role:profile.data!.role as AccessRole,active:profile.data!.active??true,mustChangePassword:profile.data!.must_change_password??false},
    users:(users.data||[]).map((row:any)=>({id:row.id,fullName:row.full_name,role:row.role as AccessRole,active:row.active??true,mustChangePassword:row.must_change_password??false})),
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
  const result=await supabase.from("products").insert({id:product.id,name:product.name,sku:product.sku,category_id:category!.id,origin:product.origin==="Importado"?"imported":"manufactured",current_cost:money(product.costCents),suggested_price:product.suggestedPriceCents?money(product.suggestedPriceCents):null,image_url:imageUrl});assert(result.error);
}
export async function saveProductCost(productId:string,costCents:number){const result=await createClient().from("products").update({current_cost:money(costCents)}).eq("id",productId);assert(result.error)}
export async function deleteProduct(productId:string){
  const response=await fetch(`/api/products/${productId}`,{method:"DELETE"});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||"Não foi possível excluir o equipamento.");
}
export async function saveProductInput(input:ProductInput){const supabase=createClient();const existing=await supabase.from("inventory_items").select("id,current_stock").eq("id",input.inventoryItemId).maybeSingle();assert(existing.error);let inventoryId=input.inventoryItemId;if(existing.data){const metadata=await supabase.from("inventory_items").update({code:input.code||null,name:input.name,unit:input.unit,unit_cost:money(input.unitCostCents),minimum_stock:input.minimumStock}).eq("id",input.inventoryItemId);assert(metadata.error);if(Number(existing.data.current_stock)!==input.currentStock){const stock=await supabase.rpc("adjust_inventory_stock",{p_inventory_item_id:input.inventoryItemId,p_new_stock:input.currentStock,p_minimum_stock:input.minimumStock,p_notes:"Ajuste ao editar o insumo"});assert(stock.error)}}else{const inventory=await supabase.from("inventory_items").insert({id:input.inventoryItemId,code:input.code||null,name:input.name,unit:input.unit,unit_cost:money(input.unitCostCents),current_stock:input.currentStock,minimum_stock:input.minimumStock}).select("id").single();assert(inventory.error);inventoryId=inventory.data!.id;if(input.currentStock!==0){const movement=await supabase.from("inventory_movements").insert({inventory_item_id:inventoryId,movement_type:"manual_entry",quantity:input.currentStock,balance_after:input.currentStock,notes:"Estoque inicial do insumo"});assert(movement.error)}}const result=await supabase.from("product_inputs").upsert({id:input.id,product_id:input.productId,inventory_item_id:inventoryId,code:input.code||null,name:input.name,unit:input.unit,quantity:input.quantity,unit_cost:money(input.unitCostCents),notes:input.notes||null});assert(result.error)}
export async function deleteProductInput(id:string){const result=await createClient().from("product_inputs").update({deleted_at:new Date().toISOString()}).eq("id",id);assert(result.error)}
export async function adjustInventoryStock(id:string,currentStock:number,minimumStock:number,notes?:string){const result=await createClient().rpc("adjust_inventory_stock",{p_inventory_item_id:id,p_new_stock:currentStock,p_minimum_stock:minimumStock,p_notes:notes||""});assert(result.error)}
const customerPayload=(customer:Customer)=>({name:customer.name,company_name:customer.company,document:customer.document||null,phone:customer.phone||null,email:customer.email||null,address:customer.address||null,city:customer.city||null,state:customer.state||null});
export async function saveCustomer(customer:Customer){const result=await createClient().from("customers").insert({id:customer.id,...customerPayload(customer)});assert(result.error)}
export async function updateCustomer(customer:Customer){const result=await createClient().from("customers").update(customerPayload(customer)).eq("id",customer.id);assert(result.error)}
export async function saveSeller(seller:Seller){const result=await createClient().from("sellers").insert({id:seller.id,name:seller.name,phone:seller.phone||null,email:seller.email||null,active:seller.active});assert(result.error)}
export async function saveSale(sale:Sale){const supabase=createClient(), totals=calculateSale(sale);const items=sale.items.map(item=>{const total=calculateItem(item);return{product_id:item.productId,product_name_snapshot:item.productNameSnapshot,product_sku_snapshot:item.productSkuSnapshot,quantity:item.quantity,unit_sale_price:money(item.unitSalePriceCents),unit_cost_at_sale:money(item.unitCostAtSaleCents),discount:money(item.discountCents),total_sale:money(total.netCents),total_cost:money(total.costCents),profit:money(total.profitCents),profit_margin:total.margin}});const receivables=sale.installments.map(item=>({number:item.number,total:item.total,amount:money(item.amountCents),due_date:item.dueDate,paid_at:item.paidAt||"",payment_method:methodToDb[item.method],status:item.status}));const result=await supabase.rpc("create_complete_sale",{p_sale:{customer_id:sale.customerId,seller_id:sale.sellerId,sale_date:sale.date,gross_amount:money(totals.grossCents),discount_amount:money(totals.discountCents),net_amount:money(totals.netCents),products_cost:money(totals.productsCostCents),commission_type:sale.commissionType,commission_percentage:sale.commissionPercentage,commission_amount:money(totals.commissionCents),shipping_cost:money(sale.shippingCents),fees:money(sale.feesCents),other_costs:money(sale.otherCostsCents),gross_profit:money(totals.grossProfitCents),profit:money(totals.profitCents),profit_margin:totals.margin,notes:sale.notes},p_items:items,p_receivables:receivables});assert(result.error)}
export async function saveExpense(expense:Expense){const supabase=createClient();let supplier=(await supabase.from("suppliers").select("id").ilike("name",expense.supplier).maybeSingle()).data;if(!supplier){const result=await supabase.from("suppliers").insert({name:expense.supplier}).select("id").single();assert(result.error);supplier=result.data}let category=(await supabase.from("expense_categories").select("id").eq("name",expense.category).is("parent_id",null).maybeSingle()).data;if(!category){const result=await supabase.from("expense_categories").insert({name:expense.category}).select("id").single();assert(result.error);category=result.data}const method=expense.installments[0]?.method||"Outros";const result=await supabase.rpc("create_complete_expense",{p_expense:{expense_date:expense.date,supplier_id:supplier!.id,category_id:category!.id,description:expense.description,total_amount:money(expense.totalCents),payment_method:methodToDb[method],notes:expense.notes||""},p_payables:expense.installments.map(item=>({number:item.number,total:item.total,amount:money(item.amountCents),due_date:item.dueDate,paid_at:item.paidAt||"",payment_method:methodToDb[item.method],status:item.status}))});assert(result.error)}
export async function settleInstallment(kind:"sale"|"expense",id:string){const table=kind==="sale"?"receivables":"payables",dateField=kind==="sale"?"received_at":"paid_at";const result=await createClient().from(table).update({status:"paid",[dateField]:new Date().toISOString()}).eq("id",id);assert(result.error)}
export async function cancelSale(id:string){const result=await createClient().rpc("cancel_sale_and_restore_stock",{p_sale_id:id});assert(result.error)}
export async function deliverSale(id:string){const result=await createClient().rpc("mark_sale_delivered",{p_sale_id:id});assert(result.error)}
export async function saveUserRole(id:string,role:AccessRole){const result=await createClient().from("profiles").update({role}).eq("id",id);assert(result.error)}
