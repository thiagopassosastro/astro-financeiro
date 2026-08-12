-- Cria o perfil do usuário automaticamente. O primeiro usuário é administrador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  assigned_role text;
begin
  select case when exists(select 1 from public.profiles) then 'user' else 'admin' end into assigned_role;
  insert into public.profiles(id, full_name, role)
  values(new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)), assigned_role)
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Salva venda, itens e parcelas na mesma transação.
create or replace function public.create_complete_sale(p_sale jsonb, p_items jsonb, p_receivables jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  new_sale public.sales;
  item jsonb;
  installment jsonb;
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

-- Salva despesa e parcelas na mesma transação.
create or replace function public.create_complete_expense(p_expense jsonb, p_payables jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_expense_id uuid;
  installment jsonb;
begin
  insert into public.expenses(expense_date, supplier_id, category_id, description, total_amount, payment_method, notes, created_by)
  values(
    (p_expense->>'expense_date')::date, nullif(p_expense->>'supplier_id','')::uuid,
    nullif(p_expense->>'category_id','')::uuid, p_expense->>'description', (p_expense->>'total_amount')::numeric,
    nullif(p_expense->>'payment_method','')::public.payment_method, nullif(p_expense->>'notes',''), auth.uid()
  ) returning id into new_expense_id;
  for installment in select * from jsonb_array_elements(p_payables) loop
    insert into public.payables(
      expense_id, supplier_id, category_id, installment_number, installment_count, amount, due_date,
      paid_at, payment_method, status, created_by
    ) values (
      new_expense_id, nullif(p_expense->>'supplier_id','')::uuid, nullif(p_expense->>'category_id','')::uuid,
      (installment->>'number')::int, (installment->>'total')::int, (installment->>'amount')::numeric,
      (installment->>'due_date')::date, nullif(installment->>'paid_at','')::timestamptz,
      (installment->>'payment_method')::public.payment_method, (installment->>'status')::public.financial_status, auth.uid()
    );
  end loop;
  return new_expense_id;
end;
$$;

grant execute on function public.create_complete_sale(jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.create_complete_expense(jsonb,jsonb) to authenticated;
