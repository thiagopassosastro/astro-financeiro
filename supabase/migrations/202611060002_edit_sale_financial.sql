-- Edição financeira de vendas históricas e pré-vendas confirmadas.
-- Recebimentos efetivos e suas movimentações de caixa nunca são apagados.
create or replace function public.edit_sale_financial(
  p_sale_id uuid, p_sale jsonb, p_items jsonb, p_receivables jsonb,
  p_replan boolean, p_request_key uuid default gen_random_uuid()
) returns void
language plpgsql security definer set search_path=public as $$
declare
  sale_row public.sales;
  item jsonb;
  installment jsonb;
  old_snapshot jsonb;
  item_count integer;
  paid_amount numeric(15,2);
  pending_amount numeric(15,2);
  new_pending numeric(15,2):=0;
  gross numeric(15,2):=0;
  item_discounts numeric(15,2):=0;
  cost numeric(15,2):=0;
  total_discount numeric(15,2):=coalesce((p_sale->>'discount_amount')::numeric,0);
  surcharge numeric(15,2):=coalesce((p_sale->>'surcharge_amount')::numeric,0);
  freight numeric(15,2):=coalesce((p_sale->>'freight_amount')::numeric,0);
  shipping numeric(15,2):=coalesce((p_sale->>'shipping_cost')::numeric,0);
  v_fees numeric(15,2):=coalesce((p_sale->>'fees')::numeric,0);
  v_other_costs numeric(15,2):=coalesce((p_sale->>'other_costs')::numeric,0);
  commission_kind public.commission_type;
  commission_percent numeric;
  commission_value numeric(15,2);
  net numeric(15,2);
  gross_profit_value numeric(15,2);
  profit_value numeric(15,2);
  next_number integer;
  paid_count integer;
