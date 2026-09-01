-- Adds "who played / who lost" tracking to the bills table.
-- Safe to run on your existing live database — only adds two new columns,
-- doesn't touch any existing data (unlike schema.sql, this does NOT drop
-- anything).

alter table bills add column if not exists match_participants text[];
alter table bills add column if not exists match_loser text;
