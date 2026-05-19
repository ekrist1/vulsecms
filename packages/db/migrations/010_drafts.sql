ALTER TABLE entries           ADD COLUMN draft_content TEXT;
ALTER TABLE entries           ADD COLUMN published_at  TEXT;
ALTER TABLE entries           ADD COLUMN published_by  TEXT;
ALTER TABLE group_permissions ADD COLUMN can_publish   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE revisions         ADD COLUMN kind          TEXT NOT NULL DEFAULT 'draft';

UPDATE entries
SET published_at = updated_at
WHERE status = 'published' AND published_at IS NULL;
