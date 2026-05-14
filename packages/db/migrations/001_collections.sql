CREATE TABLE collections (
  handle              TEXT PRIMARY KEY,
  blueprint_hash      TEXT NOT NULL,
  blueprint_snapshot  TEXT,
  singleton           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
