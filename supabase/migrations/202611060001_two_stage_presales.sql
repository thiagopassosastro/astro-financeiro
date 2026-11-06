-- Pedidos em duas etapas: operação/estoque primeiro, precificação depois.
-- A migration preserva vendas antigas, marcando-as como já precificadas.

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'finance' where role in ('admin', 'manager');
update public.profiles set role = 'stock_operator' where role not in ('finance', 'stock_operator');
alter table public.profiles alter column role set default 'stock_operator';
alter table public.profiles add constraint profiles_role_check check (role in ('finance', 'stock_operator'));

create or replace function public.is_current_user_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'finance' and active = true
  );
$$;

-- Compatibilidade com rotinas antigas que verificavam administrador.
create or replace function public.is_current_user_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_current_user_finance();
$$;

alter table public.sales add column if not exists financial_status text;
alter table public.sales add column if not exists surcharge_amount numeric(15,2) not null default 0 check(surcharge_amount>=0);
alter table public.sales add column if not exists freight_amount numeric(15,2) not null default 0 check(freight_amount>=0);
alter table public.sales drop constraint if exists sales_check;
alter table public.sales add constraint sales_total_with_additions_check
  check(net_amount is null or net_amount=gross_amount-discount_amount+surcharge_amount+freight_amount);
update public.sales set financial_status = 'priced' where financial_status is null;
alter table public.sales alter column financial_status set default 'pending_pricing';
alter table public.sales alter column financial_status set not null;
alter table public.sales drop constraint if exists sales_financial_status_check;
alter table public.sales add constraint sales_financial_status_check
  check (financial_status in ('pending_pricing', 'priced'));

alter table public.sales add column if not exists confirmed_at timestamptz;
alter table public.sales add column if not exists confirmed_by uuid references public.profiles(id);
alter table public.sales add column if not exists priced_at timestamptz;
alter table public.sales add column if not exists priced_by uuid references public.profiles(id);
alter table public.sales add column if not exists cancelled_at timestamptz;
alter table public.sales add column if not exists cancelled_by uuid references public.profiles(id);
alter table public.sales add column if not exists last_operational_update_at timestamptz;
alter table public.sales add column if not exists last_operational_update_by uuid references public.profiles(id);
alter table public.sales add column if not exists stock_revision integer not null default 0;
alter table public.sales add column if not exists stock_applied boolean not null default false;
alter table public.sales add column if not exists create_request_key uuid;
create unique index if not exists sales_create_request_key_unique on public.sales(create_request_key) where create_request_key is not null;

update public.sales
set confirmed_at = coalesce(confirmed_at, created_at),
    confirmed_by = coalesce(confirmed_by, created_by),
    priced_at = coalesce(priced_at, created_at),
    priced_by = coalesce(priced_by, created_by),
    stock_applied = status <> 'draft',
    stock_revision = case when status <> 'draft' then greatest(stock_revision, 1) else stock_revision end;

-- Pré-vendas não têm valores até o financeiro concluir a precificação.
alter table public.sales alter column gross_amount drop not null;
alter table public.sales alter column net_amount drop not null;
alter table public.sales alter column products_cost drop not null;
alter table public.sales alter column commission_type drop not null;
alter table public.sales alter column commission_amount drop not null;
alter table public.sales alter column gross_profit drop not null;
alter table public.sales alter column profit drop not null;
alter table public.sales alter column profit_margin drop not null;
alter table public.sale_items alter column unit_sale_price drop not null;
alter table public.sale_items alter column unit_cost_at_sale drop not null;
alter table public.sale_items alter column total_sale drop not null;
alter table public.sale_items alter column total_cost drop not null;
alter table public.sale_items alter column profit drop not null;
alter table public.sale_items alter column profit_margin drop not null;

create table if not exists public.sale_inventory_allocations (
  sale_id uuid not null references public.sales(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric(15,4) not null check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (sale_id, inventory_item_id)
);

-- Reconstrói o consumo vigente das vendas antigas para que cancelamentos futuros
-- também sejam estornados pelo novo razão idempotente.
insert into public.sale_inventory_allocations(sale_id,inventory_item_id,quantity)
select m.sale_id,m.inventory_item_id,greatest(0,-sum(m.quantity))::numeric(15,4)
from public.inventory_movements m join public.sales s on s.id=m.sale_id
where m.sale_id is not null and m.movement_type in ('sale','sale_adjustment') and s.status<>'cancelled'
group by m.sale_id,m.inventory_item_id
having greatest(0,-sum(m.quantity))>0
on conflict(sale_id,inventory_item_id) do update set quantity=excluded.quantity,updated_at=now();

create table if not exists public.sale_events (
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales(id),
  event_type text not null check (event_type in ('created','confirmed','operational_updated','priced','cancelled','payment_received')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id)
);
create index if not exists idx_sale_events_sale_date on public.sale_events(sale_id, created_at desc);

alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('manual_entry','manual_adjustment','sale','sale_adjustment','sale_cancel'));
alter table public.inventory_movements add column if not exists idempotency_key text;
create unique index if not exists inventory_movements_idempotency_key_unique
  on public.inventory_movements(idempotency_key) where idempotency_key is not null;

