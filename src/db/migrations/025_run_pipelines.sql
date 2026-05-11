CREATE TABLE IF NOT EXISTS plan_pipeline_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  project_ids_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  run_pipeline_on_plan_complete INTEGER NOT NULL DEFAULT 0,
  linked_run_pipeline_id TEXT,
  created_by_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

ALTER TABLE plan_pipeline_records ADD COLUMN batch_id TEXT;

INSERT INTO plan_pipeline_batches (
  id, organization_id, name, project_ids_json, status, run_pipeline_on_plan_complete,
  linked_run_pipeline_id, created_by_name, created_at, updated_at
)
SELECT
  'plan-batch-' || lower(hex(randomblob(16))),
  organization_id,
  source_draft_name,
  COALESCE(MAX(project_ids_json), '[]'),
  CASE
    WHEN SUM(CASE WHEN status IN ('failed', 'blocked') THEN 1 ELSE 0 END) > 0 THEN 'blocked'
    WHEN SUM(CASE WHEN status IN ('running') THEN 1 ELSE 0 END) > 0 THEN 'running'
    WHEN SUM(CASE WHEN status IN ('paused') THEN 1 ELSE 0 END) > 0 THEN 'paused'
    WHEN SUM(CASE WHEN status NOT IN ('completed', 'skipped') THEN 1 ELSE 0 END) = 0 THEN 'completed'
    ELSE 'pending'
  END,
  0,
  NULL,
  MAX(created_by_name),
  MIN(created_at),
  MAX(updated_at)
FROM plan_pipeline_records
WHERE batch_id IS NULL
GROUP BY organization_id, source_draft_name, created_at;

UPDATE plan_pipeline_records
SET batch_id = (
  SELECT batch.id
  FROM plan_pipeline_batches batch
  WHERE batch.organization_id = plan_pipeline_records.organization_id
    AND batch.name = plan_pipeline_records.source_draft_name
    AND batch.created_at = plan_pipeline_records.created_at
  LIMIT 1
)
WHERE batch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_plan_pipeline_batches_org_updated
  ON plan_pipeline_batches (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_pipeline_records_batch
  ON plan_pipeline_records (batch_id, group_order);

CREATE TABLE IF NOT EXISTS run_pipeline_batches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_plan_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  current_stage_id TEXT,
  current_item_id TEXT,
  failure_policy TEXT NOT NULL DEFAULT 'stop_on_failure',
  project_ids_json TEXT NOT NULL,
  created_by_name TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_pipeline_stages (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  stage_order INTEGER NOT NULL,
  source_plan_record_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES run_pipeline_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_pipeline_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  item_order INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  task_gateway_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES run_pipeline_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES run_pipeline_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_pipeline_batches_org_updated
  ON run_pipeline_batches (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_pipeline_stages_batch_order
  ON run_pipeline_stages (batch_id, stage_order);

CREATE INDEX IF NOT EXISTS idx_run_pipeline_items_batch_status_order
  ON run_pipeline_items (batch_id, status, item_order);

CREATE INDEX IF NOT EXISTS idx_run_pipeline_items_gateway_run
  ON run_pipeline_items (task_gateway_run_id);

CREATE TABLE IF NOT EXISTS pipeline_status_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'all',
  scope_id TEXT,
  label TEXT NOT NULL,
  revoked_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_status_tokens_org_created
  ON pipeline_status_tokens (organization_id, created_at DESC);
