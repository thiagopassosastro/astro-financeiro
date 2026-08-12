import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/components/store";

export const metadata: Metadata = { title:"Astro Financeiro", description:"Controle financeiro da Astro Equipamentos Esportivos" };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pt-BR"><body><StoreProvider>{children}</StoreProvider></body></html>; }
