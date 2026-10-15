-- Um código identifica um único material e um único saldo de estoque em todo o sistema.
-- Materiais repetidos com o mesmo código são consolidados no cadastro mais antigo.

update public.inventory_items
set code = upper(btrim(code))
where nullif(btrim(code), '') is not null;

update public.product_inputs
set code = upper(btrim(code))
where nullif(btrim(code), '') is not null;

create temporary table inventory_code_merge on commit drop as
with ranked as (
  select
    id,
    first_value(id) over (
      partition by upper(btrim(code))
      order by created_at asc, id asc
    ) as canonical_id
  from public.inventory_items
  where deleted_at is null and nullif(btrim(code), '') is not null
)
select id as duplicate_id, canonical_id
from ranked
where id <> canonical_id;

-- Se o equipamento já aponta para o material canônico, preserva somente uma linha da composição.
update public.product_inputs duplicate_input
set deleted_at = now()
from inventory_code_merge merge
where duplicate_input.inventory_item_id = merge.duplicate_id
  and duplicate_input.deleted_at is null
  and exists (
    select 1
    from public.product_inputs canonical_input
    where canonical_input.product_id = duplicate_input.product_id
      and canonical_input.inventory_item_id = merge.canonical_id
      and canonical_input.deleted_at is null
  );

-- Os demais equipamentos passam a compartilhar o mesmo item e o mesmo saldo global.
update public.product_inputs input
set inventory_item_id = merge.canonical_id
from inventory_code_merge merge
where input.inventory_item_id = merge.duplicate_id
  and input.deleted_at is null;

-- Saldos repetidos normalmente representam a mesma contagem informada em mais de uma ficha.
-- Usa o maior saldo existente, em vez de somá-los, para não inflar o estoque durante a consolidação.
with grouped as (
  select
    upper(btrim(code)) as code_key,
    (array_agg(id order by created_at asc, id asc))[1] as canonical_id,
    max(current_stock) as consolidated_stock,
    max(minimum_stock) as consolidated_minimum
  from public.inventory_items
  where deleted_at is null and nullif(btrim(code), '') is not null
  group by upper(btrim(code))
), changed as (
  select item.id, item.current_stock as old_stock, grouped.consolidated_stock, grouped.consolidated_minimum
  from grouped
  join public.inventory_items item on item.id = grouped.canonical_id
  where item.current_stock <> grouped.consolidated_stock
)
insert into public.inventory_movements(
  inventory_item_id, movement_type, quantity, balance_after, notes, created_by
)
select
  id,
  case when consolidated_stock > old_stock then 'manual_entry' else 'manual_adjustment' end,
  consolidated_stock - old_stock,
  consolidated_stock,
  'Consolidação de materiais duplicados pelo código',
  auth.uid()
from changed;

with grouped as (
  select
    upper(btrim(code)) as code_key,
    (array_agg(id order by created_at asc, id asc))[1] as canonical_id,
    max(current_stock) as consolidated_stock,
    max(minimum_stock) as consolidated_minimum
  from public.inventory_items
  where deleted_at is null and nullif(btrim(code), '') is not null
  group by upper(btrim(code))
)
update public.inventory_items item
set current_stock = grouped.consolidated_stock,
    minimum_stock = grouped.consolidated_minimum
from grouped
where item.id = grouped.canonical_id;

update public.inventory_items duplicate_item
set deleted_at = now()
from inventory_code_merge merge
where duplicate_item.id = merge.duplicate_id;

-- Mantém os dados descritivos das fichas iguais aos do cadastro global escolhido.
update public.product_inputs input
set code = item.code,
    name = item.name,
    unit = item.unit,
    unit_cost = item.unit_cost
from public.inventory_items item
where input.inventory_item_id = item.id
  and input.deleted_at is null;

create unique index if not exists inventory_items_unique_active_code
on public.inventory_items(upper(btrim(code)))
where deleted_at is null and nullif(btrim(code), '') is not null;

comment on index public.inventory_items_unique_active_code
is 'Garante que cada código represente um único material e saldo global de estoque.';