alter table public.sale_inventory_allocations enable row level security;
alter table public.sale_events enable row level security;
drop policy if exists finance_allocations on public.sale_inventory_allocations;
create policy finance_allocations on public.sale_inventory_allocations for select to authenticated
  using (public.is_current_user_finance());
drop policy if exists finance_events on public.sale_events;
create policy finance_events on public.sale_events for select to authenticated
  using (public.is_current_user_finance());

-- O estoquista pode cadastrar clientes e ler apenas o recorte operacional via RPC.
drop policy if exists admin_only_access on public.customers;
create policy customer_active_access on public.customers for select to authenticated
  using (public.is_current_user_active());
create policy customer_stock_insert on public.customers for insert to authenticated
  with check (public.is_current_user_active());
create policy customer_stock_update on public.customers for update to authenticated
  using (public.is_current_user_active()) with check (public.is_current_user_active());

-- Tabelas financeiras continuam inacessíveis ao estoquista por RLS.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'suppliers','sellers','sale_payments','receivables','expense_categories','expenses','payables',
    'bank_accounts','cash_movements','settings','audit_log'
  ] loop
    execute format('drop policy if exists "admin_only_access" on public.%I', table_name);
    execute format('create policy "finance_only_access" on public.%I for all to authenticated using (public.is_current_user_finance()) with check (public.is_current_user_finance())', table_name);
  end loop;
end $$;

drop policy if exists admin_only_access on public.sales;
drop policy if exists finance_only_access on public.sales;
create policy finance_sales on public.sales for all to authenticated
  using (public.is_current_user_finance()) with check (public.is_current_user_finance());
drop policy if exists admin_only_access on public.sale_items;
drop policy if exists finance_only_access on public.sale_items;
create policy finance_sale_items on public.sale_items for all to authenticated
  using (public.is_current_user_finance()) with check (public.is_current_user_finance());

create or replace function public.require_order_operator()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_current_user_active() then raise exception 'Usuário inativo'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and role in ('stock_operator','finance')) then
    raise exception 'Sem permissão para operar pedidos';
  end if;
end;
$$;

-- Snapshot único para a aplicação. O JSON do estoquista não contém nenhuma chave financeira.
create or replace function public.load_application_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  finance boolean := public.is_current_user_finance();
  result jsonb;
