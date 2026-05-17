CREATE TABLE sets (
  handle      TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  definition  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
