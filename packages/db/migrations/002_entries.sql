CREATE TABLE entries (
  id                  TEXT PRIMARY KEY,
  collection_handle   TEXT NOT NULL REFERENCES collections(handle) ON DELETE CASCADE,
  parent_id           TEXT REFERENCES entries(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'published',
  content             TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_entries_scope  ON entries(collection_handle, parent_id, sort_order);
CREATE INDEX idx_entries_status ON entries(collection_handle, status);
