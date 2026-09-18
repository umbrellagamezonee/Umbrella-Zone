-- Run this once in Supabase SQL Editor — makes credit balance and stock
-- quantity updates atomic ("+= delta" on the server) instead of "set to X",
-- so rapid back-to-back updates to the same customer/item (e.g. billing
-- three pending orders onto credit within the same second) can never lose
-- an update to the network delivering requests out of order. Safe to run
-- even if these already exist.

create or replace function increment_credit_balance(p_id text, p_delta numeric)
returns numeric
language sql
as $$
  update customers set credit_balance = credit_balance + p_delta where id = p_id
  returning credit_balance;
$$;

-- Floored at 0 — two devices selling the last unit(s) at nearly the same
-- moment could otherwise each independently see enough stock locally and
-- both deduct, leaving the real count permanently negative on the server.
create or replace function increment_stock_qty(p_id text, p_delta numeric)
returns numeric
language sql
as $$
  update menu_items set stock_qty = greatest(0, stock_qty + p_delta) where id = p_id
  returning stock_qty;
$$;
