-- Produtos de revenda podem ser cadastrados sem ficha de insumos.
alter table public.products drop constraint if exists products_origin_check;
alter table public.products add constraint products_origin_check
  check (origin in ('manufactured','imported','resale'));

create or replace function public.validate_and_apply_sale_stock(p_sale_id uuid, p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare
  sale_row public.sales;
  invalid_bom text;
  shortage text;
  component record;
  new_balance numeric(15,4);
  revision integer;
begin
  perform public.require_order_operator();
  select * into sale_row from public.sales where id=p_sale_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if sale_row.status='cancelled' then raise exception 'Pedido cancelado não pode movimentar estoque'; end if;

  -- Uma ficha vazia é permitida. Fichas existentes com componentes inválidos não são.
  select string_agg(distinct p.name, ', ' order by p.name) into invalid_bom
  from public.sale_items si join public.products p on p.id=si.product_id
  where si.sale_id=p_sale_id and exists (
    select 1 from public.product_inputs pi left join public.inventory_items ii on ii.id=pi.inventory_item_id
    where pi.product_id=si.product_id and pi.deleted_at is null
      and (pi.quantity<=0 or ii.id is null or ii.deleted_at is not null)
  );
  if invalid_bom is not null then raise exception 'Equipamentos com ficha técnica inválida: %',invalid_bom; end if;

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
  if shortage is not null then raise exception 'Saldo insuficiente. %',shortage; end if;

  revision:=sale_row.stock_revision+1;
  for component in
    with desired as (
      select pi.inventory_item_id,(array_agg(pi.id order by pi.created_at,pi.id))[1] product_input_id,sum(pi.quantity*si.quantity)::numeric(15,4) qty
      from public.sale_items si join public.product_inputs pi on pi.product_id=si.product_id and pi.deleted_at is null
      where si.sale_id=p_sale_id group by pi.inventory_item_id
    ), allocations as (
      select inventory_item_id,quantity from public.sale_inventory_allocations where sale_id=p_sale_id
    ), combined as (
      select coalesce(d.inventory_item_id,a.inventory_item_id) inventory_item_id,d.product_input_id,coalesce(d.qty,0) desired_qty,coalesce(a.quantity,0) old_qty
      from desired d full join allocations a on a.inventory_item_id=d.inventory_item_id
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
