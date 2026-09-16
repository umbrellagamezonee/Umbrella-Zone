-- Run this once in your Supabase SQL Editor to sync the admin PIN (gates
-- Menu Management / Deleted Bills / Backup & Restore) across devices.
-- Defaults to '0000' — change it from Settings once this is run.
alter table store_settings add column if not exists admin_pin text not null default '0000';
