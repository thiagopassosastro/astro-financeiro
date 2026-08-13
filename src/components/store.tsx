"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { AccessRole, AppState, Customer, Expense, Product, ProductInput, Sale, Seller } from "@/domain/types";
import { emptyState } from "@/data/empty-state";
import { createClient } from "@/lib/supabase/client";
import { adjustInventoryStock, cancelSale as cancelSaleInDb, deleteProduct, deleteProductInput, loadAppState, saveCustomer, saveExpense, saveProduct, saveProductCost, saveProductInput, saveSale, saveSeller, saveUserRole, settleInstallment, updateCustomer as updateCustomerInDb } from "@/lib/supabase/repository";

interface StoreValue {
  state: AppState; loading: boolean; syncError: string;
  addSale:(sale:Sale)=>Promise<void>; addProduct:(product:Product)=>Promise<void>; removeProduct:(id:string)=>Promise<void>; updateProductCost:(id:string,cost:number)=>Promise<void>;
  addExpense:(expense:Expense)=>Promise<void>; addCustomer:(customer:Customer)=>Promise<void>; updateCustomer:(customer:Customer)=>Promise<void>; addSeller:(seller:Seller)=>Promise<void>;
  addProductInput:(input:ProductInput)=>Promise<void>; removeProductInput:(id:string)=>Promise<void>;
  updateInventoryStock:(inventoryItemId:string,currentStock:number,minimumStock:number,notes?:string)=>Promise<void>; cancelSale:(id:string)=>Promise<void>;
  updateUserRole:(id:string,role:AccessRole)=>Promise<void>;
  markInstallment:(kind:"sale"|"expense",parentId:string,id:string)=>Promise<void>; refresh:()=>Promise<void>; signOut:()=>Promise<void>; resetDemo:()=>void;
}
const Store=createContext<StoreValue|null>(null);

export function StoreProvider({children}:{children:React.ReactNode}) {
  const [state,setState]=useState<AppState>(emptyState); const [loading,setLoading]=useState(true); const [syncError,setSyncError]=useState("");
  const refresh=async()=>{try{const {data:{user}}=await createClient().auth.getUser();if(user)setState(await loadAppState())}catch(error){setSyncError(error instanceof Error?error.message:"Não foi possível carregar os dados.")}finally{setLoading(false)}};
  useEffect(()=>{void refresh()},[]);
  const run=async(optimistic:(current:AppState)=>AppState,operation:()=>Promise<void>)=>{const before=state;setState(optimistic);setSyncError("");try{await operation();await refresh()}catch(error){setState(before);setSyncError(error instanceof Error?error.message:"Não foi possível salvar a alteração.");throw error}};
  const value:StoreValue={state,loading,syncError,refresh,
    addSale:(sale)=>run(current=>({...current,sales:[sale,...current.sales]}),()=>saveSale(sale)),
    addProduct:(product)=>run(current=>({...current,products:[product,...current.products]}),()=>saveProduct(product)),
    removeProduct:(id)=>run(current=>({...current,products:current.products.filter(product=>product.id!==id),productInputs:current.productInputs.filter(input=>input.productId!==id),costHistory:current.costHistory.filter(item=>item.productId!==id)}),()=>deleteProduct(id)),
    addProductInput:(input)=>run(current=>({...current,productInputs:[...current.productInputs,input]}),()=>saveProductInput(input)),
    removeProductInput:(id)=>run(current=>({...current,productInputs:current.productInputs.filter(input=>input.id!==id)}),()=>deleteProductInput(id)),
    updateInventoryStock:(inventoryItemId,currentStock,minimumStock,notes)=>run(current=>({...current,productInputs:current.productInputs.map(input=>input.inventoryItemId===inventoryItemId?{...input,currentStock,minimumStock}:input)}),()=>adjustInventoryStock(inventoryItemId,currentStock,minimumStock,notes)),
    cancelSale:(id)=>run(current=>({...current,sales:current.sales.map(sale=>sale.id===id?{...sale,status:"cancelled"}:sale)}),()=>cancelSaleInDb(id)),
    updateUserRole:(id,role)=>run(current=>({...current,users:current.users.map(user=>user.id===id?{...user,role}:user),currentProfile:current.currentProfile?.id===id?{...current.currentProfile,role}:current.currentProfile}),()=>saveUserRole(id,role)),
    updateProductCost:(id,cost)=>run(current=>({...current,products:current.products.map(product=>product.id===id?{...product,costCents:cost,updatedAt:new Date().toISOString().slice(0,10)}:product)}),()=>saveProductCost(id,cost)),
    addExpense:(expense)=>run(current=>({...current,expenses:[expense,...current.expenses]}),()=>saveExpense(expense)),
    addCustomer:(customer)=>run(current=>({...current,customers:[customer,...current.customers]}),()=>saveCustomer(customer)),
    updateCustomer:(customer)=>run(current=>({...current,customers:current.customers.map(item=>item.id===customer.id?customer:item)}),()=>updateCustomerInDb(customer)),
    addSeller:(seller)=>run(current=>({...current,sellers:[seller,...current.sellers]}),()=>saveSeller(seller)),
    markInstallment:(kind,parentId,id)=>run(current=>kind==="sale"?{...current,sales:current.sales.map(item=>item.id===parentId?{...item,installments:item.installments.map(part=>part.id===id?{...part,status:"paid",paidAt:new Date().toISOString().slice(0,10)}:part)}:item)}:{...current,expenses:current.expenses.map(item=>item.id===parentId?{...item,installments:item.installments.map(part=>part.id===id?{...part,status:"paid",paidAt:new Date().toISOString().slice(0,10)}:part)}:item)},()=>settleInstallment(kind,id)),
    signOut:async()=>{await createClient().auth.signOut();window.location.href="/login"}, resetDemo:()=>setState(emptyState),
  };
  return <Store.Provider value={value}>{loading&&<div className="app-loading"><div className="loading-brand">ASTRO</div><span>Carregando financeiro...</span></div>}{syncError&&<button className="sync-error" onClick={()=>setSyncError("")}>{syncError}<span>×</span></button>}{children}</Store.Provider>;
}
export const useStore=()=>{const value=useContext(Store);if(!value)throw new Error("StoreProvider ausente");return value};
