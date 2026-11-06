-- Exercita a entrada com dados temporários; o rollback preserva os dados reais.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='stock_operator' and active order by created_at limit 1),true);
do $$
declare
  item uuid:=gen_random_uuid(); first_key uuid:=gen_random_uuid(); second_key uuid:=gen_random_uuid(); result jsonb;
begin
  if not public.is_current_user_active() or public.is_current_user_finance() then raise exception 'Conta de teste deve ser estoquista'; end if;
  insert into public.inventory_items(id,name,unit,current_stock,minimum_stock,unit_cost) values(item,'Reposição temporária','unidade',370,400,0);
  result:=public.restock_inventory(item,30,first_key);
  if (result->>'current_stock')::numeric<>400 or (result->>'minimum_stock')::numeric<>400 then raise exception 'Entrada até o mínimo não foi somada'; end if;
  if (select current_stock>minimum_stock from public.inventory_items where id=item) then raise exception 'Igual ao mínimo não deve sair do alerta'; end if;
  result:=public.restock_inventory(item,30,first_key);
  if (result->>'already_recorded')::boolean is not true or (select current_stock from public.inventory_items where id=item)<>400 then raise exception 'Reenvio duplicou a entrada'; end if;
  result:=public.restock_inventory(item,1,second_key);
  if (result->>'current_stock')::numeric<>401 or not (select current_stock>minimum_stock from public.inventory_items where id=item) then raise exception 'Saldo acima do mínimo deve sair do alerta'; end if;
  if (select count(*) from public.inventory_movements where inventory_item_id=item and movement_type='manual_entry')<>2 then raise exception 'Histórico de entradas incorreto'; end if;
  if (select sum(quantity) from public.inventory_movements where inventory_item_id=item)<>31 then raise exception 'Quantidades do histórico não conferem'; end if;
  begin
    perform public.restock_inventory(item,0,gen_random_uuid());
    raise exception 'Quantidade zero foi aceita';
  exception when others then if sqlerrm not like 'Informe uma quantidade positiva%' then raise; end if; end;
  begin
    perform public.restock_inventory(item,0.00001,gen_random_uuid());
    raise exception 'Precisão inválida foi aceita';
  exception when others then if sqlerrm not like 'Informe uma quantidade positiva%' then raise; end if; end;
  if (select current_stock from public.inventory_items where id=item)<>401 then raise exception 'Entrada inválida alterou o saldo'; end if;
end;
$$;
rollback;
