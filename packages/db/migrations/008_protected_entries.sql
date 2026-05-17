ALTER TABLE entries ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_entries_protected ON entries(collection_handle, protected);
