-- Restaura a movimentação automática do estoque ao registrar ou cancelar pedidos.
-- Também impede vínculos duplicados do mesmo item de estoque no mesmo equipamento.

with ranked as (
  select id,
         row_number() over (
           partition by product_id, inventory_item_id
           order by created_at asc, id asc
         ) as position
  from public.product_inputs
  where deleted_at is null
)
update public.product_inputs pi
set deleted_at = now()
from ranked r
where pi.id = r.id and r.position > 1;

-- Elimina variações duplicadas de código e de nome (maiúsculas e espaços extras).
with ranked as (
  select id,
         row_number() over (
           partition by product_id, lower(btrim(code))
           order by created_at asc, id asc
         ) as position
  from public.product_inputs
  where deleted_at is null and nullif(btrim(code), '') is not null
)
update public.product_inputs pi
set deleted_at = now()
from ranked r
where pi.id = r.id and r.position > 1;

with ranked as (
  select id,
         row_number() over (
           partition by product_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
           order by created_at asc, id asc
         ) as position
  from public.product_inputs
  where deleted_at is null
)
update public.product_inputs pi
set deleted_at = now()
from ranked r
where pi.id = r.id and r.position > 1;

create unique index if not exists product_inputs_unique_active_inventory_per_product
on public.product_inputs(product_id, inventory_item_id)
where deleted_at is null;

create unique index if not exists product_inputs_unique_active_code_per_product
on public.product_inputs(product_id, lower(btrim(code)))
where deleted_at is null and nullif(btrim(code), '') is not null;

create unique index if not exists product_inputs_unique_active_normalized_name_per_product
on public.product_inputs(product_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
where deleted_at is null;

create or replace function public.create_complete_sale(p_sale jsonb, p_items jsonb, p_receivables jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  new_sale public.sales;
  item jsonb;
  installment jsonb;
  component record;
  new_balance numeric(15,4);
begin
  insert into public.sales(
    customer_id, seller_id, sale_date, gross_amount, discount_amount, net_amount, products_cost,
    commission_type, commission_percentage, commission_amount, shipping_cost, fees, other_costs,
    gross_profit, profit, profit_margin, notes, created_by
  ) values (
    (p_sale->>'customer_id')::uuid, nullif(p_sale->>'seller_id','')::uuid, (p_sale->>'sale_date')::date,
    (p_sale->>'gross_amount')::numeric, (p_sale->>'discount_amount')::numeric, (p_sale->>'net_amount')::numeric,
    (p_sale->>'products_cost')::numeric, (p_sale->>'commission_type')::public.commission_type,
    nullif(p_sale->>'commission_percentage','')::numeric, (p_sale->>'commission_amount')::numeric,
    (p_sale->>'shipping_cost')::numeric, (p_sale->>'fees')::numeric, (p_sale->>'other_costs')::numeric,
    (p_sale->>'gross_profit')::numeric, (p_sale->>'profit')::numeric, (p_sale->>'profit_margin')::numeric,
    nullif(p_sale->>'notes',''), auth.uid()
  ) returning * into new_sale;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.sale_items(
      sale_id, product_id, product_name_snapshot, product_sku_snapshot, quantity, unit_sale_price,
      unit_cost_at_sale, discount, total_sale, total_cost, profit, profit_margin, created_by
    ) values (
      new_sale.id, (item->>'product_id')::uuid, item->>'product_name_snapshot', item->>'product_sku_snapshot',
      (item->>'quantity')::numeric, (item->>'unit_sale_price')::numeric, (item->>'unit_cost_at_sale')::numeric,
      (item->>'discount')::numeric, (item->>'total_sale')::numeric, (item->>'total_cost')::numeric,
      (item->>'profit')::numeric, (item->>'profit_margin')::numeric, auth.uid()
    );
  end loop;

  -- Consolida o consumo por item de estoque e altera cada saldo uma única vez.
  for component in
    select
      pi.inventory_item_id,
      (array_agg(pi.id order by pi.created_at asc, pi.id asc))[1] as product_input_id,
      sum(pi.quantity * si.quantity)::numeric(15,4) as consumed
    from public.sale_items si
    join public.product_inputs pi
      on pi.product_id = si.product_id
     and pi.deleted_at is null
    where si.sale_id = new_sale.id
    group by pi.inventory_item_id
  loop
    update public.inventory_items
    set current_stock = current_stock - component.consumed
    where id = component.inventory_item_id
    returning current_stock into new_balance;

    if not found then
      raise exception 'Insumo de estoque não encontrado: %', component.inventory_item_id;
    end if;

    insert into public.inventory_movements(
      inventory_item_id, sale_id, product_input_id, movement_type, quantity, balance_after, notes, created_by
    ) values (
      component.inventory_item_id, new_sale.id, component.product_input_id, 'sale', -component.consumed,
      new_balance, 'Baixa automática da venda ' || new_sale.sale_number, auth.uid()
    );
  end loop;

  for installment in select * from jsonb_array_elements(p_receivables) loop
    insert into public.receivables(
      sale_id, customer_id, installment_number, installment_count, amount, due_date,
      received_at, payment_method, status, created_by
    ) values (
      new_sale.id, new_sale.customer_id, (installment->>'number')::int, (installment->>'total')::int,
      (installment->>'amount')::numeric, (installment->>'due_date')::date,
      nullif(installment->>'paid_at','')::timestamptz, (installment->>'payment_method')::public.payment_method,
      (installment->>'status')::public.financial_status, auth.uid()
    );
  end loop;

  return jsonb_build_object('id', new_sale.id, 'sale_number', new_sale.sale_number);
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
    update public.inventory_items
    set current_stock = current_stock - movement.quantity
    where id = movement.inventory_item_id
    returning current_stock into new_balance;

    insert into public.inventory_movements(
      inventory_item_id, sale_id, movement_type, quantity, balance_after, notes, created_by
    ) values (
      movement.inventory_item_id, p_sale_id, 'sale_cancel', -movement.quantity, new_balance,
      'Estorno automático por cancelamento de venda', auth.uid()
    );
  end loop;

  delete from public.cash_movements where receivable_id in (select id from public.receivables where sale_id = p_sale_id);
  update public.receivables set status = 'cancelled' where sale_id = p_sale_id;
  update public.sales set status = 'cancelled' where id = p_sale_id;
end;
$$;

grant execute on function public.create_complete_sale(jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.cancel_sale_and_restore_stock(uuid) to authenticated;

comment on function public.create_complete_sale(jsonb,jsonb,jsonb)
is 'Cria a venda e baixa automaticamente os insumos, consolidados por item de estoque.';
comment on function public.cancel_sale_and_restore_stock(uuid)
is 'Cancela a venda e devolve automaticamente ao estoque somente as baixas registradas para ela.';
