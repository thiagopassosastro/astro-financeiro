-- Testa em transação revertida, sem persistir produtos, pedidos ou estoques de teste.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='stock_operator' and active order by created_at limit 1),true);
do $$
<<test_case>>
declare
  customer uuid:=gen_random_uuid(); resale uuid:=gen_random_uuid(); manufactured uuid:=gen_random_uuid(); other_product uuid:=gen_random_uuid();
  material uuid:=gen_random_uuid(); other_material uuid:=gen_random_uuid(); cat uuid; sale_id uuid; other_sale uuid; result jsonb; request_id uuid:=gen_random_uuid();
  order_data jsonb; mixed jsonb; inputs jsonb; snapshot jsonb; stock_before numeric;
begin
  if not public.is_current_user_active() or public.is_current_user_finance() then raise exception 'Conta de teste deve ser estoquista'; end if;
  select id into cat from public.product_categories where name='Cardio' limit 1;
  insert into public.customers(id,name) values(customer,'Teste temporário de pré-venda');
  perform public.save_product_secure(jsonb_build_object('id',resale,'name','Produto revenda de teste','sku',resale::text,'category_id',cat,'origin','resale','current_cost',999,'suggested_price',999,'image_url',''));
  if not exists(select 1 from public.products where id=resale and origin='resale' and current_cost=0 and suggested_price is null) then raise exception 'Cadastro operacional não preservou a proteção financeira'; end if;
  insert into public.products(id,name,sku,origin,current_cost) values
    (manufactured,'Produto com insumo de teste',manufactured::text,'manufactured',10),
    (other_product,'Produto de outro pedido',other_product::text,'manufactured',10);
  insert into public.inventory_items(id,name,unit,current_stock,minimum_stock,unit_cost) values
    (material,'Insumo de teste','unidade',20,0,1),(other_material,'Insumo de outro pedido','unidade',20,0,1);
  insert into public.product_inputs(id,product_id,inventory_item_id,name,unit,quantity,unit_cost) values
    (gen_random_uuid(),manufactured,material,'Insumo de teste','unidade',2,1),
    (gen_random_uuid(),other_product,other_material,'Insumo de outro pedido','unidade',1,1);
  order_data:=jsonb_build_object('customer_id',customer,'sale_date',current_date,'notes','Teste');
  mixed:=jsonb_build_array(jsonb_build_object('product_id',resale,'quantity',3),jsonb_build_object('product_id',manufactured,'quantity',2));
  result:=public.create_pre_sale(order_data,mixed,true,request_id); sale_id:=(result->>'id')::uuid;
  if (select current_stock from public.inventory_items where id=material)<>16 then raise exception 'Baixa de pedido misto incorreta'; end if;
  if (select count(*) from public.inventory_movements m where m.sale_id=test_case.sale_id)<>1 then raise exception 'Pedido sem insumos criou movimentos indevidos'; end if;
  result:=public.create_pre_sale(order_data,mixed,true,request_id);
  perform public.confirm_pre_sale(sale_id,gen_random_uuid());
  if (result->>'id')::uuid<>sale_id or (select current_stock from public.inventory_items where id=material)<>16 then raise exception 'Reenvio duplicou pedido ou baixa'; end if;

  inputs:=jsonb_build_array(jsonb_build_object('product_id',other_product,'quantity',5));
  other_sale:=(public.create_pre_sale(order_data,inputs,true,gen_random_uuid())->>'id')::uuid;
  if (select current_stock from public.inventory_items where id=other_material)<>15 then raise exception 'Baixa do outro pedido incorreta'; end if;
  mixed:=jsonb_build_array(jsonb_build_object('product_id',resale,'quantity',1),jsonb_build_object('product_id',manufactured,'quantity',3));
  perform public.update_pre_sale_operational(sale_id,order_data,mixed,gen_random_uuid());
  if (select current_stock from public.inventory_items where id=material)<>14 then raise exception 'Alteração não aplicou apenas a diferença'; end if;
  if (select current_stock from public.inventory_items where id=other_material)<>15 then raise exception 'Alteração afetou estoque de outro pedido'; end if;

  begin
    mixed:=jsonb_build_array(jsonb_build_object('product_id',resale,'quantity',1),jsonb_build_object('product_id',manufactured,'quantity',100));
    perform public.update_pre_sale_operational(sale_id,order_data,mixed,gen_random_uuid());
    raise exception 'Falta de estoque não foi bloqueada';
  exception when others then if sqlerrm not like 'Saldo insuficiente.%' then raise; end if; end;
  if (select current_stock from public.inventory_items where id=material)<>14 then raise exception 'Operação incompleta alterou saldo'; end if;
  if (select sum(si.quantity) from public.sale_items si where si.sale_id=test_case.sale_id and si.product_id=manufactured)<>3 then raise exception 'Alteração parcial do pedido não foi revertida'; end if;

  snapshot:=public.load_application_state();
  if exists(select 1 from jsonb_array_elements(snapshot->'products') p where p->>'id'=resale::text and (p?'current_cost' or p?'suggested_price')) then raise exception 'Resposta operacional expôs valores financeiros'; end if;
  perform set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='finance' and active order by created_at limit 1),true);
  perform public.cancel_sale_and_restore_stock(sale_id);
  perform public.cancel_sale_and_restore_stock(sale_id);
  if (select current_stock from public.inventory_items where id=material)<>20 or (select current_stock from public.inventory_items where id=other_material)<>15 then raise exception 'Estorno incorreto ou afetou outro pedido'; end if;
end;
$$;
rollback;
