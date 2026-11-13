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
-- Launch counts (Trix, 2026-11-13): one row per device (random install id), UTC day, app type, version and kind of
-- user on the device; n = launches that day. Kept 400 days.
CREATE TABLE IF NOT EXISTS hits (
  site TEXT NOT NULL,
  day TEXT NOT NULL,
  install TEXT NOT NULL,
  client TEXT NOT NULL,
  version TEXT NOT NULL,
  who TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (site, day, install, client, version, who)
);
CREATE INDEX IF NOT EXISTS hits_by_day ON hits (site, day);
