CREATE TABLE assets (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL,
  bucket        TEXT NOT NULL,
  url           TEXT NOT NULL,
  content_type  TEXT,
  size          INTEGER,
  original_name TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_assets_bucket_key ON assets(bucket, key);
CREATE INDEX idx_assets_created_at ON assets(created_at DESC);