begin
  if not public.is_current_user_finance() then raise exception 'Acesso restrito ao Financeiro'; end if;
  select * into sale_row from public.sales where id=p_sale_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if sale_row.status in ('draft','cancelled') then raise exception 'Somente pedidos confirmados ou entregues podem ser editados financeiramente'; end if;
  if exists(select 1 from public.sale_events where sale_id=p_sale_id and details->>'request_key'=p_request_key::text and event_type='priced') then return; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_typeof(p_receivables)<>'array' then raise exception 'Dados financeiros inválidos'; end if;
  perform 1 from public.receivables where sale_id=p_sale_id order by id for update;
  select count(*) into item_count from public.sale_items where sale_id=p_sale_id;
  if item_count=0 or item_count<>jsonb_array_length(p_items) or item_count<>(select count(distinct value->>'id') from jsonb_array_elements(p_items)) then
    raise exception 'Informe os valores de todos os itens do pedido';
  end if;
  if total_discount<0 or surcharge<0 or freight<0 or shipping<0 or v_fees<0 or v_other_costs<0 then raise exception 'Valores negativos não são permitidos'; end if;

  old_snapshot:=jsonb_build_object('sale',to_jsonb(sale_row),
    'items',(select coalesce(jsonb_agg(to_jsonb(si)),'[]'::jsonb) from public.sale_items si where si.sale_id=p_sale_id),
    'receivables',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.receivables r where r.sale_id=p_sale_id));

  for item in select value from jsonb_array_elements(p_items) loop
    if (item->>'unit_sale_price')::numeric<=0 or (item->>'discount')::numeric<0 then raise exception 'Preço ou desconto inválido'; end if;
    update public.sale_items si set
      unit_sale_price=(item->>'unit_sale_price')::numeric,
      discount=(item->>'discount')::numeric,
      total_sale=round(si.quantity*(item->>'unit_sale_price')::numeric-(item->>'discount')::numeric,2),
      total_cost=round(si.quantity*coalesce(si.unit_cost_at_sale,0),2),
      profit=round(si.quantity*((item->>'unit_sale_price')::numeric-coalesce(si.unit_cost_at_sale,0))-(item->>'discount')::numeric,2),
      profit_margin=case when si.quantity*(item->>'unit_sale_price')::numeric-(item->>'discount')::numeric>0 then
        round((si.quantity*((item->>'unit_sale_price')::numeric-coalesce(si.unit_cost_at_sale,0))-(item->>'discount')::numeric)*100/(si.quantity*(item->>'unit_sale_price')::numeric-(item->>'discount')::numeric),4) else 0 end
    where si.id=(item->>'id')::uuid and si.sale_id=p_sale_id
      and (item->>'discount')::numeric<=si.quantity*(item->>'unit_sale_price')::numeric;
    if not found then raise exception 'Item inválido ou desconto maior que o valor do item'; end if;
  end loop;
  select round(sum(quantity*unit_sale_price),2),sum(discount),sum(total_cost)
    into gross,item_discounts,cost from public.sale_items where sale_id=p_sale_id;
  if total_discount<item_discounts or total_discount>gross then raise exception 'Desconto geral inválido'; end if;
  net:=gross-total_discount+surcharge+freight;
  if net<=0 then raise exception 'O total da venda deve ser maior que zero'; end if;
  commission_kind:=(p_sale->>'commission_type')::public.commission_type;
  commission_percent:=coalesce((p_sale->>'commission_percentage')::numeric,0);
  if commission_percent<0 then raise exception 'Comissão inválida'; end if;
  commission_value:=case when commission_kind='percentage' then round(net*commission_percent/100,2) else coalesce((p_sale->>'commission_amount')::numeric,0) end;
  if commission_value<0 then raise exception 'Comissão inválida'; end if;
  gross_profit_value:=net-cost;
  profit_value:=gross_profit_value-commission_value-shipping-v_fees-v_other_costs;
  select coalesce(sum(amount) filter(where status='paid'),0),
    coalesce(sum(amount) filter(where status in ('pending','overdue')),0),
    count(*) filter(where status='paid')
    into paid_amount,pending_amount,paid_count from public.receivables where sale_id=p_sale_id;
  if net<paid_amount then raise exception 'O total não pode ser menor que o valor já recebido: %',paid_amount; end if;

  if p_replan then
    if exists(select 1 from public.cash_movements cm join public.receivables r on r.id=cm.receivable_id where r.sale_id=p_sale_id and r.status in ('pending','overdue')) then
      raise exception 'Há movimentação de caixa vinculada a parcela pendente. Verifique o recebimento antes de reorganizá-la';
    end if;
    for installment in select value from jsonb_array_elements(p_receivables) loop
      if coalesce((installment->>'amount')::numeric,0)<=0 or nullif(installment->>'due_date','') is null then raise exception 'Parcela ou vencimento inválido'; end if;
      perform (installment->>'payment_method')::public.payment_method;
      new_pending:=new_pending+(installment->>'amount')::numeric;
    end loop;
    if new_pending<>net-paid_amount then raise exception 'As parcelas pendentes devem somar o saldo a receber de %',net-paid_amount; end if;
    delete from public.receivables where sale_id=p_sale_id and status in ('pending','overdue');
    select coalesce(max(installment_number),0) into next_number from public.receivables where sale_id=p_sale_id;
    for installment in select value from jsonb_array_elements(p_receivables) loop
      next_number:=next_number+1;
      insert into public.receivables(sale_id,customer_id,installment_number,installment_count,amount,due_date,payment_method,status,created_by)
      values(p_sale_id,sale_row.customer_id,next_number,paid_count+jsonb_array_length(p_receivables),(installment->>'amount')::numeric,(installment->>'due_date')::date,(installment->>'payment_method')::public.payment_method,'pending',auth.uid());
    end loop;
  elsif paid_amount+pending_amount<>net then
    raise exception 'O valor a receber mudou. Reorganize as parcelas pendentes';
  end if;

  update public.sales set gross_amount=gross,discount_amount=total_discount,surcharge_amount=surcharge,freight_amount=freight,
    net_amount=net,products_cost=cost,commission_type=commission_kind,commission_percentage=case when commission_kind='percentage' then commission_percent else null end,
    commission_amount=commission_value,shipping_cost=shipping,fees=v_fees,other_costs=v_other_costs,gross_profit=gross_profit_value,
    profit=profit_value,profit_margin=round(profit_value*100/net,4),financial_status='priced',
    priced_at=coalesce(priced_at,now()),priced_by=coalesce(priced_by,auth.uid()),updated_at=now() where id=p_sale_id;
  insert into public.audit_log(table_name,record_id,action,old_data,new_data,created_by)
    values('sales',p_sale_id,'financial_update',old_snapshot,jsonb_build_object('request_key',p_request_key,'replanned',p_replan),auth.uid());
  insert into public.sale_events(sale_id,event_type,details,created_by)
    values(p_sale_id,'priced',jsonb_build_object('request_key',p_request_key),auth.uid());
end;
$$;
revoke all on function public.edit_sale_financial(uuid,jsonb,jsonb,jsonb,boolean,uuid) from public;
grant execute on function public.edit_sale_financial(uuid,jsonb,jsonb,jsonb,boolean,uuid) to authenticated;
