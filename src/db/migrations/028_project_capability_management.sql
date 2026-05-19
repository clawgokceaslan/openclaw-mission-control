UPDATE projects
SET metrics_json = json_set(
  CASE
    WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json
    ELSE '{}'
  END,
  '$.management.version',
  1,
  '$.management.defaultAgentId',
  json_extract(CASE WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json ELSE '{}' END, '$.defaultAgentId'),
  '$.management.defaultSkillIds',
  COALESCE(json_extract(CASE WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json ELSE '{}' END, '$.defaultSkillIds'), json('[]')),
  '$.management.agentIds',
  CASE
    WHEN json_extract(CASE WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json ELSE '{}' END, '$.defaultAgentId') IS NOT NULL
    THEN json_array(json_extract(CASE WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json ELSE '{}' END, '$.defaultAgentId'))
    ELSE COALESCE(json_extract(CASE WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json ELSE '{}' END, '$.agentIds'), json('[]'))
  END,
  '$.management.toolIds',
  COALESCE(
    json_extract(CASE WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json ELSE '{}' END, '$.toolIds'),
    json_extract(CASE WHEN metrics_json IS NOT NULL AND json_valid(metrics_json) THEN metrics_json ELSE '{}' END, '$.defaultToolIds'),
    json('[]')
  )
)
WHERE metrics_json IS NULL OR json_valid(metrics_json);
