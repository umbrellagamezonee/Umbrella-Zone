-- Run this once in Supabase SQL Editor to sync table display order (Home +
-- Table Management ↑/↓) across every device instead of each device keeping
-- its own separate order.
--
-- After running this, re-arrange the tables ONE more time (Settings → Table
-- Management, on whichever device already has them in the right order) —
-- that push is what seeds the real order into the cloud for every other
-- device to pick up. Until then every table defaults to 0, which just falls
-- back to alphabetical (same as a brand-new device already does today).
alter table billing_tables add column if not exists sort_order int not null default 0;
