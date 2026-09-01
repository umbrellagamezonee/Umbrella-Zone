-- CueBill cloud sync schema
-- Run this once in Supabase SQL Editor (a fresh project's editor is empty).
-- Single-tenant (one cafe per project) — RLS just allows the anon key
-- through, since the app already gates access with its own password screen.
--
-- IDs are `text`, not `uuid` — the app has a few fixed non-UUID ids (e.g.
-- the "walk-in" customer, menu category slugs like "cat-drinks") mixed in
-- alongside real crypto.randomUUID() ids, so the column has to accept both.
--
-- Safe to re-run: drops and recreates everything, so running this again
-- (e.g. after an earlier version of this script) won't error on
-- already-exists — it'll just reset to empty and the app will reseed the
-- cloud from whichever device opens first afterward.

drop table if exists menu_items cascade;
drop table if exists menu_categories cascade;
drop table if exists billing_tables cascade;
drop table if exists games cascade;
drop table if exists customers cascade;
drop table if exists canteen_orders cascade;
drop table if exists bills cascade;
drop table if exists expenses cascade;
drop table if exists store_settings cascade;

create table billing_tables (
  id text primary key,
  name text not null,
  kind text not null,
  rate_per_hour numeric not null default 0,
  default_session_minutes int not null default 60,
  status text not null default 'available',
  customer_id text,
  extra_customer_ids text[] not null default '{}',
  active_game_id text,
  session_rate_per_hour numeric,
  session_started_at timestamptz,
  accumulated_ms bigint not null default 0,
  planned_duration_ms bigint,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create table games (
  id text primary key,
  name text not null,
  kind text not null,
  rate_per_hour numeric not null default 0
);

create table customers (
  id text primary key,
  name text not null,
  phone text not null default '',
  email text not null default '',
  is_walk_in boolean not null default false,
  credit_balance numeric not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now()
);

create table menu_categories (
  id text primary key,
  name text not null,
  sort_order int not null default 0
);

create table menu_items (
  id text primary key,
  name text not null,
  category_id text not null references menu_categories(id) on delete cascade,
  price numeric not null default 0,
  in_stock boolean not null default true,
  stock_qty int,
  low_stock_threshold int not null default 5
);

create table canteen_orders (
  id text primary key,
  table_id text,
  customer_id text,
  guest_name text,
  items jsonb not null default '[]',
  note text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table bills (
  id text primary key,
  table_id text,
  table_name text,
  order_id text,
  game_id text,
  game_name text,
  customer_id text,
  table_charge_minutes numeric not null default 0,
  table_charge numeric not null default 0,
  canteen_charge numeric not null default 0,
  canteen_items jsonb not null default '[]',
  discount numeric not null default 0,
  total numeric not null default 0,
  amount_paid numeric not null default 0,
  amount_due numeric not null default 0,
  payment_method text,
  shares jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  deleted_at timestamptz,
  match_participants text[],
  match_loser text,
  match_losers text[]
);

create table expenses (
  id text primary key,
  category text not null,
  amount numeric not null default 0,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table store_settings (
  id int primary key default 1,
  store_name text not null default 'My Game Zone',
  currency_symbol text not null default '₹',
  timezone text not null default 'Asia/Kolkata',
  upi_id text not null default '',
  app_password text not null default '0000',
  theme_color text not null default '#8b5cf6',
  theme_mode text not null default 'dark',
  constraint single_row check (id = 1)
);
insert into store_settings (id) values (1);

-- Row Level Security: open to the anon key (app-level password already
-- gates who reaches this far — see LockScreen.tsx).
alter table billing_tables enable row level security;
alter table games enable row level security;
alter table customers enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table canteen_orders enable row level security;
alter table bills enable row level security;
alter table expenses enable row level security;
alter table store_settings enable row level security;

create policy "anon full access" on billing_tables for all using (true) with check (true);
create policy "anon full access" on games for all using (true) with check (true);
create policy "anon full access" on customers for all using (true) with check (true);
create policy "anon full access" on menu_categories for all using (true) with check (true);
create policy "anon full access" on menu_items for all using (true) with check (true);
create policy "anon full access" on canteen_orders for all using (true) with check (true);
create policy "anon full access" on bills for all using (true) with check (true);
create policy "anon full access" on expenses for all using (true) with check (true);
create policy "anon full access" on store_settings for all using (true) with check (true);

-- Realtime: push live changes to every connected device.
alter publication supabase_realtime add table billing_tables;
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table customers;
alter publication supabase_realtime add table menu_categories;
alter publication supabase_realtime add table menu_items;
alter publication supabase_realtime add table canteen_orders;
alter publication supabase_realtime add table bills;
alter publication supabase_realtime add table expenses;
alter publication supabase_realtime add table store_settings;
