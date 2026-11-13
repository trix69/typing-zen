-- Typing Zen ranking board: one row per user who shares, per site ("live" or "test").
-- days: JSON {"YYYY-MM-DD": words}; key_hash: sha256 of the row's key; updated: ms since 1970 of the last write.
CREATE TABLE IF NOT EXISTS rows (
  site TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  days TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (site, id)
);
CREATE INDEX IF NOT EXISTS rows_by_site_updated ON rows (site, updated);
