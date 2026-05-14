CREATE TABLE navigation (
  handle              TEXT PRIMARY KEY,
  tree                TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
