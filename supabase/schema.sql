-- 이 사이트가 쓰는 Supabase 구조 (productarchive 프로젝트에 이미 적용됨. 기록용)
-- public.is_admin() 과 public.admins 테이블은 프로젝트에 원래 있던 것을 그대로 사용합니다.

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null default '',
  code text not null default '',
  price bigint,
  sold boolean not null default false,
  size text not null default '',
  material text not null default '',
  description text not null default '',
  buy_url text not null default '',
  image_url text not null default '',
  thumb_url text not null default '',
  detail_urls jsonb not null default '[]'::jsonb,
  kind text not null default 'product' check (kind in ('product','text')),  -- 상품 또는 텍스트 블록
  label text not null default '',                                            -- 텍스트 블록 내용
  scale real not null default 1 check (scale > 0 and scale <= 4),            -- 칸 안에서 사진/글자 크기
  x int not null default 0,
  y int not null default 0,
  w int not null default 1,
  h int not null default 1,
  constraint catalog_items_grid check (x >= 0 and y >= 0 and w >= 1 and h >= 1 and x + w <= 10)
);

alter table public.catalog_items enable row level security;

create policy "catalog public read" on public.catalog_items for select to anon, authenticated using (true);
create policy "catalog admin insert" on public.catalog_items for insert to authenticated with check ((select public.is_admin()));
create policy "catalog admin update" on public.catalog_items for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "catalog admin delete" on public.catalog_items for delete to authenticated using ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog', 'catalog', true, 10485760, array['image/png','image/jpeg','image/webp','image/avif','image/gif'])
on conflict (id) do nothing;

create policy "catalog bucket admin select" on storage.objects for select to authenticated using (bucket_id = 'catalog' and (select public.is_admin()));
create policy "catalog bucket admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'catalog' and (select public.is_admin()));
create policy "catalog bucket admin update" on storage.objects for update to authenticated using (bucket_id = 'catalog' and (select public.is_admin())) with check (bucket_id = 'catalog' and (select public.is_admin()));
create policy "catalog bucket admin delete" on storage.objects for delete to authenticated using (bucket_id = 'catalog' and (select public.is_admin()));
