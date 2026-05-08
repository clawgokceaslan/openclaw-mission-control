CREATE TABLE IF NOT EXISTS task_groups(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  ordered_task_ids_json TEXT NOT NULL DEFAULT '[]',
  active_task_id TEXT,
  group_context_md_path TEXT NOT NULL DEFAULT '',
  contracted_context TEXT NOT NULL DEFAULT '',
  planning_queue_state_json TEXT NOT NULL DEFAULT '{"state":"not_configured"}',
  execution_queue_state_json TEXT NOT NULL DEFAULT '{"state":"not_configured"}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (active_task_id) REFERENCES tasks (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_task_groups_project_updated ON task_groups(project_id, updated_at);
