-- Ciclo de vida de usuários internos.
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists deactivated_at timestamptz;

create or replace function public.is_current_user_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active = true);
$$;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin' and active = true);
$$;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_active() then raise exception 'Usuário inativo'; end if;
  update public.profiles set must_change_password = false where id = auth.uid();
end;
$$;

grant execute on function public.is_current_user_active() to authenticated;
grant execute on function public.is_current_user_admin() to authenticated;
grant execute on function public.complete_password_change() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  assigned_role text;
begin
  select case when exists(select 1 from public.profiles) then 'stock_operator' else 'admin' end into assigned_role;
  insert into public.profiles(id, full_name, role, active, must_change_password)
  values(
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    assigned_role,
    true,
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  ) on conflict(id) do nothing;
  return new;
end;
$$;

-- Reforça as políticas: usuários inativos não acessam dados do sistema.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'product_categories','products','product_cost_history','product_inputs','inventory_items','inventory_movements'
  ] loop
    execute format('drop policy if exists "stock_area_access" on public.%I', table_name);
    execute format('create policy "stock_area_access" on public.%I for all to authenticated using (public.is_current_user_active()) with check (public.is_current_user_active())', table_name);
  end loop;

  foreach table_name in array array[
    'customers','suppliers','sellers','sales','sale_items','sale_payments','receivables','expense_categories',
    'expenses','payables','bank_accounts','cash_movements','settings','audit_log'
  ] loop
    execute format('drop policy if exists "admin_only_access" on public.%I', table_name);
    execute format('create policy "admin_only_access" on public.%I for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin())', table_name);
  end loop;
end $$;

drop policy if exists "profile_admin_all" on public.profiles;
create policy "profile_admin_all" on public.profiles for all to authenticated
using (public.is_current_user_admin()) with check (public.is_current_user_admin());

comment on column public.profiles.active is 'Permite bloquear o acesso sem apagar o histórico do usuário.';
comment on column public.profiles.must_change_password is 'Exige troca da senha temporária no próximo acesso.';
