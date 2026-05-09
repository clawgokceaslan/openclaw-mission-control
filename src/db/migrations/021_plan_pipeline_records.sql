CREATE TABLE IF NOT EXISTS plan_pipeline_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  source_draft_name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  group_description TEXT,
  group_order INTEGER NOT NULL,
  project_ids_json TEXT NOT NULL,
  task_ids_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  run_mode TEXT NOT NULL DEFAULT 'questioned',
  summary_context TEXT,
  last_error TEXT,
  created_by_name TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_pipeline_records_org_updated
  ON plan_pipeline_records (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_pipeline_records_org_status
  ON plan_pipeline_records (organization_id, status, group_order);
