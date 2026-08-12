-- Perfis de acesso: Administrador e Operador de Estoque.
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles
set role = case when role in ('admin', 'manager') then 'admin' else 'stock_operator' end;
alter table public.profiles alter column role set default 'stock_operator';
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'stock_operator'));

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
grant execute on function public.is_current_user_admin() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  assigned_role text;
begin
  select case when exists(select 1 from public.profiles) then 'stock_operator' else 'admin' end into assigned_role;
  insert into public.profiles(id, full_name, role)
  values(new.id, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)), assigned_role)
  on conflict(id) do nothing;
  return new;
end;
$$;

-- Remove a política ampla anterior.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','customers','suppliers','sellers','product_categories','products','product_cost_history',
    'sales','sale_items','sale_payments','receivables','expense_categories','expenses','payables',
    'bank_accounts','cash_movements','settings','audit_log','product_inputs','inventory_items','inventory_movements'
  ] loop
    execute format('drop policy if exists "authenticated_access" on public.%I', table_name);
    execute format('drop policy if exists "profile_self_read" on public.%I', table_name);
    execute format('drop policy if exists "profile_admin_all" on public.%I', table_name);
    execute format('drop policy if exists "stock_area_access" on public.%I', table_name);
    execute format('drop policy if exists "admin_only_access" on public.%I', table_name);
  end loop;
end $$;

-- Cada usuário pode ler o próprio perfil; administradores gerenciam todos.
create policy "profile_self_read" on public.profiles for select to authenticated
using (id = auth.uid());
create policy "profile_admin_all" on public.profiles for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

-- Área operacional liberada para os dois perfis.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'product_categories','products','product_cost_history','product_inputs','inventory_items','inventory_movements'
  ] loop
    execute format('create policy "stock_area_access" on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end $$;

-- Dados comerciais, financeiros e configurações são exclusivos dos administradores.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'customers','suppliers','sellers','sales','sale_items','sale_payments','receivables','expense_categories',
    'expenses','payables','bank_accounts','cash_movements','settings','audit_log'
  ] loop
    execute format('create policy "admin_only_access" on public.%I for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin())', table_name);
  end loop;
end $$;

comment on column public.profiles.role is 'admin = Administrador (dono/gerente); stock_operator = Operador de Estoque (funcionário).';
