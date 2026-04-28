ALTER TABLE tags ADD COLUMN description TEXT;
ALTER TABLE tags ADD COLUMN updated_at INTEGER;

UPDATE tags
SET updated_at = created_at
WHERE updated_at IS NULL;
