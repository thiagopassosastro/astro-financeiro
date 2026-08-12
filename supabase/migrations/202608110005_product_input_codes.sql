alter table public.product_inputs add column if not exists code text;
create index if not exists idx_product_inputs_code on public.product_inputs(code) where deleted_at is null;
comment on column public.product_inputs.code is 'Código interno ou SKU do insumo utilizado na composição.';
