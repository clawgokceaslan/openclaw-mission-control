INSERT OR IGNORE INTO organizations (id, name, created_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'Default Organization', CAST(strftime('%s','now') AS INTEGER) * 1000);

INSERT OR IGNORE INTO users (id, organization_id, email, name, password_hash, role, created_at)
VALUES ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000001', 'owner@mission.local', '', 'pbkdf2:sha256:260000$local$changeme', 'owner', CAST(strftime('%s','now') AS INTEGER) * 1000);

INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role)
VALUES ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner');
