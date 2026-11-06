-- Teste transacional: usa dados temporários e desfaz tudo ao final.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='finance' and active order by created_at limit 1),true);

do $$
declare
  c uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); i uuid:=gen_random_uuid();
  paid_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid(); movement_id uuid:=gen_random_uuid();
  sale_data jsonb; item_data jsonb; payments jsonb; old_stock_movements bigint;
begin
  if not public.is_current_user_finance() then raise exception 'Conta de teste sem perfil financeiro'; end if;
  insert into public.customers(id,name) values(c,'Teste temporário de edição financeira');
  insert into public.products(id,name,sku,origin,current_cost) values(p,'Equipamento de teste',p::text,'manufactured',20);
  insert into public.sales(id,customer_id,sale_date,gross_amount,discount_amount,net_amount,products_cost,commission_type,commission_amount,shipping_cost,fees,other_costs,gross_profit,profit,profit_margin,status,financial_status,created_by)
    values(s,c,current_date,100,0,100,20,'fixed',0,0,0,0,80,80,80,'confirmed','priced',auth.uid());
  insert into public.sale_items(id,sale_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,unit_sale_price,unit_cost_at_sale,discount,total_sale,total_cost,profit,profit_margin)
    values(i,s,p,'Equipamento de teste',p::text,1,100,20,0,100,20,80,80);
  insert into public.receivables(id,sale_id,customer_id,installment_number,installment_count,amount,due_date,received_at,payment_method,status,created_by)
    values(paid_id,s,c,1,2,40,current_date,now(),'pix','paid',auth.uid());
  insert into public.cash_movements(id,movement_date,direction,amount,description,receivable_id,created_by)
    values(movement_id,now(),'in',40,'Recebimento temporário',paid_id,auth.uid());
  insert into public.receivables(id,sale_id,customer_id,installment_number,installment_count,amount,due_date,payment_method,status,created_by)
    values(pending_id,s,c,2,2,60,current_date,'pix','pending',auth.uid());
  select count(*) into old_stock_movements from public.inventory_movements where sale_id=s;

  sale_data:=jsonb_build_object('discount_amount',0,'surcharge_amount',0,'freight_amount',0,'shipping_cost',0,'fees',0,'other_costs',0,'commission_type','percentage','commission_percentage',10,'commission_amount',12);
  item_data:=jsonb_build_array(jsonb_build_object('id',i,'unit_sale_price',120,'discount',0));
  payments:=jsonb_build_array(jsonb_build_object('amount',40,'due_date',current_date,'payment_method','boleto'),jsonb_build_object('amount',40,'due_date',current_date+30,'payment_method','boleto'));
  perform public.edit_sale_financial(s,sale_data,item_data,payments,true,gen_random_uuid());
  if (select net_amount from public.sales where id=s)<>120 or (select commission_amount from public.sales where id=s)<>12 then raise exception 'Total ou comissão não foram atualizados'; end if;
  if not exists(select 1 from public.receivables where id=paid_id and amount=40 and status='paid' and received_at is not null) then raise exception 'Recebimento foi alterado'; end if;
  if not exists(select 1 from public.cash_movements where id=movement_id and receivable_id=paid_id and amount=40) then raise exception 'Caixa foi alterado'; end if;
  if (select count(*) from public.receivables where sale_id=s and status='pending')<>2 or (select sum(amount) from public.receivables where sale_id=s and status='pending')<>80 then raise exception 'Parcelas não fecham o saldo'; end if;
  if (select count(*) from public.inventory_movements where sale_id=s)<>old_stock_movements then raise exception 'Edição movimentou estoque'; end if;

  -- Edição somente da comissão mantém as parcelas sem replanejamento.
  sale_data:=sale_data||jsonb_build_object('commission_type','fixed','commission_amount',15);
  perform public.edit_sale_financial(s,sale_data,item_data,'[]'::jsonb,false,gen_random_uuid());
  if (select commission_amount from public.sales where id=s)<>15 then raise exception 'Comissão fixa não foi salva'; end if;
  if (select count(*) from public.receivables where sale_id=s and status='pending')<>2 then raise exception 'Parcelas foram alteradas sem solicitação'; end if;

  -- Reduzir abaixo do que já foi recebido deve ser bloqueado integralmente.
  begin
    perform public.edit_sale_financial(s,sale_data,jsonb_build_array(jsonb_build_object('id',i,'unit_sale_price',30,'discount',0)),'[]'::jsonb,true,gen_random_uuid());
    raise exception 'Foi permitido reduzir abaixo do recebido';
  exception when others then
    if sqlerrm not like 'O total não pode ser menor que o valor já recebido:%' then raise; end if;
  end;
  if (select net_amount from public.sales where id=s)<>120 then raise exception 'A alteração inválida não foi desfeita'; end if;

  -- Uma pré-venda confirmada também pode receber sua primeira precificação.
  s:=gen_random_uuid(); i:=gen_random_uuid();
  insert into public.sales(id,customer_id,sale_date,status,financial_status,created_by) values(s,c,current_date,'confirmed','pending_pricing',auth.uid());
  insert into public.sale_items(id,sale_id,product_id,product_name_snapshot,product_sku_snapshot,quantity,unit_cost_at_sale,discount)
    values(i,s,p,'Equipamento de teste',p::text,1,20,0);
  item_data:=jsonb_build_array(jsonb_build_object('id',i,'unit_sale_price',100,'discount',0));
  payments:=jsonb_build_array(jsonb_build_object('amount',50,'due_date',current_date,'payment_method','pix'),jsonb_build_object('amount',50,'due_date',current_date+30,'payment_method','pix'));
  perform public.edit_sale_financial(s,sale_data,item_data,payments,true,gen_random_uuid());
  if (select financial_status from public.sales where id=s)<>'priced' or (select sum(amount) from public.receivables where sale_id=s)<>100 then raise exception 'Primeira precificação falhou'; end if;
  select id into pending_id from public.receivables where sale_id=s order by installment_number limit 1;
  perform public.settle_installment_secure('sale',pending_id);
  perform public.settle_installment_secure('sale',pending_id);
  if (select status from public.receivables where id=pending_id)<>'paid' or (select count(*) from public.cash_movements where receivable_id=pending_id)<>1 then raise exception 'Recebimento não foi registrado uma única vez'; end if;

  -- Estoquista não pode acessar a operação financeira.
  perform set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='stock_operator' and active order by created_at limit 1),true);
  begin
    perform public.edit_sale_financial(s,sale_data,item_data,'[]'::jsonb,false,gen_random_uuid());
    raise exception 'Estoquista conseguiu editar finanças';
  exception when others then
    if sqlerrm<>'Acesso restrito ao Financeiro' then raise; end if;
  end;
  raise notice 'Teste concluído: edição, comissão, parcelas, recebimento, caixa, estoque e bloqueio do estoquista';
end;
$$;
rollback;
