-- Run this once in your Supabase SQL Editor to let a bill's payment be
-- split between cash and account (UPI/bank transfer) instead of always
-- being all-one-method. Existing rows default to 0 — until a bill is next
-- touched, the app fills the split in from its old single-method locally,
-- so nothing already recorded is lost.
alter table bills add column if not exists amount_cash numeric not null default 0;
alter table bills add column if not exists amount_upi numeric not null default 0;
