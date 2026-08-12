-- Estoque global de insumos, compartilhado entre as fichas técnicas dos equipamentos.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  unit text not null default 'unidade',
  unit_cost numeric(15,4) not null default 0 check(unit_cost >= 0),
  current_stock numeric(15,4) not null default 0,
  minimum_stock numeric(15,4) not null default 0 check(minimum_stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  deleted_at timestamptz
);

create index idx_inventory_items_code on public.inventory_items(lower(code))
where code is not null and btrim(code) <> '' and deleted_at is null;
create index idx_inventory_items_low_stock on public.inventory_items(current_stock, minimum_stock)
where deleted_at is null;
create trigger set_updated_at before update on public.inventory_items
for each row execute function public.set_updated_at();

alter table public.product_inputs
add column inventory_item_id uuid references public.inventory_items(id);

-- Preserva as composições já cadastradas, criando o respectivo item de estoque.
insert into public.inventory_items(id, code, name, unit, unit_cost, created_at, updated_at, created_by, deleted_at)
select id, code, name, unit, unit_cost, created_at, updated_at, created_by, deleted_at
from public.product_inputs;

update public.product_inputs
set inventory_item_id = id
where inventory_item_id is null;

alter table public.product_inputs alter column inventory_item_id set not null;
create index idx_product_inputs_inventory on public.product_inputs(inventory_item_id)
where deleted_at is null;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id),
  sale_id uuid references public.sales(id),
  product_input_id uuid references public.product_inputs(id),
  movement_type text not null check(movement_type in ('manual_entry','manual_adjustment','sale','sale_cancel')),
  quantity numeric(15,4) not null check(quantity <> 0),
  balance_after numeric(15,4) not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create index idx_inventory_movements_item_date on public.inventory_movements(inventory_item_id, created_at desc);
create index idx_inventory_movements_sale on public.inventory_movements(sale_id) where sale_id is not null;

alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
create policy "authenticated_access" on public.inventory_items for all to authenticated using (true) with check (true);
create policy "authenticated_access" on public.inventory_movements for all to authenticated using (true) with check (true);

-- Venda e consumo de insumos são gravados atomicamente.
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
  consumed numeric(15,4);
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

    for component in
      select pi.id, pi.inventory_item_id, pi.quantity
      from public.product_inputs pi
      where pi.product_id = (item->>'product_id')::uuid and pi.deleted_at is null
    loop
      consumed := component.quantity * (item->>'quantity')::numeric;
      update public.inventory_items
      set current_stock = current_stock - consumed
      where id = component.inventory_item_id
      returning current_stock into new_balance;

      insert into public.inventory_movements(
        inventory_item_id, sale_id, product_input_id, movement_type, quantity, balance_after, notes, created_by
      ) values (
        component.inventory_item_id, new_sale.id, component.id, 'sale', -consumed, new_balance,
        'Baixa automática da venda ' || new_sale.sale_number, auth.uid()
      );
    end loop;
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

create or replace function public.adjust_inventory_stock(
  p_inventory_item_id uuid, p_new_stock numeric, p_minimum_stock numeric, p_notes text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare
  old_stock numeric(15,4);
begin
  select current_stock into old_stock from public.inventory_items where id = p_inventory_item_id for update;
  if old_stock is null then raise exception 'Insumo não encontrado'; end if;
  if p_minimum_stock < 0 then raise exception 'Estoque mínimo não pode ser negativo'; end if;
  update public.inventory_items set current_stock = p_new_stock, minimum_stock = p_minimum_stock
  where id = p_inventory_item_id;
  if p_new_stock <> old_stock then
    insert into public.inventory_movements(inventory_item_id, movement_type, quantity, balance_after, notes, created_by)
    values(p_inventory_item_id, case when p_new_stock > old_stock then 'manual_entry' else 'manual_adjustment' end,
      p_new_stock - old_stock, p_new_stock, nullif(p_notes,''), auth.uid());
  end if;
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

grant execute on function public.adjust_inventory_stock(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.cancel_sale_and_restore_stock(uuid) to authenticated;

comment on table public.inventory_items is 'Cadastro e saldo global dos insumos usados na fabricação.';
comment on table public.inventory_movements is 'Razão imutável das entradas, ajustes, baixas por venda e estornos.';
