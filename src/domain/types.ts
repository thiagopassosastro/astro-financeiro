export type PaymentStatus = "pending" | "paid" | "overdue" | "cancelled";
export type PaymentMethod = "PIX" | "Dinheiro" | "Transferência" | "Boleto" | "Cartão" | "Cheque" | "Outros";
export type AccessRole = "admin" | "stock_operator";
export interface UserProfile {
  id: string; fullName: string; role: AccessRole; email?: string; active: boolean;
  mustChangePassword: boolean; lastSignInAt?: string;
}

export interface Product {
  id: string; name: string; sku: string; category: string; origin: "Fabricação própria" | "Importado";
  costCents: number; suggestedPriceCents?: number; imageUrl?: string; active: boolean; description?: string; updatedAt: string;
}
export interface CostHistory { id: string; productId: string; costCents: number; effectiveAt: string; }
export interface ProductInput {
  id: string; productId: string; inventoryItemId: string; code?: string; name: string; unit: string;
  quantity: number; unitCostCents: number; currentStock: number; minimumStock: number; notes?: string; createdAt: string;
}
export interface InventoryMovement {
  id: string; inventoryItemId: string; saleId?: string; productInputId?: string;
  type: "manual_entry" | "manual_adjustment" | "sale" | "sale_cancel";
  quantity: number; balanceAfter: number; notes?: string; createdAt: string;
  code?: string; name: string; unit: string;
}
export interface Customer { id: string; name: string; company: string; document: string; phone: string; email: string; address: string; city: string; state: string; }
export interface Seller { id: string; name: string; phone: string; email: string; active: boolean; }
export interface SaleItem {
  id: string; productId: string; productNameSnapshot: string; productSkuSnapshot: string;
  quantity: number; unitSalePriceCents: number; unitCostAtSaleCents: number; discountCents: number;
}
export interface Installment {
  id: string; number: number; total: number; amountCents: number; dueDate: string; paidAt?: string;
  method: PaymentMethod; status: PaymentStatus;
}
export interface Sale {
  id: string; number: string; date: string; customerId: string; sellerId: string; items: SaleItem[];
  discountCents: number; commissionType: "percentage" | "fixed"; commissionPercentage: number;
  commissionFixedCents: number; shippingCents: number; feesCents: number; otherCostsCents: number;
  notes: string; deliveryDeadline?: string; deliveryLocation?: string; installments: Installment[]; createdAt: string; status?: "draft" | "confirmed" | "delivered" | "cancelled";
}
export interface Expense {
  id: string; date: string; supplier: string; category: string; description: string;
  totalCents: number; installments: Installment[]; notes?: string;
}
export interface AppState {
  products: Product[]; costHistory: CostHistory[]; productInputs: ProductInput[]; inventoryMovements: InventoryMovement[]; customers: Customer[]; sellers: Seller[];
  sales: Sale[]; expenses: Expense[]; defaultCommissionPercentage: number; openingBalanceCents: number;
  currentProfile?: UserProfile; users: UserProfile[];
}
