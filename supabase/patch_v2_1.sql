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
