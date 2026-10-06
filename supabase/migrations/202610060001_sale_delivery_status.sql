-- Permite finalizar a entrega sem estornar os insumos consumidos pela venda.
alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check
  check (status in ('draft','confirmed','delivered','cancelled'));

create or replace function public.mark_sale_delivered(p_sale_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  sale_status text;
begin
  select status into sale_status from public.sales where id = p_sale_id for update;
  if sale_status is null then raise exception 'Venda não encontrada'; end if;
  if sale_status = 'cancelled' then raise exception 'Uma venda cancelada não pode ser marcada como entregue'; end if;
  if sale_status = 'delivered' then return; end if;

  -- Apenas muda a etapa do pedido. Estoque e contas a receber permanecem intactos.
  update public.sales set status = 'delivered' where id = p_sale_id;
end;
$$;

create or replace function public.cancel_sale_and_restore_stock(p_sale_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  sale_status text;
  movement record;
  new_balance numeric(15,4);
begin
  select status into sale_status from public.sales where id = p_sale_id for update;
  if sale_status is null then raise exception 'Venda não encontrada'; end if;
  if sale_status = 'cancelled' then return; end if;
  if sale_status = 'delivered' then raise exception 'Pedidos entregues não podem ser cancelados'; end if;

  for movement in
    select inventory_item_id, sum(quantity) as quantity
    from public.inventory_movements
    where sale_id = p_sale_id and movement_type = 'sale'
    group by inventory_item_id
  loop
    update public.inventory_items set current_stock = current_stock - movement.quantity
    where id = movement.inventory_item_id returning current_stock into new_balance;
    insert into public.inventory_movements(inventory_item_id, sale_id, movement_type, quantity, balance_after, notes, created_by)
    values(movement.inventory_item_id, p_sale_id, 'sale_cancel', -movement.quantity, new_balance,
      'Estorno automático por cancelamento de venda', auth.uid());
  end loop;

  delete from public.cash_movements where receivable_id in (select id from public.receivables where sale_id = p_sale_id);
  update public.receivables set status = 'cancelled' where sale_id = p_sale_id;
  update public.sales set status = 'cancelled' where id = p_sale_id;
end;
$$;

grant execute on function public.mark_sale_delivered(uuid) to authenticated;

