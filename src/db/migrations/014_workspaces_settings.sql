CREATE TABLE IF NOT EXISTS workspaces(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(organization_id);

ALTER TABLE projects ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app_settings(
  organization_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, key),
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);
