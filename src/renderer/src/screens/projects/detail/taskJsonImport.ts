export const TASK_JSON_IMPORT_EXAMPLE = `{
  "title": "Implement billing settings",
  "description": "Main task description markdown",
  "tags": ["frontend", "billing"],
  "customFields": [
    { "name": "Priority", "type": "text", "value": "High" },
    { "name": "Estimate", "type": "number", "value": 5 }
  ],
  "checklist": [
    { "title": "Review current settings page", "checked": false }
  ],
  "comments": [
    { "authorName": "Operator", "body": "Imported context note" }
  ],
  "subtasks": [
    {
      "title": "Audit current UI",
      "description": "Subtask description markdown",
      "tags": ["frontend"],
      "customFields": [
        { "name": "Risk", "type": "text", "value": "Medium" }
      ],
      "checklist": [
        { "title": "List affected components", "checked": false }
      ],
      "comments": [
        { "authorName": "Operator", "body": "Subtask note" }
      ],
      "dueAt": 1767225600000
    }
  ]
}`

export const TASK_JSON_IMPORT_INSTRUCT = `# Task JSON Import Instructions

This file explains the JSON structure accepted by Open Mission Control task and task template import.

## Root Object

The JSON root must be a single object. The root object creates or overwrites one task/template and may include a full subtask list.

Required field:
- \`title\`: string. The task or template title.

Optional fields:
- \`description\`: string. Markdown text used as the main task/template description.
- \`tags\`: string array. Shared labels for the main task/template. Existing tags are reused by name or id; missing tags are created.
- \`customFields\`: array. Custom field values for the main task/template. Existing fields are reused by name; missing fields are created.
- \`checklist\`: array. Checklist rows for the main task/template.
- \`comments\`: array. Imported notes/comments for the main task/template.
- \`subtasks\`: array. Full child task list.

Unsupported root fields:
- \`status\`
- \`inputFormatId\`
- \`outputFormatId\`
- \`attachments\`
- \`agent\`
- \`skills\`

Unsupported fields are ignored and reported as warnings. Attachments/files are never imported.

## Status Behavior

Do not include status in JSON. Imported tasks and subtasks use the first status in the target project.

For task templates, status stays unset/default so the target project decides the status when a task is created from the template.

## Description

\`description\` accepts Markdown. It can contain plain text, lists, headings, tables, and code blocks.

File links and attachment references inside Markdown are not uploaded or imported as files.

## Tags

\`tags\` must be an array of strings.

Example:
\`\`\`json
"tags": ["frontend", "billing"]
\`\`\`

Import behavior:
- If a tag exists by id or name, it is reused.
- If a tag does not exist, it is created.
- Duplicate tags are deduplicated.

## Custom Fields

\`customFields\` must be an array of objects.

Each item supports:
- \`name\`: string, required. The custom field name.
- \`type\`: string, optional. One of \`text\`, \`number\`, \`boolean\`, \`json\`. Defaults to \`text\` when omitted.
- \`value\`: any. The value stored for that field.

Example:
\`\`\`json
"customFields": [
  { "name": "Priority", "type": "text", "value": "High" },
  { "name": "Estimate", "type": "number", "value": 5 },
  { "name": "Needs Review", "type": "boolean", "value": true },
  { "name": "Metadata", "type": "json", "value": { "source": "import" } }
]
\`\`\`

Import behavior:
- Fields are resolved by name.
- Missing fields are created with the provided type.
- If a field already exists, its existing type is used.
- Number fields must receive a numeric value or a string that can be converted to a number.
- Boolean fields accept true/false or strings like "true".
- JSON fields accept objects, arrays, primitives, or a valid JSON string.

## Checklist

\`checklist\` must be an array of objects.

Each item supports:
- \`title\`: string, required.
- \`checked\`: boolean, optional. Defaults to false.
- \`id\`, \`createdAt\`, \`updatedAt\`: optional. Generated when omitted.

Example:
\`\`\`json
"checklist": [
  { "title": "Review current settings page", "checked": false },
  { "title": "Confirm edge cases", "checked": true }
]
\`\`\`

Items with an empty title are skipped.

## Comments

\`comments\` must be an array of objects.

Each item supports:
- \`body\`: string, required.
- \`authorName\`: string, optional. Defaults to \`Operator\`.
- \`id\`, \`createdAt\`, \`updatedAt\`: optional. Generated when omitted.

Example:
\`\`\`json
"comments": [
  { "authorName": "Operator", "body": "Imported context note" }
]
\`\`\`

Comments with an empty body are skipped.

## Subtasks

\`subtasks\` must be an array of objects. The imported list replaces the existing subtask list during overwrite import.

Each subtask supports:
- \`title\`: string, required.
- \`description\`: string, optional. Markdown body for the subtask.
- \`tags\`: string array, optional. Existing tags are reused; missing tags are created.
- \`customFields\`: array, optional. Same structure as root customFields.
- \`checklist\`: array, optional. Same structure as root checklist.
- \`comments\`: array, optional. Same structure as root comments.
- \`dueAt\`: number, optional. Unix timestamp in milliseconds.

Unsupported subtask fields:
- \`status\`
- \`inputFormatId\`
- \`outputFormatId\`
- \`attachments\`
- \`agent\`
- \`skills\`

Example:
\`\`\`json
"subtasks": [
  {
    "title": "Audit current UI",
    "description": "Subtask description markdown",
    "tags": ["frontend"],
    "customFields": [
      { "name": "Risk", "type": "text", "value": "Medium" }
    ],
    "checklist": [
      { "title": "List affected components", "checked": false }
    ],
    "comments": [
      { "authorName": "Operator", "body": "Subtask note" }
    ],
    "dueAt": 1767225600000
  }
]
\`\`\`

## Overwrite Rules

When importing into an existing task:
- Title is overwritten.
- Description is overwritten.
- Tags are overwritten from JSON.
- Custom fields are overwritten from JSON.
- Checklist is overwritten from JSON.
- Comments are overwritten from JSON.
- Existing subtasks are replaced by JSON subtasks.
- Existing task agent and skills are preserved.
- Existing attachments/files are preserved.

When importing into an existing task template:
- Template name uses \`title\`.
- Template description uses \`description\`.
- Template content is overwritten from JSON.
- Existing template agent and skills are preserved.
- Attachments/files are not imported.

## Minimal Valid JSON

\`\`\`json
{
  "title": "Task title"
}
\`\`\`

## Full Example

\`\`\`json
${TASK_JSON_IMPORT_EXAMPLE}
\`\`\`
`

export type TaskJsonImportPreview = {
  title: string
  description: string
}

export function parseTaskJsonImportPreview(value: string): TaskJsonImportPreview {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON root must be an object.')
  const root = parsed as Record<string, unknown>
  const title = typeof root.title === 'string' ? root.title.trim() : ''
  if (!title) throw new Error('title is required.')
  return {
    title,
    description: typeof root.description === 'string' ? root.description : ''
  }
}
