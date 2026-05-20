CREATE TABLE global_sets (
  handle         TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  definition     TEXT NOT NULL,
  blueprint_hash TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE global_values (
  handle      TEXT PRIMARY KEY REFERENCES global_sets(handle) ON DELETE CASCADE,
  content     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
