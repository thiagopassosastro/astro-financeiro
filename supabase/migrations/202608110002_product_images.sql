-- Referência da imagem armazenada no Supabase Storage.
alter table public.products add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "authenticated_read_product_images"
on storage.objects for select to authenticated
using (bucket_id = 'product-images');

create policy "authenticated_upload_product_images"
on storage.objects for insert to authenticated
with check (bucket_id = 'product-images');

create policy "authenticated_update_product_images"
on storage.objects for update to authenticated
using (bucket_id = 'product-images')
with check (bucket_id = 'product-images');
