PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users_new(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT
);

INSERT INTO users_new (id, organization_id, email, name, password_hash, role, created_at)
SELECT id, organization_id, email, name, password_hash, role, created_at
FROM users;

DROP TABLE IF EXISTS users;
ALTER TABLE users_new RENAME TO users;
PRAGMA foreign_keys = ON;
