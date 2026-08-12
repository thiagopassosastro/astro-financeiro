# Astro Financeiro

MVP do controle financeiro interno da Astro Equipamentos Esportivos. O painel inclui dashboard, catálogo com histórico de custos, nova venda com cálculo em tempo real, parcelamento, contas a receber/pagar, despesas, fluxo de caixa, projeções, cadastros e relatórios.

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`. Sem variáveis de ambiente, o sistema usa uma base de demonstração persistida no `localStorage` do navegador.

## Supabase

1. Crie um projeto no Supabase.
2. Execute `supabase/migrations/202608110001_initial_schema.sql` no SQL Editor ou com a CLI.
3. Copie `.env.example` para `.env.local` e preencha as chaves.

A migration cria as entidades, relacionamentos, índices, RLS, histórico automático de custos e movimentação de caixa apenas após pagamento/recebimento efetivo.

## Regras protegidas

- Dinheiro usa centavos inteiros no cliente e `numeric(15,2)` no PostgreSQL.
- `sale_items.unit_cost_at_sale` é a fotografia imutável do custo na venda.
- Comissão é salva na própria venda e não muda com configurações futuras.
- Faturamento segue a data da venda; caixa segue a data efetiva de recebimento/pagamento.
- Registros financeiros usam cancelamento/soft delete em vez de exclusão física.

## Verificação

```bash
npm run typecheck
npm test
npm run build
```
