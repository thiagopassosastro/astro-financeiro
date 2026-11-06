-- Entrada pelo alerta: soma sobre o saldo mais recente e registra a movimentação.
create or replace function public.restock_inventory(p_inventory_item_id uuid,p_quantity numeric,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  stock_row public.inventory_items;
  prior public.inventory_movements;
  movement_key text;
begin
  perform public.require_order_operator();
  if p_inventory_item_id is null or p_request_key is null then raise exception 'Insumo ou identificador da entrada inválido'; end if;
  if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<=0
    or p_quantity<>round(p_quantity,4) then
    raise exception 'Informe uma quantidade positiva com até quatro casas decimais';
  end if;
  movement_key:='restock:'||p_request_key::text;
  perform pg_advisory_xact_lock(hashtextextended(movement_key,0));
  select * into stock_row from public.inventory_items where id=p_inventory_item_id and deleted_at is null for update;
  if not found then raise exception 'Insumo não encontrado'; end if;
  select * into prior from public.inventory_movements where idempotency_key=movement_key;
  if found then
    if prior.inventory_item_id<>p_inventory_item_id or prior.quantity<>p_quantity or prior.created_by is distinct from auth.uid() then
      raise exception 'Identificador de entrada já utilizado para outra operação';
    end if;
    return jsonb_build_object('current_stock',stock_row.current_stock,'minimum_stock',stock_row.minimum_stock,'already_recorded',true);
  end if;
  update public.inventory_items set current_stock=current_stock+p_quantity
    where id=p_inventory_item_id returning * into stock_row;
  insert into public.inventory_movements(inventory_item_id,movement_type,quantity,balance_after,notes,created_by,idempotency_key)
    values(p_inventory_item_id,'manual_entry',p_quantity,stock_row.current_stock,'Entrada de reposição pelo alerta de estoque',auth.uid(),movement_key);
  return jsonb_build_object('current_stock',stock_row.current_stock,'minimum_stock',stock_row.minimum_stock,'already_recorded',false);
end;
$$;
revoke all on function public.restock_inventory(uuid,numeric,uuid) from public,anon;
grant execute on function public.restock_inventory(uuid,numeric,uuid) to authenticated;
