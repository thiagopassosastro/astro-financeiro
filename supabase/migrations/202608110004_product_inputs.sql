-- Composição de custo dos equipamentos por insumo.
create table public.product_inputs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  name text not null,
  unit text not null default 'un',
  quantity numeric(15,4) not null check(quantity > 0),
  unit_cost numeric(15,4) not null check(unit_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  deleted_at timestamptz
);

create index idx_product_inputs_product on public.product_inputs(product_id) where deleted_at is null;
create trigger set_updated_at before update on public.product_inputs for each row execute function public.set_updated_at();

alter table public.product_inputs enable row level security;
create policy "authenticated_access" on public.product_inputs
for all to authenticated using (true) with check (true);

comment on table public.product_inputs is 'Lista de materiais e serviços que compõem o custo atual de cada equipamento.';
comment on column public.product_inputs.unit_cost is 'Custo unitário atual do insumo; não altera vendas históricas.';
