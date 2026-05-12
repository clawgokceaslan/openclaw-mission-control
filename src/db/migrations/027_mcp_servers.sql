CREATE TABLE IF NOT EXISTS mcp_servers(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  transport TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive',
  risk_tier TEXT NOT NULL DEFAULT 'medium',
  enabled INTEGER NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 0,
  command TEXT,
  args_json TEXT,
  cwd TEXT,
  env_json TEXT,
  env_vars_json TEXT,
  url TEXT,
  auth_type TEXT NOT NULL DEFAULT 'none',
  bearer_token_env_var TEXT,
  http_headers_json TEXT,
  env_http_headers_json TEXT,
  enabled_tools_json TEXT,
  disabled_tools_json TEXT,
  startup_timeout_sec INTEGER,
  tool_timeout_sec INTEGER,
  last_discovered_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS mcp_oauth_tokens(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  encrypted_token_json TEXT NOT NULL,
  scopes_json TEXT,
  audience TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_servers (id) ON DELETE CASCADE,
  UNIQUE (user_id, server_id)
);

CREATE TABLE IF NOT EXISTS mcp_capabilities(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  capability_type TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  description TEXT,
  input_schema_json TEXT,
  metadata_json TEXT,
  discovered_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_servers (id) ON DELETE CASCADE,
  UNIQUE (server_id, capability_type, name)
);

CREATE TABLE IF NOT EXISTS agent_mcp_servers(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  enabled_tools_json TEXT,
  disabled_tools_json TEXT,
  approval_policy TEXT NOT NULL DEFAULT 'ask',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_servers (id) ON DELETE CASCADE,
  UNIQUE(agent_id, server_id)
);

CREATE TABLE IF NOT EXISTS skill_mcp_servers(
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'recommended',
  enabled_tools_json TEXT,
  disabled_tools_json TEXT,
  approval_policy TEXT NOT NULL DEFAULT 'ask',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_servers (id) ON DELETE CASCADE,
  UNIQUE(skill_id, server_id)
);

CREATE TABLE IF NOT EXISTS project_mcp_servers(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  enabled_tools_json TEXT,
  disabled_tools_json TEXT,
  approval_policy TEXT NOT NULL DEFAULT 'ask',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_servers (id) ON DELETE CASCADE,
  UNIQUE(project_id, server_id)
);

CREATE TABLE IF NOT EXISTS mcp_audit_log(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  server_id TEXT,
  user_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES mcp_servers (id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_org_status ON mcp_servers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_mcp_capabilities_server ON mcp_capabilities(server_id, capability_type);
CREATE INDEX IF NOT EXISTS idx_agent_mcp_servers_agent ON agent_mcp_servers(agent_id);
CREATE INDEX IF NOT EXISTS idx_skill_mcp_servers_skill ON skill_mcp_servers(skill_id);
CREATE INDEX IF NOT EXISTS idx_project_mcp_servers_project ON project_mcp_servers(project_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_org_created ON mcp_audit_log(organization_id, created_at DESC);
