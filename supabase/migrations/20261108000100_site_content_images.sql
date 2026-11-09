-- 012: image overrides must point at the public gallery bucket of this project (uploaded from the admin)
alter table public.site_content add constraint site_content_img_url
  check (key !~ '\.img\.' or value ~ '^https://enlkrucktzppkyxrljpr\.supabase\.co/storage/v1/object/public/gallery/site/[A-Za-z0-9._-]+$');
