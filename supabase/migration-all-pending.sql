-- Run this once in Supabase SQL Editor — combines every pending migration
-- so far into one script. Safe to run even if some of these already exist
-- (each line only adds the column if it's missing).

-- Cost price tracking for menu items (profit reports)
alter table menu_items add column if not exists cost_price numeric;

-- Cash/account split on bill payments
alter table bills add column if not exists amount_cash numeric not null default 0;
alter table bills add column if not exists amount_upi numeric not null default 0;

-- Second admin PIN (Menu Management / Deleted Bills / Backup & Restore)
alter table store_settings add column if not exists admin_pin text not null default '0000';
