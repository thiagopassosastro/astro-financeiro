-- Astro Financeiro · schema inicial
create extension if not exists "pgcrypto";
create type public.financial_status as enum ('pending','paid','overdue','cancelled');
create type public.commission_type as enum ('percentage','fixed');
create type public.payment_method as enum ('pix','cash','transfer','boleto','card','check','other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null, role text not null default 'user' check (role in ('admin','manager','user')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.customers (
  id uuid primary key default gen_random_uuid(), name text not null, company_name text, document text,
  phone text, whatsapp text, email text, city text, state char(2), address text, notes text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), deleted_at timestamptz
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(), name text not null, company_name text, document text, phone text, email text, category text, notes text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), deleted_at timestamptz
);
create table public.sellers (
  id uuid primary key default gen_random_uuid(), name text not null, phone text, email text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), deleted_at timestamptz
);
create table public.product_categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
create table public.products (
  id uuid primary key default gen_random_uuid(), name text not null, sku text not null unique, category_id uuid references public.product_categories(id), description text,
  origin text not null check(origin in ('manufactured','imported')), current_cost numeric(15,2) not null check(current_cost >= 0), suggested_price numeric(15,2) check(suggested_price >= 0),
  active boolean not null default true, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), deleted_at timestamptz
);
create table public.product_cost_history (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id), cost numeric(15,2) not null check(cost >= 0),
  effective_at timestamptz not null default now(), created_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
create table public.sales (
  id uuid primary key default gen_random_uuid(), sale_number bigint generated always as identity unique, customer_id uuid not null references public.customers(id), seller_id uuid references public.sellers(id), sale_date date not null,
  gross_amount numeric(15,2) not null check(gross_amount >= 0), discount_amount numeric(15,2) not null default 0 check(discount_amount >= 0), net_amount numeric(15,2) not null check(net_amount >= 0), products_cost numeric(15,2) not null check(products_cost >= 0),
  commission_type public.commission_type not null, commission_percentage numeric(7,4), commission_amount numeric(15,2) not null default 0,
  shipping_cost numeric(15,2) not null default 0, fees numeric(15,2) not null default 0, other_costs numeric(15,2) not null default 0,
  gross_profit numeric(15,2) not null, profit numeric(15,2) not null, profit_margin numeric(9,4) not null, status text not null default 'confirmed' check(status in ('draft','confirmed','cancelled')),
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), deleted_at timestamptz,
  check(net_amount = gross_amount - discount_amount)
);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id), product_id uuid references public.products(id),
  product_name_snapshot text not null, product_sku_snapshot text not null, quantity numeric(12,3) not null check(quantity > 0),
  unit_sale_price numeric(15,2) not null check(unit_sale_price >= 0), unit_cost_at_sale numeric(15,2) not null check(unit_cost_at_sale >= 0), discount numeric(15,2) not null default 0,
  total_sale numeric(15,2) not null, total_cost numeric(15,2) not null, profit numeric(15,2) not null, profit_margin numeric(9,4) not null,
  created_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
comment on column public.sale_items.unit_cost_at_sale is 'Snapshot imutável do custo na data da venda. Nunca recalcular com products.current_cost.';
create table public.sale_payments (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id), method public.payment_method not null, amount numeric(15,2) not null check(amount > 0), notes text,
  created_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
