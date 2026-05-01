CREATE TABLE IF NOT EXISTS openclaw_resource_mappings(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  openclaw_id TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  content_hash TEXT,
  last_synced_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(gateway_id, resource_type, local_id),
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (gateway_id) REFERENCES gateways (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_openclaw_resource_mappings_org ON openclaw_resource_mappings(organization_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_resource_mappings_gateway_type ON openclaw_resource_mappings(gateway_id, resource_type);
