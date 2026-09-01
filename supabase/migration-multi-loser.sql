-- Upgrades "Loser pays" to support multiple losers (equal split) instead of
-- just one person. Safe to run on your existing live database — only adds a
-- new column, doesn't touch or remove match_loser (kept around for old
-- records, just unused going forward).

alter table bills add column if not exists match_losers text[];
