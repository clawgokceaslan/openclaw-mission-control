CREATE TABLE IF NOT EXISTS status_templates(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS status_template_items(
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (template_id) REFERENCES status_templates (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_statuses(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_status_templates_org ON status_templates(organization_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_status_template_items_template_sort ON status_template_items(template_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_statuses_project_sort ON project_statuses(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_statuses_org ON project_statuses(organization_id, project_id);

INSERT INTO status_templates (id, organization_id, name, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))), o.id, 'Default workflow', strftime('%s','now') * 1000, strftime('%s','now') * 1000
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM status_templates st WHERE st.organization_id = o.id AND st.name = 'Default workflow');

INSERT INTO status_template_items (id, template_id, name, category, color, sort_order, is_default, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))), st.id, item.name, item.category, item.color, item.sort_order, item.is_default, strftime('%s','now') * 1000, strftime('%s','now') * 1000
FROM status_templates st
JOIN (
  SELECT 'Not started' AS name, 'not_started' AS category, '#8A99B4' AS color, 0 AS sort_order, 1 AS is_default
  UNION ALL SELECT 'Active', 'active', '#2F80ED', 1, 0
  UNION ALL SELECT 'Review', 'active', '#8B5CF6', 2, 0
  UNION ALL SELECT 'Done', 'done', '#29B764', 3, 0
  UNION ALL SELECT 'Closed', 'closed', '#D94B5F', 4, 0
) item
WHERE st.name = 'Default workflow'
  AND NOT EXISTS (SELECT 1 FROM status_template_items sti WHERE sti.template_id = st.id);

INSERT INTO project_statuses (id, organization_id, project_id, name, category, color, sort_order, is_default, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))), p.organization_id, p.id, item.name, item.category, item.color, item.sort_order, item.is_default, strftime('%s','now') * 1000, strftime('%s','now') * 1000
FROM projects p
JOIN (
  SELECT 'Not started' AS name, 'not_started' AS category, '#8A99B4' AS color, 0 AS sort_order, 1 AS is_default
  UNION ALL SELECT 'Active', 'active', '#2F80ED', 1, 0
  UNION ALL SELECT 'Review', 'active', '#8B5CF6', 2, 0
  UNION ALL SELECT 'Done', 'done', '#29B764', 3, 0
  UNION ALL SELECT 'Closed', 'closed', '#D94B5F', 4, 0
) item
WHERE NOT EXISTS (SELECT 1 FROM project_statuses ps WHERE ps.project_id = p.id);

UPDATE tasks
SET status = COALESCE((
  SELECT ps.id FROM project_statuses ps
  WHERE ps.project_id = tasks.project_id
    AND ps.name = CASE tasks.status
      WHEN 'pending' THEN 'Not started'
      WHEN 'running' THEN 'Active'
      WHEN 'failed' THEN 'Review'
      WHEN 'completed' THEN 'Done'
      ELSE tasks.status
    END
  LIMIT 1
), status)
WHERE status IN ('pending', 'running', 'failed', 'completed');

UPDATE task_subtasks
SET status = COALESCE((
  SELECT ps.id FROM project_statuses ps
  JOIN tasks t ON t.id = task_subtasks.task_id
  WHERE ps.project_id = t.project_id
    AND ps.name = CASE task_subtasks.status
      WHEN 'pending' THEN 'Not started'
      WHEN 'completed' THEN 'Done'
      ELSE task_subtasks.status
    END
  LIMIT 1
), status)
WHERE status IN ('pending', 'completed');
