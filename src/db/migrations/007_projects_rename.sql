ALTER TABLE boards RENAME TO projects;
ALTER TABLE tasks RENAME COLUMN board_id TO project_id;
ALTER TABLE board_groups RENAME TO project_groups;
ALTER TABLE board_group_memberships RENAME TO project_group_memberships;
ALTER TABLE project_group_memberships RENAME COLUMN board_id TO project_id;
ALTER TABLE project_group_memberships RENAME COLUMN board_group_id TO project_group_id;
ALTER TABLE onboarding_states RENAME COLUMN board_id TO project_id;
ALTER TABLE approvals RENAME COLUMN board_id TO project_id;

DROP INDEX IF EXISTS idx_boards_org;
DROP INDEX IF EXISTS idx_tasks_board;
DROP INDEX IF EXISTS idx_tasks_board_status_updated;
DROP INDEX IF EXISTS idx_board_groups_org;

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_updated ON tasks(project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_groups_org ON project_groups(organization_id);