create table public.receivables (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references public.sales(id), customer_id uuid not null references public.customers(id), installment_number int not null, installment_count int not null,
  amount numeric(15,2) not null check(amount > 0), due_date date not null, received_at timestamptz, payment_method public.payment_method, status public.financial_status not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), unique(sale_id,installment_number)
);
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(), name text not null, parent_id uuid references public.expense_categories(id), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), unique(name,parent_id)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(), expense_date date not null, supplier_id uuid references public.suppliers(id), category_id uuid references public.expense_categories(id), description text not null,
  total_amount numeric(15,2) not null check(total_amount > 0), payment_method public.payment_method, notes text, status text not null default 'active' check(status in ('active','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), deleted_at timestamptz
);
create table public.payables (
  id uuid primary key default gen_random_uuid(), expense_id uuid not null references public.expenses(id), supplier_id uuid references public.suppliers(id), category_id uuid references public.expense_categories(id), installment_number int not null, installment_count int not null,
  amount numeric(15,2) not null check(amount > 0), due_date date not null, paid_at timestamptz, payment_method public.payment_method, status public.financial_status not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id), unique(expense_id,installment_number)
);
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(), name text not null, bank_name text, opening_balance numeric(15,2) not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(), bank_account_id uuid references public.bank_accounts(id), movement_date timestamptz not null, direction text not null check(direction in ('in','out')),
  amount numeric(15,2) not null check(amount > 0), description text not null, receivable_id uuid unique references public.receivables(id), payable_id uuid unique references public.payables(id),
  created_at timestamptz not null default now(), created_by uuid references public.profiles(id), check(num_nonnulls(receivable_id,payable_id) <= 1)
);
create table public.settings (
  key text primary key, value jsonb not null, description text, updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.audit_log (
  id bigint generated always as identity primary key, table_name text not null, record_id uuid not null, action text not null, old_data jsonb, new_data jsonb,
  created_at timestamptz not null default now(), created_by uuid references public.profiles(id)
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create or replace function public.track_product_cost() returns trigger language plpgsql security definer set search_path=public as $$
begin if tg_op='INSERT' or new.current_cost is distinct from old.current_cost then insert into product_cost_history(product_id,cost,created_by) values(new.id,new.current_cost,auth.uid()); end if; return new; end $$;
create trigger products_cost_history after insert or update of current_cost on public.products for each row execute function public.track_product_cost();
create or replace function public.sync_cash_movement() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_table_name='receivables' and new.status='paid' and old.status is distinct from 'paid' then insert into cash_movements(movement_date,direction,amount,description,receivable_id,created_by) values(coalesce(new.received_at,now()),'in',new.amount,'Recebimento de venda',new.id,auth.uid()); end if;
  if tg_table_name='payables' and new.status='paid' and old.status is distinct from 'paid' then insert into cash_movements(movement_date,direction,amount,description,payable_id,created_by) values(coalesce(new.paid_at,now()),'out',new.amount,'Pagamento de despesa',new.id,auth.uid()); end if;
  return new;
end $$;
create trigger receivable_cash after update of status on public.receivables for each row execute function public.sync_cash_movement();
create trigger payable_cash after update of status on public.payables for each row execute function public.sync_cash_movement();
do $$ declare t text; begin foreach t in array array['profiles','customers','suppliers','sellers','product_categories','products','receivables','expense_categories','expenses','payables','bank_accounts'] loop execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t); end loop; end $$;

create index idx_sales_date on public.sales(sale_date); create index idx_sales_customer on public.sales(customer_id); create index idx_sale_items_product on public.sale_items(product_id);
create index idx_receivables_due_status on public.receivables(due_date,status); create index idx_payables_due_status on public.payables(due_date,status); create index idx_cash_movement_date on public.cash_movements(movement_date);

alter table public.profiles enable row level security; alter table public.customers enable row level security; alter table public.suppliers enable row level security;
alter table public.sellers enable row level security; alter table public.product_categories enable row level security; alter table public.products enable row level security;
alter table public.product_cost_history enable row level security; alter table public.sales enable row level security; alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security; alter table public.receivables enable row level security; alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security; alter table public.payables enable row level security; alter table public.bank_accounts enable row level security;
alter table public.cash_movements enable row level security; alter table public.settings enable row level security; alter table public.audit_log enable row level security;
do $$ declare t text; begin foreach t in array array['profiles','customers','suppliers','sellers','product_categories','products','product_cost_history','sales','sale_items','sale_payments','receivables','expense_categories','expenses','payables','bank_accounts','cash_movements','settings','audit_log'] loop execute format('create policy "authenticated_access" on public.%I for all to authenticated using (true) with check (true)',t); end loop; end $$;

insert into public.settings(key,value,description) values ('default_commission_percentage','10','Comissão padrão sobre o valor líquido'),('timezone','"America/Sao_Paulo"','Timezone da aplicação'),('currency','"BRL"','Moeda padrão');
insert into public.product_categories(name) values ('Cardio'),('Musculação'),('Acessórios');
insert into public.expense_categories(name) values ('Produção'),('Importação'),('Funcionários'),('Logística'),('Marketing'),('Estrutura'),('Financeiro'),('Impostos'),('Manutenção'),('Outros');

