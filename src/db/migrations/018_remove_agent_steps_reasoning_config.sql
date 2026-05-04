UPDATE agents
SET config_json = json_remove(config_json, '$.steps', '$.reasoningLevel')
WHERE config_json IS NOT NULL
  AND json_valid(config_json)
  AND (
    json_type(config_json, '$.steps') IS NOT NULL
    OR json_type(config_json, '$.reasoningLevel') IS NOT NULL
  )
