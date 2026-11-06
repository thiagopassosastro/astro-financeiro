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

## Pedidos em duas etapas

A migration `202611060001_two_stage_presales.sql` adapta os dados existentes sem recriar vendas:

- o Estoquista cria rascunhos ou confirma pré-vendas sem valores;
- a confirmação valida a ficha técnica e o saldo e baixa todos os insumos atomicamente;
- alterações confirmadas movimentam somente a diferença e cancelamentos fazem um único estorno;
- o Financeiro precifica o mesmo pedido, cria as parcelas e acompanha recebimentos;
- o fechamento mensal usa a data original do pedido para vendas e a data efetiva para recebimentos;
- respostas operacionais não contêm custos, preços, totais, parcelas ou faturamento.

Execute todas as migrations em ordem antes de iniciar esta versão da aplicação.

## Regras protegidas

- Dinheiro usa centavos inteiros no cliente e `numeric(15,2)` no PostgreSQL.
- `sale_items.unit_cost_at_sale` é a fotografia imutável do custo na venda.
- Comissão é salva na própria venda e não muda com configurações futuras.
- Faturamento segue a data da venda; caixa segue a data efetiva de recebimento/pagamento.
- Pré-vendas pendentes de precificação não são somadas como vendas de valor zero.
- Registros financeiros usam cancelamento/soft delete em vez de exclusão física.

## Verificação

```bash
npm run typecheck
npm test
npm run build
```
