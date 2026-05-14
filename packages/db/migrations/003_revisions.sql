CREATE TABLE revisions (
  id                  TEXT PRIMARY KEY,
  entry_id            TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  revision_number     INTEGER NOT NULL,
  content             TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  created_by          TEXT
);
CREATE INDEX idx_revisions_entry ON revisions(entry_id, revision_number DESC);
