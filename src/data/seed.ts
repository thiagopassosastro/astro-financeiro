import type { AppState, Expense, Sale } from "@/domain/types";
import { splitInstallments } from "@/domain/finance";

const makeSale = (partial: Pick<Sale, "id"|"number"|"date"|"customerId"|"sellerId"|"items"> & Partial<Sale>): Sale => ({
  discountCents: 0, commissionType: "percentage", commissionPercentage: 10, commissionFixedCents: 0,
  shippingCents: 0, feesCents: 0, otherCostsCents: 0, notes: "", installments: [], createdAt: partial.date, ...partial,
});

const sale1 = makeSale({ id:"sale-145", number:"000145", date:"2026-08-04", customerId:"cust-1", sellerId:"seller-1",
  items:[{id:"si-1",productId:"prod-1",productNameSnapshot:"Esteira Profissional AX9600",productSkuSnapshot:"AX9600",quantity:2,unitSalePriceCents:1_850_000,unitCostAtSaleCents:1_200_000,discountCents:100_000}],
  shippingCents:120_000, feesCents:35_000, notes:"Entrega e instalação inclusas." });
sale1.installments = splitInstallments(3_600_000, 3, "2026-08-10", "Boleto");
sale1.installments[0].status = "paid"; sale1.installments[0].paidAt = "2026-08-10";

const sale2 = makeSale({ id:"sale-146", number:"000146", date:"2026-08-07", customerId:"cust-2", sellerId:"seller-2",
  items:[{id:"si-2",productId:"prod-2",productNameSnapshot:"Bike X-Power",productSkuSnapshot:"XP-BIKE",quantity:5,unitSalePriceCents:890_000,unitCostAtSaleCents:500_000,discountCents:0}],
  discountCents:150_000, shippingCents:80_000 });
sale2.installments = splitInstallments(4_300_000, 2, "2026-08-08", "PIX");
sale2.installments[0].status = "paid"; sale2.installments[0].paidAt = "2026-08-08";

const sale3 = makeSale({ id:"sale-147", number:"000147", date:"2026-07-18", customerId:"cust-3", sellerId:"seller-1",
  items:[{id:"si-3",productId:"prod-3",productNameSnapshot:"Elíptico Truck",productSkuSnapshot:"EL-TRUCK",quantity:3,unitSalePriceCents:1_350_000,unitCostAtSaleCents:800_000,discountCents:50_000}], feesCents:42_000 });
sale3.installments = splitInstallments(4_000_000, 4, "2026-07-25", "Transferência");
sale3.installments[0].status = "paid"; sale3.installments[0].paidAt = "2026-07-25";

const expenses: Expense[] = [
  {id:"exp-1",date:"2026-08-02",supplier:"WEG Motores",category:"Produção",description:"Motores elétricos",totalCents:3_000_000,notes:"Lote de agosto",installments:splitInstallments(3_000_000,3,"2026-08-12","Boleto")},
  {id:"exp-2",date:"2026-08-03",supplier:"Meta",category:"Marketing",description:"Campanhas Meta Ads",totalCents:380_000,installments:splitInstallments(380_000,1,"2026-08-05","Cartão")},
  {id:"exp-3",date:"2026-07-05",supplier:"Galpão Industrial",category:"Estrutura",description:"Aluguel",totalCents:850_000,installments:splitInstallments(850_000,1,"2026-07-10","Transferência")},
];
expenses[1].installments[0].status="paid"; expenses[1].installments[0].paidAt="2026-08-05";
expenses[2].installments[0].status="paid"; expenses[2].installments[0].paidAt="2026-07-10";

export const seed: AppState = {
  openingBalanceCents: 18_000_000, defaultCommissionPercentage: 10,
  products: [
    {id:"prod-1",name:"Esteira Profissional AX9600",sku:"AX9600",category:"Cardio",origin:"Fabricação própria",costCents:1_200_000,suggestedPriceCents:1_890_000,active:true,updatedAt:"2026-06-01"},
    {id:"prod-2",name:"Bike X-Power",sku:"XP-BIKE",category:"Cardio",origin:"Importado",costCents:500_000,suggestedPriceCents:890_000,active:true,updatedAt:"2026-05-12"},
    {id:"prod-3",name:"Elíptico Truck",sku:"EL-TRUCK",category:"Cardio",origin:"Importado",costCents:800_000,suggestedPriceCents:1_390_000,active:true,updatedAt:"2026-04-20"},
  ],
  costHistory: [
    {id:"ch-1",productId:"prod-1",costCents:1_150_000,effectiveAt:"2026-01-01"},{id:"ch-2",productId:"prod-1",costCents:1_200_000,effectiveAt:"2026-06-01"},
    {id:"ch-3",productId:"prod-2",costCents:500_000,effectiveAt:"2026-05-12"},{id:"ch-4",productId:"prod-3",costCents:800_000,effectiveAt:"2026-04-20"},
  ],
  productInputs: [], users: [],
  customers: [
    {id:"cust-1",name:"Rafael Mendes",company:"Academia Arena Fitness",document:"12.345.678/0001-90",phone:"(11) 99988-1122",email:"financeiro@arenafitness.com",address:"",city:"São Paulo",state:"SP"},
    {id:"cust-2",name:"Mariana Costa",company:"Studio Move+",document:"23.456.789/0001-10",phone:"(19) 99811-2211",email:"mariana@movemais.com",address:"",city:"Campinas",state:"SP"},
    {id:"cust-3",name:"Paulo Viana",company:"Clube Forma",document:"34.567.890/0001-21",phone:"(21) 99722-3344",email:"compras@clubeforma.com",address:"",city:"Rio de Janeiro",state:"RJ"},
  ],
  sellers: [
    {id:"seller-1",name:"Camila Rocha",phone:"(11) 98888-1000",email:"camila@astro.com.br",active:true},
    {id:"seller-2",name:"Lucas Andrade",phone:"(11) 97777-2000",email:"lucas@astro.com.br",active:true},
  ],
  sales:[sale1,sale2,sale3], expenses,
};
