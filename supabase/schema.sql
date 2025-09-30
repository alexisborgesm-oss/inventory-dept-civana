-- Supabase SQL schema for Inventory system

create table if not exists departments(
  id bigserial primary key,
  name text unique not null
);

create table if not exists users(
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password text not null,
  role text not null check (role in ('super_admin','admin','standard')),
  department_id bigint references departments(id)
);

-- Seed super admin
insert into users (username, password, role, department_id)
values ('super_admin', 'Qaz123*', 'super_admin', null)
on conflict (username) do nothing;

create table if not exists categories(
  id bigserial primary key,
  name text unique not null
);

-- "Valioso" category
insert into categories (name) values ('Valioso') on conflict do nothing;

create table if not exists items(
  id bigserial primary key,
  name text not null,
  category_id bigint not null references categories(id) on delete restrict,
  unit text,
  vendor text,
  article_number text
);

create table if not exists areas(
  id bigserial primary key,
  department_id bigint not null references departments(id) on delete cascade,
  name text not null
);

-- Link areas to items (an area can have many items)
create table if not exists area_items(
  area_id bigint references areas(id) on delete cascade,
  item_id bigint references items(id) on delete cascade,
  primary key (area_id, item_id)
);

create table if not exists thresholds(
  id bigserial primary key,
  area_id bigint not null references areas(id) on delete cascade,
  item_id bigint not null references items(id) on delete cascade,
  expected_qty numeric not null default 0,
  unique (area_id, item_id)
);

create table if not exists records(
  id bigserial primary key,
  area_id bigint not null references areas(id) on delete cascade,
  user_id uuid not null references users(id) on delete set null,
  inventory_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists record_items(
  record_id bigint not null references records(id) on delete cascade,
  item_id bigint not null references items(id) on delete cascade,
  qty numeric not null default 0,
  primary key (record_id, item_id)
);

create table if not exists monthly_inventories(
  id bigserial primary key,
  department_id bigint not null references departments(id) on delete cascade,
  month int not null check (month between 1 and 12),
  year int not null,
  created_at timestamptz not null default now(),
  unique (department_id, month, year)
);

create table if not exists monthly_inventory_items(
  monthly_inventory_id bigint not null references monthly_inventories(id) on delete cascade,
  area text not null,
  category text not null,
  item text not null,
  qty numeric not null default 0
);

-- View: area_items with latest qty and threshold
create or replace view area_items_view as
with latest as (
  select ri.item_id, r.area_id,
         (array_agg(jsonb_build_object('inventory_date', r.inventory_date, 'qty', ri.qty) order by r.inventory_date desc))[1] ->> 'qty' as latest_qty
  from record_items ri
  join records r on r.id = ri.record_id
  group by ri.item_id, r.area_id
)
select a.id as area_id, i.id as item_id, i.name as item_name, i.category_id, i.unit, i.vendor,
       t.expected_qty,
       coalesce((latest.latest_qty)::numeric, 0) as latest_qty
from area_items ai
join areas a on a.id = ai.area_id
join items i on i.id = ai.item_id
left join thresholds t on t.area_id = ai.area_id and t.item_id = ai.item_id
left join latest on latest.item_id = ai.item_id and latest.area_id = ai.area_id;

-- Inventory matrix RPC: rows (area, category, item, unit, vendor, qty) filtered by department
create or replace function inventory_matrix(p_department_id bigint)
returns table(area text, category text, item text, unit text, vendor text, qty numeric)
language sql stable as $$
  select a.name as area, c.name as category, i.name as item, i.unit, i.vendor, v.latest_qty as qty
  from area_items_view v
  join areas a on a.id = v.area_id
  join items i on i.id = v.item_id
  join categories c on c.id = i.category_id
  where a.department_id = p_department_id
  order by category, item, area;
$$;

-- Records list for current user scope
create or replace function records_list(p_user_id uuid, p_role text, p_department_id bigint)
returns table(id bigint, area text, inventory_date date, created_at timestamptz, "user" text)
language sql stable as $$
  select r.id, a.name as area, r.inventory_date, r.created_at, u.username as "user"
  from records r
  join areas a on a.id = r.area_id
  join users u on u.id = r.user_id
  where (p_role = 'super_admin')
     or (p_role = 'admin' and a.department_id = p_department_id)
     or (p_role = 'standard' and r.user_id = p_user_id)
  order by r.created_at desc;
$$;

-- Record details
create or replace function record_details(p_record_id bigint)
returns table(category text, item text, qty numeric)
language sql stable as $$
  select c.name as category, i.name as item, ri.qty
  from record_items ri
  join items i on i.id = ri.item_id
  join categories c on c.id = i.category_id
  where ri.record_id = p_record_id
  order by c.name, i.name;
$$;

create or replace function delete_record(p_record_id bigint) returns void
language sql volatile as $$
  delete from records where id = p_record_id;
$$;

-- Threshold editor helper
create or replace function threshold_for_area(p_area_id bigint)
returns table(id bigint, area_id bigint, item_id bigint, item text, expected_qty numeric)
language sql stable as $$
  select t.id, a.id as area_id, i.id as item_id, i.name as item, coalesce(t.expected_qty,0) as expected_qty
  from area_items ai
  join areas a on a.id = ai.area_id
  join items i on i.id = ai.item_id
  left join thresholds t on t.area_id = ai.area_id and t.item_id = ai.item_id
  where ai.area_id = p_area_id
  order by i.name;
$$;

-- Monthly inventory get
create or replace function monthly_inventory_get(p_department_id bigint, p_month int, p_year int)
returns table(area text, category text, item text, qty numeric)
language sql stable as $$
  select mii.area, mii.category, mii.item, mii.qty
  from monthly_inventories mi
  join monthly_inventory_items mii on mii.monthly_inventory_id = mi.id
  where mi.department_id = p_department_id and mi.month = p_month and mi.year = p_year
  order by mii.category, mii.item, mii.area;
$$;


-- PATCH v2.1: Remove generated column in items, add trigger & view

-- Ensure extension
create extension if not exists pgcrypto;

-- Create items table if not exists (without generated column)
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name='items') then
    create table items (
      id bigserial primary key,
      name text not null,
      category_id bigint not null references categories(id) on delete restrict,
      unit text,
      vendor text,
      article_number text
    );
  end if;
end $$;

-- If old invalid generated column exists, guide migration (no-op here).
-- (User encountered error before creation, so usually not needed.)

-- Trigger to enforce article_number when category is 'Valioso'
create or replace function enforce_article_number_if_valioso()
returns trigger
language plpgsql
as $$
declare
  catname text;
begin
  select lower(name) into catname from categories where id = NEW.category_id;
  if catname = 'valioso' and (NEW.article_number is null or length(trim(NEW.article_number)) = 0) then
    raise exception 'article_number is required for items in Valioso category';
  end if;
  return NEW;
end
$$;

drop trigger if exists trg_items_valioso_check on items;
create trigger trg_items_valioso_check
before insert or update on items
for each row execute function enforce_article_number_if_valioso();

-- View that exposes is_valuable flag for UI
create or replace view items_with_flags as
select
  i.*,
  (lower(c.name) = 'valioso') as is_valuable
from items i
join categories c on c.id = i.category_id;
