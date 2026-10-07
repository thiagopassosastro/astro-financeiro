-- Mantém apenas o primeiro registro de cada insumo dentro de cada equipamento.
-- As cópias são desativadas para preservar rastreabilidade e permitir recuperação.
with ranked as (
  select pi.id,
         row_number() over (
           partition by pi.product_id, lower(trim(coalesce(ii.name, pi.name)))
           order by pi.created_at asc, pi.id asc
         ) as position
  from public.product_inputs pi
  left join public.inventory_items ii on ii.id = pi.inventory_item_id
  where pi.deleted_at is null
)
update public.product_inputs pi
set deleted_at = now()
from ranked r
where pi.id = r.id and r.position > 1;

-- Impede que o mesmo nome seja incluído novamente na composição do equipamento.
create unique index if not exists product_inputs_unique_active_name_per_product
on public.product_inputs(product_id, lower(trim(name)))
where deleted_at is null;
