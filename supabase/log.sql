-- 브랜드 로그 1단계 (log.html)가 쓰는 Supabase 구조. 모든 기록은 관리자만 읽고 쓸 수 있다. 적용한 SQL 그대로 기록.

-- 하루 한 줄: 기록한 날. 작업이 없어도 줄이 있으면 "쉰 날"로 본다.
create table public.log_days (
  date date primary key,
  checked_in_at timestamptz not null default now()
);

-- 그날 쓴 평문 원문 (하루 여러 개)
create table public.log_entries (
  id uuid primary key default gen_random_uuid(),
  date date not null references public.log_days on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- 작업. span_key가 같은 작업은 한 작품을 만든 기간으로 묶인다 (item_id는 맨 아래에서 추가).
create table public.log_work (
  id uuid primary key default gen_random_uuid(),
  date date not null references public.log_days on delete cascade,
  title text not null,
  minutes int check (minutes is null or minutes between 0 and 1440),
  span_key text,
  created_at timestamptz not null default now()
);

-- 판매. 상품이 지워져도 기록은 남는다 (item_id만 비워짐, title 유지).
create table public.log_sales (
  id uuid primary key default gen_random_uuid(),
  date date not null references public.log_days on delete cascade,
  item_id uuid references public.catalog_items(id) on delete set null,
  title text not null default '',
  channel text,
  amount bigint check (amount is null or amount >= 0),
  qty int not null default 1 check (qty >= 1),
  gift boolean not null default false,
  created_at timestamptz not null default now()
);

-- 설정: 판매처 목록, 레벨 설정(가중치·기준값·단계 문구)
create table public.log_options (
  key text primary key,
  value jsonb not null
);
insert into public.log_options (key, value) values
  ('channels', '["DM","스마트스토어","후르츠패밀리"]'::jsonb),
  ('settings', '{}'::jsonb);

-- 상품이 추가·숨김·복구·삭제된 기록 (포트폴리오 개수와 달력 스티커의 근거). 상품이 지워져도 남도록 외래키 없음.
create table public.catalog_events (
  id bigint generated always as identity primary key,
  item_id uuid not null,
  event text not null check (event in ('added','hidden','shown','deleted')),
  at timestamptz not null default now()
);
create index catalog_events_at on public.catalog_events (at);

alter table public.log_days enable row level security;
alter table public.log_entries enable row level security;
alter table public.log_work enable row level security;
alter table public.log_sales enable row level security;
alter table public.log_options enable row level security;
alter table public.catalog_events enable row level security;

create policy "log_days admin" on public.log_days for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "log_entries admin" on public.log_entries for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "log_work admin" on public.log_work for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "log_sales admin" on public.log_sales for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "log_options admin" on public.log_options for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- catalog_events는 아래 트리거만 쓴다. 관리자는 읽기만.
create policy "catalog_events admin read" on public.catalog_events for select to authenticated using ((select public.is_admin()));

-- 상품(kind = 'product')의 변화를 catalog_events에 남긴다.
-- 숨긴 상품을 지울 때는 이미 개수에서 빠졌으므로 'deleted'를 남기지 않는다 (두 번 빼지 않게).
create function public.catalog_items_log_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'product' then
      insert into public.catalog_events (item_id, event, at) values (new.id, 'added', now());
      if new.hidden then
        insert into public.catalog_events (item_id, event, at) values (new.id, 'hidden', now());
      end if;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.kind = 'product' and old.hidden is distinct from new.hidden then
      insert into public.catalog_events (item_id, event, at)
      values (new.id, case when new.hidden then 'hidden' else 'shown' end, now());
    end if;
    return new;
  else
    if old.kind = 'product' and not old.hidden then
      insert into public.catalog_events (item_id, event, at) values (old.id, 'deleted', now());
    end if;
    return old;
  end if;
end;
$$;
revoke execute on function public.catalog_items_log_events() from public, anon, authenticated;

create trigger catalog_items_log_events
after insert or update of hidden or delete on public.catalog_items
for each row execute function public.catalog_items_log_events();

-- 지금 있는 상품을 시작점으로 한 번 채운다.
insert into public.catalog_events (item_id, event, at)
select id, 'added', created_at from public.catalog_items where kind = 'product';
insert into public.catalog_events (item_id, event, at)
select id, 'hidden', greatest(updated_at, created_at) from public.catalog_items where kind = 'product' and hidden;

-- 하루 기록을 한 번에 저장한다 (전부 성공하거나 전부 실패). RLS는 호출자 권한 그대로 적용된다.
-- payload = {date, text, work:[{title, minutes, span_key}], sales:[{item_id, title, channel, amount, qty, gift, mark_sold}]}
create function public.log_save_day(payload jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  d date := (payload->>'date')::date;
begin
  if d is null then
    raise exception 'date is required';
  end if;

  insert into public.log_days (date) values (d) on conflict (date) do nothing;

  if coalesce(btrim(payload->>'text'), '') <> '' then
    insert into public.log_entries (date, text) values (d, payload->>'text');
  end if;

  insert into public.log_work (date, title, minutes, span_key)
  select d, w->>'title', (w->>'minutes')::int, nullif(w->>'span_key', '')
    from jsonb_array_elements(coalesce(payload->'work', '[]'::jsonb)) w
   where coalesce(btrim(w->>'title'), '') <> '';

  insert into public.log_sales (date, item_id, title, channel, amount, qty, gift)
  select d, (s->>'item_id')::uuid, coalesce(s->>'title', ''), nullif(s->>'channel', ''),
         (s->>'amount')::bigint, coalesce((s->>'qty')::int, 1), coalesce((s->>'gift')::boolean, false)
    from jsonb_array_elements(coalesce(payload->'sales', '[]'::jsonb)) s;

  update public.catalog_items c
     set sold = true, updated_at = now()
    from jsonb_array_elements(coalesce(payload->'sales', '[]'::jsonb)) s
   where coalesce((s->>'mark_sold')::boolean, false)
     and s->>'item_id' is not null
     and c.id = (s->>'item_id')::uuid;
end;
$$;
revoke execute on function public.log_save_day(jsonb) from public, anon;
grant execute on function public.log_save_day(jsonb) to authenticated;

/* ───────── 좌판의 낱개도 만든 개수로 센다 (2026-11-25) ───────── */

-- ① 새 코드 배포 전에: 낱개 이벤트가 어느 대표 상품의 것인지 (지워진 뒤에도 알 수 있게 여기에 남긴다)
alter table public.catalog_events add column parent_id uuid;

-- ② 새 코드 배포 (옛 코드는 낱개 이벤트를 종류로 세므로 ③보다 먼저)

-- ③ 트리거가 낱개(piece)도 남기게 바꾸고, 이미 있는 낱개를 올린 때로 채운다.
create or replace function public.catalog_items_log_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.kind in ('product', 'piece') then
      insert into public.catalog_events (item_id, event, at, parent_id) values (new.id, 'added', now(), new.parent_id);
      if new.hidden then
        insert into public.catalog_events (item_id, event, at, parent_id) values (new.id, 'hidden', now(), new.parent_id);
      end if;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.kind in ('product', 'piece') and old.hidden is distinct from new.hidden then
      insert into public.catalog_events (item_id, event, at, parent_id)
      values (new.id, case when new.hidden then 'hidden' else 'shown' end, now(), new.parent_id);
    end if;
    return new;
  else
    if old.kind in ('product', 'piece') and not old.hidden then
      insert into public.catalog_events (item_id, event, at, parent_id) values (old.id, 'deleted', now(), old.parent_id);
    end if;
    return old;
  end if;
end;
$$;

insert into public.catalog_events (item_id, event, at, parent_id)
select c.id, 'added', c.created_at, c.parent_id
  from public.catalog_items c
 where c.kind = 'piece'
   and not exists (select 1 from public.catalog_events e where e.item_id = c.id)
 order by c.created_at, c.no;

/* ───────── 만든 기간: 작업을 작품에 연결 (2026-11-25) ───────── */

-- 새 코드 배포 전에. 상품이 지워지면 비워지고 작업 기록은 남는다.
alter table public.log_work add column item_id uuid references public.catalog_items(id) on delete set null;
create index log_work_item on public.log_work (item_id);
-- log_save_day의 work에 item_id를 받는다: payload.work = [{title, minutes, span_key, item_id}]
create or replace function public.log_save_day(payload jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  d date := (payload->>'date')::date;
begin
  if d is null then
    raise exception 'date is required';
  end if;

  insert into public.log_days (date) values (d) on conflict (date) do nothing;

  if coalesce(btrim(payload->>'text'), '') <> '' then
    insert into public.log_entries (date, text) values (d, payload->>'text');
  end if;

  insert into public.log_work (date, title, minutes, span_key, item_id)
  select d, w->>'title', (w->>'minutes')::int, nullif(w->>'span_key', ''), (w->>'item_id')::uuid
    from jsonb_array_elements(coalesce(payload->'work', '[]'::jsonb)) w
   where coalesce(btrim(w->>'title'), '') <> '';

  insert into public.log_sales (date, item_id, title, channel, amount, qty, gift)
  select d, (s->>'item_id')::uuid, coalesce(s->>'title', ''), nullif(s->>'channel', ''),
         (s->>'amount')::bigint, coalesce((s->>'qty')::int, 1), coalesce((s->>'gift')::boolean, false)
    from jsonb_array_elements(coalesce(payload->'sales', '[]'::jsonb)) s;

  update public.catalog_items c
     set sold = true, updated_at = now()
    from jsonb_array_elements(coalesce(payload->'sales', '[]'::jsonb)) s
   where coalesce((s->>'mark_sold')::boolean, false)
     and s->>'item_id' is not null
     and c.id = (s->>'item_id')::uuid;
end;
$$;
