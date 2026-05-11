CREATE TABLE IF NOT EXISTS ai_tools(
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tool_type TEXT NOT NULL DEFAULT 'local_command',
  description_markdown TEXT,
  code_language TEXT,
  code_body TEXT,
  function_name TEXT,
  command_template TEXT,
  prepare_command TEXT,
  working_directory_hint TEXT,
  input_schema_json TEXT,
  output_schema_json TEXT,
  execution_flow_markdown TEXT,
  approval_required INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS agent_tools(
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(agent_id, tool_id),
  FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE,
  FOREIGN KEY (tool_id) REFERENCES ai_tools (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_tools_org_status ON ai_tools(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_tools_agent_id ON agent_tools(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tools_tool_id ON agent_tools(tool_id);
