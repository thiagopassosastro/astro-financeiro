-- Informações operacionais usadas pela planilha de pedidos em produção.
alter table public.sales add column if not exists delivery_deadline date;
alter table public.sales add column if not exists delivery_location text;

create or replace function public.create_complete_sale_with_delivery(p_sale jsonb, p_items jsonb, p_receivables jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  created_sale jsonb;
begin
  created_sale := public.create_complete_sale(p_sale, p_items, p_receivables);
  update public.sales
  set delivery_deadline = nullif(p_sale->>'delivery_deadline','')::date,
      delivery_location = nullif(p_sale->>'delivery_location','')
  where id = (created_sale->>'id')::uuid;
  return created_sale;
end;
$$;

grant execute on function public.create_complete_sale_with_delivery(jsonb,jsonb,jsonb) to authenticated;

comment on column public.sales.delivery_deadline is 'Prazo máximo de entrega combinado com o cliente.';
comment on column public.sales.delivery_location is 'Local de entrega específico deste pedido.';