begin
  if not public.is_current_user_active() then raise exception 'Usuário inativo'; end if;
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id=auth.uid()),
    'products', coalesce((select jsonb_agg(
      case when finance then to_jsonb(p) || jsonb_build_object('category_name',pc.name)
      else (to_jsonb(p) - array['current_cost','suggested_price']) || jsonb_build_object('category_name',pc.name) end
      order by p.name)
      from public.products p left join public.product_categories pc on pc.id=p.category_id where p.deleted_at is null),'[]'::jsonb),
    'cost_history', case when finance then coalesce((select jsonb_agg(to_jsonb(h) order by h.effective_at desc) from public.product_cost_history h),'[]'::jsonb) else '[]'::jsonb end,
    'product_inputs', coalesce((select jsonb_agg(
      case when finance then to_jsonb(pi) || jsonb_build_object('inventory',to_jsonb(ii))
      else (to_jsonb(pi)-array['unit_cost']) || jsonb_build_object('inventory',to_jsonb(ii)-array['unit_cost']) end
      order by pi.created_at)
      from public.product_inputs pi join public.inventory_items ii on ii.id=pi.inventory_item_id
      where pi.deleted_at is null and ii.deleted_at is null),'[]'::jsonb),
    'inventory_movements', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('inventory',to_jsonb(ii)-array['unit_cost']) order by m.created_at desc)
      from (select * from public.inventory_movements order by created_at desc limit 5000) m
      join public.inventory_items ii on ii.id=m.inventory_item_id),'[]'::jsonb),
    'customers', coalesce((select jsonb_agg(to_jsonb(c) order by coalesce(c.company_name,c.name)) from public.customers c where c.deleted_at is null),'[]'::jsonb),
    'sellers', case when finance then coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.sellers s where s.deleted_at is null),'[]'::jsonb) else '[]'::jsonb end,
    'sales', coalesce((select jsonb_agg(
      (case when finance then to_jsonb(s)
       else to_jsonb(s)-array['gross_amount','discount_amount','surcharge_amount','freight_amount','net_amount','products_cost','commission_type','commission_percentage','commission_amount','shipping_cost','fees','other_costs','gross_profit','profit','profit_margin','priced_at','priced_by'] end)
      || jsonb_build_object(
        'items',coalesce((select jsonb_agg(case when finance then to_jsonb(si) else to_jsonb(si)-array['unit_sale_price','unit_cost_at_sale','discount','total_sale','total_cost','profit','profit_margin'] end order by si.created_at) from public.sale_items si where si.sale_id=s.id),'[]'::jsonb),
        'receivables',case when finance then coalesce((select jsonb_agg(to_jsonb(r) order by r.installment_number) from public.receivables r where r.sale_id=s.id),'[]'::jsonb) else '[]'::jsonb end,
        'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.sale_events e where e.sale_id=s.id),'[]'::jsonb)
      ) order by s.sale_date desc,s.sale_number desc)
      from public.sales s where s.deleted_at is null),'[]'::jsonb),
    'expenses', case when finance then coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object(
      'supplier_name',sp.name,'category_name',ec.name,
      'payables',coalesce((select jsonb_agg(to_jsonb(pa) order by pa.installment_number) from public.payables pa where pa.expense_id=e.id),'[]'::jsonb)
      ) order by e.expense_date desc) from public.expenses e left join public.suppliers sp on sp.id=e.supplier_id left join public.expense_categories ec on ec.id=e.category_id where e.deleted_at is null),'[]'::jsonb) else '[]'::jsonb end,
    'opening_balance', case when finance then coalesce((select sum(opening_balance) from public.bank_accounts where active),0) else 0 end,
    'default_commission', case when finance then coalesce((select value from public.settings where key='default_commission_percentage'),'10'::jsonb) else '0'::jsonb end,
    'users', case when finance then coalesce((select jsonb_agg(to_jsonb(u) order by u.created_at) from public.profiles u),'[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end;
$$;

create or replace function public.validate_and_apply_sale_stock(p_sale_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  sale_row public.sales;
  missing_bom text;
  shortage text;
  component record;
  new_balance numeric(15,4);
  revision integer;
begin
  perform public.require_order_operator();
  select * into sale_row from public.sales where id=p_sale_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if sale_row.status='cancelled' then raise exception 'Pedido cancelado não pode movimentar estoque'; end if;

  select string_agg(p.name, ', ' order by p.name) into missing_bom
  from public.sale_items si join public.products p on p.id=si.product_id
  where si.sale_id=p_sale_id and (
    not exists (select 1 from public.product_inputs pi join public.inventory_items ii on ii.id=pi.inventory_item_id where pi.product_id=si.product_id and pi.deleted_at is null and ii.deleted_at is null and pi.quantity>0)
    or exists (select 1 from public.product_inputs pi left join public.inventory_items ii on ii.id=pi.inventory_item_id where pi.product_id=si.product_id and pi.deleted_at is null and (pi.quantity<=0 or ii.id is null or ii.deleted_at is not null))
  );
  if missing_bom is not null then raise exception 'Equipamentos sem ficha técnica válida: %', missing_bom; end if;

  -- Bloqueia todos os insumos envolvidos antes de validar saldos.
  perform 1 from public.inventory_items ii where ii.id in (
    select pi.inventory_item_id from public.sale_items si join public.product_inputs pi on pi.product_id=si.product_id and pi.deleted_at is null where si.sale_id=p_sale_id
    union select inventory_item_id from public.sale_inventory_allocations where sale_id=p_sale_id
  ) order by ii.id for update;

  with desired as (
    select pi.inventory_item_id,sum(pi.quantity*si.quantity)::numeric(15,4) qty
    from public.sale_items si join public.product_inputs pi on pi.product_id=si.product_id and pi.deleted_at is null
    where si.sale_id=p_sale_id group by pi.inventory_item_id
  ), deltas as (
    select d.inventory_item_id,d.qty-coalesce(a.quantity,0) delta
    from desired d left join public.sale_inventory_allocations a on a.sale_id=p_sale_id and a.inventory_item_id=d.inventory_item_id
  )
  select string_agg(format('%s: disponível %s, necessário %s',ii.name,ii.current_stock,d.delta),'; ' order by ii.name) into shortage
  from deltas d join public.inventory_items ii on ii.id=d.inventory_item_id where d.delta>ii.current_stock;
  if shortage is not null then raise exception 'Saldo insuficiente. %', shortage; end if;

  revision := sale_row.stock_revision+1;
  for component in
    with desired as (
      select pi.inventory_item_id,(array_agg(pi.id order by pi.created_at,pi.id))[1] product_input_id,sum(pi.quantity*si.quantity)::numeric(15,4) qty
      from public.sale_items si join public.product_inputs pi on pi.product_id=si.product_id and pi.deleted_at is null
      where si.sale_id=p_sale_id group by pi.inventory_item_id
    ), combined as (
      select coalesce(d.inventory_item_id,a.inventory_item_id) inventory_item_id,d.product_input_id,coalesce(d.qty,0) desired_qty,coalesce(a.quantity,0) old_qty
      from desired d full join public.sale_inventory_allocations a on a.sale_id=p_sale_id and a.inventory_item_id=d.inventory_item_id
    ) select *,desired_qty-old_qty delta from combined where desired_qty<>old_qty
  loop
    update public.inventory_items set current_stock=current_stock-component.delta where id=component.inventory_item_id returning current_stock into new_balance;
    insert into public.inventory_movements(inventory_item_id,sale_id,product_input_id,movement_type,quantity,balance_after,notes,created_by,idempotency_key)
    values(component.inventory_item_id,p_sale_id,component.product_input_id,case when sale_row.stock_applied then 'sale_adjustment' else 'sale' end,-component.delta,new_balance,p_reason,auth.uid(),p_sale_id::text||':stock:'||revision||':'||component.inventory_item_id::text);
  end loop;

  delete from public.sale_inventory_allocations where sale_id=p_sale_id;
  insert into public.sale_inventory_allocations(sale_id,inventory_item_id,quantity)
  select p_sale_id,pi.inventory_item_id,sum(pi.quantity*si.quantity)::numeric(15,4)
  from public.sale_items si join public.product_inputs pi on pi.product_id=si.product_id and pi.deleted_at is null
  where si.sale_id=p_sale_id group by pi.inventory_item_id;
  update public.sales set stock_applied=true,stock_revision=revision where id=p_sale_id;
end;
$$;

create or replace function public.create_pre_sale(p_order jsonb,p_items jsonb,p_confirm boolean default false,p_request_key uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path = public as $$
declare new_sale public.sales; item jsonb;
begin
  perform public.require_order_operator();
  perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,0));
  select * into new_sale from public.sales where create_request_key=p_request_key;
  if found then return jsonb_build_object('id',new_sale.id,'sale_number',new_sale.sale_number,'status',new_sale.status,'already_created',true); end if;
  if coalesce(jsonb_array_length(p_items),0)=0 then raise exception 'Adicione ao menos um equipamento'; end if;
  insert into public.sales(customer_id,sale_date,status,financial_status,notes,delivery_deadline,delivery_location,created_by,create_request_key)
  values((p_order->>'customer_id')::uuid,(p_order->>'sale_date')::date,'draft','pending_pricing',nullif(p_order->>'notes',''),nullif(p_order->>'delivery_deadline','')::date,nullif(p_order->>'delivery_location',''),auth.uid(),p_request_key) returning * into new_sale;
  for item in select * from jsonb_array_elements(p_items) loop
    if (item->>'quantity')::numeric<=0 then raise exception 'Quantidade inválida'; end if;
    insert into public.sale_items(sale_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,unit_cost_at_sale,discount,created_by)
    select new_sale.id,p.id,p.name,p.sku,(item->>'quantity')::numeric,p.current_cost,0,auth.uid() from public.products p where p.id=(item->>'product_id')::uuid and p.deleted_at is null;
    if not found then raise exception 'Equipamento inválido'; end if;
  end loop;
  insert into public.sale_events(sale_id,event_type,details,created_by) values(new_sale.id,'created',jsonb_build_object('request_key',p_request_key,'confirmed',p_confirm),auth.uid());
  if p_confirm then perform public.confirm_pre_sale(new_sale.id,p_request_key); end if;
  return jsonb_build_object('id',new_sale.id,'sale_number',new_sale.sale_number,'status',case when p_confirm then 'confirmed' else 'draft' end);
end;
$$;

create or replace function public.confirm_pre_sale(p_sale_id uuid,p_request_key uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path = public as $$
declare row_status text; number bigint;
begin
  perform public.require_order_operator();
  select status,sale_number into row_status,number from public.sales where id=p_sale_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if row_status='cancelled' then raise exception 'Pedido cancelado'; end if;
  if row_status<>'draft' then return jsonb_build_object('id',p_sale_id,'sale_number',number,'already_confirmed',true); end if;
  perform public.validate_and_apply_sale_stock(p_sale_id,'Baixa na confirmação da pré-venda '||number);
  update public.sales set status='confirmed',confirmed_at=now(),confirmed_by=auth.uid() where id=p_sale_id;
  insert into public.sale_events(sale_id,event_type,details,created_by) values(p_sale_id,'confirmed',jsonb_build_object('request_key',p_request_key),auth.uid());
  return jsonb_build_object('id',p_sale_id,'sale_number',number,'already_confirmed',false);
end;
$$;

create or replace function public.update_pre_sale_operational(p_sale_id uuid,p_order jsonb,p_items jsonb,p_request_key uuid default gen_random_uuid())
returns void language plpgsql security definer set search_path = public as $$
declare old_status text; old_financial_status text; item jsonb;
begin
  perform public.require_order_operator();
  select status,financial_status into old_status,old_financial_status from public.sales where id=p_sale_id for update;
  if old_status is null then raise exception 'Pedido não encontrado'; end if;
  if old_status in ('cancelled','delivered') then raise exception 'Pedido encerrado não pode ser alterado'; end if;
  if old_financial_status='priced' then raise exception 'Pedido já precificado. Reabra a precificação antes de alterar os equipamentos'; end if;
  if coalesce(jsonb_array_length(p_items),0)=0 then raise exception 'Adicione ao menos um equipamento'; end if;
  delete from public.sale_items where sale_id=p_sale_id;
  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.sale_items(sale_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,unit_cost_at_sale,discount,created_by)
    select p_sale_id,p.id,p.name,p.sku,(item->>'quantity')::numeric,p.current_cost,0,auth.uid() from public.products p where p.id=(item->>'product_id')::uuid and p.deleted_at is null;
  end loop;
  update public.sales set customer_id=(p_order->>'customer_id')::uuid,sale_date=(p_order->>'sale_date')::date,notes=nullif(p_order->>'notes',''),delivery_deadline=nullif(p_order->>'delivery_deadline','')::date,delivery_location=nullif(p_order->>'delivery_location',''),last_operational_update_at=now(),last_operational_update_by=auth.uid() where id=p_sale_id;
  if old_status<>'draft' then perform public.validate_and_apply_sale_stock(p_sale_id,'Ajuste da pré-venda por diferença'); end if;
  insert into public.sale_events(sale_id,event_type,details,created_by) values(p_sale_id,'operational_updated',jsonb_build_object('request_key',p_request_key),auth.uid());
end;
$$;

create or replace function public.price_pre_sale(p_sale_id uuid,p_sale jsonb,p_items jsonb,p_receivables jsonb,p_request_key uuid default gen_random_uuid())
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; installment jsonb; sale_status text;
begin
  if not public.is_current_user_finance() then raise exception 'Acesso restrito ao Financeiro'; end if;
  select status into sale_status from public.sales where id=p_sale_id for update;
  if sale_status is null then raise exception 'Pedido não encontrado'; end if;
  if sale_status in ('draft','cancelled') then raise exception 'Somente pré-vendas confirmadas podem ser precificadas'; end if;
  update public.sales set gross_amount=(p_sale->>'gross_amount')::numeric,discount_amount=(p_sale->>'discount_amount')::numeric,surcharge_amount=coalesce((p_sale->>'surcharge_amount')::numeric,0),freight_amount=coalesce((p_sale->>'freight_amount')::numeric,0),net_amount=(p_sale->>'net_amount')::numeric,products_cost=(p_sale->>'products_cost')::numeric,commission_type=(p_sale->>'commission_type')::public.commission_type,commission_percentage=nullif(p_sale->>'commission_percentage','')::numeric,commission_amount=(p_sale->>'commission_amount')::numeric,shipping_cost=(p_sale->>'shipping_cost')::numeric,fees=(p_sale->>'fees')::numeric,other_costs=(p_sale->>'other_costs')::numeric,gross_profit=(p_sale->>'gross_profit')::numeric,profit=(p_sale->>'profit')::numeric,profit_margin=(p_sale->>'profit_margin')::numeric,financial_status='priced',priced_at=now(),priced_by=auth.uid() where id=p_sale_id;
  for item in select * from jsonb_array_elements(p_items) loop
    update public.sale_items set unit_sale_price=(item->>'unit_sale_price')::numeric,unit_cost_at_sale=(item->>'unit_cost_at_sale')::numeric,discount=(item->>'discount')::numeric,total_sale=(item->>'total_sale')::numeric,total_cost=(item->>'total_cost')::numeric,profit=(item->>'profit')::numeric,profit_margin=(item->>'profit_margin')::numeric where id=(item->>'id')::uuid and sale_id=p_sale_id;
    if not found then raise exception 'Item financeiro não pertence ao pedido'; end if;
  end loop;
  if exists(select 1 from public.sale_items where sale_id=p_sale_id and (unit_sale_price is null or unit_sale_price<=0 or unit_cost_at_sale is null)) then raise exception 'Todos os itens precisam de preço e custo válidos'; end if;
  if (select count(*) from public.sale_items where sale_id=p_sale_id)<>jsonb_array_length(p_items) then raise exception 'A precificação deve incluir todos os itens do pedido'; end if;
  if (select sum(quantity*unit_sale_price) from public.sale_items where sale_id=p_sale_id)<>(p_sale->>'gross_amount')::numeric then raise exception 'Total bruto inconsistente com os itens'; end if;
  delete from public.cash_movements where receivable_id in (select id from public.receivables where sale_id=p_sale_id and status<>'paid');
  delete from public.receivables where sale_id=p_sale_id and status<>'paid';
  if exists(select 1 from public.receivables where sale_id=p_sale_id and status='paid') then raise exception 'Não é possível refazer parcelas após existir recebimento'; end if;
  for installment in select * from jsonb_array_elements(p_receivables) loop
    insert into public.receivables(sale_id,customer_id,installment_number,installment_count,amount,due_date,received_at,payment_method,status,created_by)
    select p_sale_id,s.customer_id,(installment->>'number')::int,(installment->>'total')::int,(installment->>'amount')::numeric,(installment->>'due_date')::date,nullif(installment->>'paid_at','')::timestamptz,(installment->>'payment_method')::public.payment_method,(installment->>'status')::public.financial_status,auth.uid() from public.sales s where s.id=p_sale_id;
  end loop;
  if (select coalesce(sum(amount),0) from public.receivables where sale_id=p_sale_id and status<>'cancelled')<>(p_sale->>'net_amount')::numeric then raise exception 'A soma das parcelas deve ser igual ao total do pedido'; end if;
  insert into public.sale_events(sale_id,event_type,details,created_by) values(p_sale_id,'priced',jsonb_build_object('request_key',p_request_key),auth.uid());
end;
$$;

create or replace function public.cancel_sale_and_restore_stock(p_sale_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare sale_status text; allocation record; new_balance numeric(15,4); revision integer;
begin
  if not public.is_current_user_finance() then raise exception 'Apenas o Financeiro pode cancelar pedidos'; end if;
  select status,stock_revision into sale_status,revision from public.sales where id=p_sale_id for update;
  if sale_status is null then raise exception 'Pedido não encontrado'; end if;
  if sale_status='cancelled' then return; end if;
  if sale_status='delivered' then raise exception 'Pedidos entregues não podem ser cancelados'; end if;
  for allocation in select * from public.sale_inventory_allocations where sale_id=p_sale_id and quantity>0 order by inventory_item_id for update loop
    update public.inventory_items set current_stock=current_stock+allocation.quantity where id=allocation.inventory_item_id returning current_stock into new_balance;
    insert into public.inventory_movements(inventory_item_id,sale_id,movement_type,quantity,balance_after,notes,created_by,idempotency_key)
    values(allocation.inventory_item_id,p_sale_id,'sale_cancel',allocation.quantity,new_balance,'Estorno por cancelamento da pré-venda',auth.uid(),p_sale_id::text||':cancel:'||allocation.inventory_item_id::text) on conflict(idempotency_key) where idempotency_key is not null do nothing;
  end loop;
  delete from public.sale_inventory_allocations where sale_id=p_sale_id;
  delete from public.cash_movements where receivable_id in (select id from public.receivables where sale_id=p_sale_id);
  update public.receivables set status='cancelled' where sale_id=p_sale_id;
  update public.sales set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),stock_applied=false where id=p_sale_id;
  insert into public.sale_events(sale_id,event_type,created_by) values(p_sale_id,'cancelled',auth.uid());
end;
$$;

grant execute on function public.load_application_state() to authenticated;
grant execute on function public.create_pre_sale(jsonb,jsonb,boolean,uuid) to authenticated;
grant execute on function public.confirm_pre_sale(uuid,uuid) to authenticated;
grant execute on function public.update_pre_sale_operational(uuid,jsonb,jsonb,uuid) to authenticated;
grant execute on function public.price_pre_sale(uuid,jsonb,jsonb,jsonb,uuid) to authenticated;
grant execute on function public.cancel_sale_and_restore_stock(uuid) to authenticated;
revoke execute on function public.create_complete_sale(jsonb,jsonb,jsonb) from public,authenticated;
revoke execute on function public.create_complete_sale_with_delivery(jsonb,jsonb,jsonb) from public,authenticated;

create or replace function public.mark_sale_delivered(p_sale_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare sale_status text;
begin
  if not public.is_current_user_finance() then raise exception 'Acesso restrito ao Financeiro'; end if;
  select status into sale_status from public.sales where id=p_sale_id for update;
  if sale_status is null then raise exception 'Pedido não encontrado'; end if;
  if sale_status='cancelled' then raise exception 'Pedido cancelado não pode ser entregue'; end if;
  if sale_status='draft' then raise exception 'Confirme a pré-venda antes da entrega'; end if;
  update public.sales set status='delivered' where id=p_sale_id and status<>'delivered';
end;
$$;

create or replace function public.track_sale_receipt_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='paid' and old.status is distinct from 'paid' then
    insert into public.sale_events(sale_id,event_type,details,created_by)
    values(new.sale_id,'payment_received',jsonb_build_object('receivable_id',new.id,'received_at',coalesce(new.received_at,now())),auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists receivable_sale_event on public.receivables;
create trigger receivable_sale_event after update of status on public.receivables for each row execute function public.track_sale_receipt_event();

-- Novos usuários entram como estoquistas; o Financeiro promove quando necessário.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,full_name,role,active,must_change_password)
  values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(new.email,'@',1)),
    case when exists(select 1 from public.profiles) then 'stock_operator' else 'finance' end,true,
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean,false))
  on conflict(id) do nothing;
  return new;
