import type { AppState } from "@/domain/types";

export const emptyState: AppState = {
  products: [], costHistory: [], productInputs: [], customers: [], sellers: [], sales: [], expenses: [], users: [],
  defaultCommissionPercentage: 10, openingBalanceCents: 0,
};
