-- Adds a per-item cost/purchase price to the menu, so the Stock Report in
-- Reports → Cafe Report can show real profit instead of just revenue at menu
-- price. Safe to run on your existing live database — only adds one new
-- column, doesn't touch any existing data.

alter table menu_items add column if not exists cost_price numeric;