end;
$$;

-- Custos nunca são gravados diretamente por um estoquista.
create or replace function public.set_product_cost_secure(p_product_id uuid,p_cost numeric)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_current_user_finance() then raise exception 'Acesso restrito ao Financeiro'; end if;
  if p_cost<0 then raise exception 'Custo inválido'; end if;
  update public.products set current_cost=p_cost where id=p_product_id and deleted_at is null;
  if not found then raise exception 'Equipamento não encontrado'; end if;
end;
$$;

create or replace function public.save_product_secure(p_product jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare finance boolean:=public.is_current_user_finance();
begin
  perform public.require_order_operator();
  insert into public.products(id,name,sku,category_id,origin,current_cost,suggested_price,image_url,created_by)
  values((p_product->>'id')::uuid,p_product->>'name',p_product->>'sku',(p_product->>'category_id')::uuid,p_product->>'origin',
    case when finance then coalesce((p_product->>'current_cost')::numeric,0) else 0 end,
    case when finance then nullif(p_product->>'suggested_price','')::numeric else null end,
    nullif(p_product->>'image_url',''),auth.uid());
end;
$$;

create or replace function public.save_product_input_secure(p_input jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare inventory_id uuid; existing public.inventory_items; code_value text:=nullif(upper(btrim(p_input->>'code')),''); requested_stock numeric:=coalesce((p_input->>'current_stock')::numeric,0); old_stock numeric; new_cost numeric;
begin
  perform public.require_order_operator();
  select * into existing from public.inventory_items where id=(p_input->>'inventory_item_id')::uuid and deleted_at is null for update;
  if not found and code_value is not null then select * into existing from public.inventory_items where code=code_value and deleted_at is null for update; end if;
  if found then
    inventory_id:=existing.id;old_stock:=existing.current_stock;new_cost:=case when public.is_current_user_finance() then coalesce((p_input->>'unit_cost')::numeric,existing.unit_cost) else existing.unit_cost end;
    update public.inventory_items set code=code_value,name=p_input->>'name',unit=p_input->>'unit',unit_cost=new_cost,minimum_stock=(p_input->>'minimum_stock')::numeric where id=inventory_id;
  else
    inventory_id:=(p_input->>'inventory_item_id')::uuid;old_stock:=0;new_cost:=case when public.is_current_user_finance() then coalesce((p_input->>'unit_cost')::numeric,0) else 0 end;
    insert into public.inventory_items(id,code,name,unit,unit_cost,current_stock,minimum_stock,created_by) values(inventory_id,code_value,p_input->>'name',p_input->>'unit',new_cost,0,(p_input->>'minimum_stock')::numeric,auth.uid());
  end if;
  insert into public.product_inputs(id,product_id,inventory_item_id,code,name,unit,quantity,unit_cost,notes,created_by,deleted_at)
  values((p_input->>'id')::uuid,(p_input->>'product_id')::uuid,inventory_id,code_value,p_input->>'name',p_input->>'unit',(p_input->>'quantity')::numeric,new_cost,nullif(p_input->>'notes',''),auth.uid(),null)
  on conflict(id) do update set inventory_item_id=excluded.inventory_item_id,code=excluded.code,name=excluded.name,unit=excluded.unit,quantity=excluded.quantity,unit_cost=excluded.unit_cost,notes=excluded.notes,deleted_at=null;
  if requested_stock<>old_stock then perform public.adjust_inventory_stock(inventory_id,requested_stock,(p_input->>'minimum_stock')::numeric,'Ajuste ao salvar insumo'); end if;
end;
$$;

grant execute on function public.set_product_cost_secure(uuid,numeric) to authenticated;
grant execute on function public.save_product_secure(jsonb) to authenticated;
grant execute on function public.save_product_input_secure(jsonb) to authenticated;

create or replace function public.adjust_inventory_stock(p_inventory_item_id uuid,p_new_stock numeric,p_minimum_stock numeric,p_notes text default null)
returns void language plpgsql security definer set search_path=public as $$
declare old_stock numeric(15,4);
begin
  perform public.require_order_operator();
  if p_new_stock<0 then raise exception 'Estoque atual não pode ser negativo'; end if;
  if p_minimum_stock<0 then raise exception 'Estoque mínimo não pode ser negativo'; end if;
  select current_stock into old_stock from public.inventory_items where id=p_inventory_item_id and deleted_at is null for update;
  if old_stock is null then raise exception 'Insumo não encontrado'; end if;
  update public.inventory_items set current_stock=p_new_stock,minimum_stock=p_minimum_stock where id=p_inventory_item_id;
  if p_new_stock<>old_stock then
    insert into public.inventory_movements(inventory_item_id,movement_type,quantity,balance_after,notes,created_by)
    values(p_inventory_item_id,case when p_new_stock>old_stock then 'manual_entry' else 'manual_adjustment' end,p_new_stock-old_stock,p_new_stock,nullif(p_notes,''),auth.uid());
  end if;
end;
$$;

-- Defesa em profundidade: consultas manuais do papel authenticated só enxergam
-- as colunas operacionais. A aplicação financeira lê o snapshot pela função segura.
revoke select on public.products,public.product_cost_history,public.product_inputs,public.inventory_items,
  public.sales,public.sale_items,public.receivables,public.expenses,public.payables,public.bank_accounts,
  public.cash_movements,public.settings,public.sale_payments from authenticated;
grant select(id,name,sku,category_id,description,origin,active,notes,created_at,updated_at,created_by,deleted_at,image_url) on public.products to authenticated;
grant select(id,product_id,inventory_item_id,code,name,unit,quantity,notes,created_at,created_by,deleted_at) on public.product_inputs to authenticated;
grant select(id,code,name,unit,current_stock,minimum_stock,created_at,updated_at,created_by,deleted_at) on public.inventory_items to authenticated;

revoke insert,update on public.products,public.product_inputs,public.inventory_items from authenticated;
grant insert(id,name,sku,category_id,description,origin,active,notes,created_by,image_url) on public.products to authenticated;
grant update(name,sku,category_id,description,origin,active,notes,deleted_at,image_url) on public.products to authenticated;
grant update(deleted_at) on public.product_inputs to authenticated;

comment on column public.sales.financial_status is 'pending_pricing = pré-venda operacional; priced = financeiro concluído.';
comment on table public.sale_inventory_allocations is 'Consumo líquido vigente do pedido; base para ajustes por diferença e estorno idempotente.';
comment on function public.load_application_state() is 'Contrato de leitura seguro: remove custos, preços, totais, parcelas e datas financeiras do estoquista.';
