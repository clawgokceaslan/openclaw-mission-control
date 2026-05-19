export const TASK_JSON_IMPORT_EXAMPLE = `{
  "title": "Implement billing settings",
  "description": "Main task description markdown",
  "status": "In Progress",
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
      "status": "Review",
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

export const BULK_TASK_JSON_IMPORT_EXAMPLE = `[
  {
    "title": "Implement billing settings",
    "description": "Main task description markdown",
    "status": "In Progress",
    "tags": ["frontend", "billing"],
    "customFields": [
      { "name": "Priority", "type": "text", "value": "High" }
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
        "status": "Review",
        "tags": ["frontend"],
        "checklist": [
          { "title": "List affected components", "checked": false }
        ]
      }
    ]
  },
  {
    "title": "Publish invoice export",
    "description": "Add CSV export for invoice rows",
    "tags": ["backend"]
  }
]`

export const BULK_TASK_JSON_IMPORT_INSTRUCT = `# Bulk Task JSON Import Instructions

Use this file when an AI agent needs to generate JSON for Open Mission Control bulk task import.

## Output Contract

Return only valid JSON. Do not wrap the JSON in Markdown fences, prose, comments, or trailing commas.

The root value must be a non-empty JSON array. Each array item creates one top-level task and follows the same task object contract as single task import.

Minimal valid output:

\`\`\`json
[
  { "title": "Task title" }
]
\`\`\`

## Task Object Schema

Required root field:
- \`title\`: string. Human-readable task title.

Optional root fields:
- \`description\`: string. Markdown task body. Put acceptance criteria, implementation notes, constraints, and useful context here.
- \`status\`: string. Project status name or id. If omitted, the import uses the first status in the target project.
- \`tags\`: string array. Existing tags are reused by id/name; missing tags are created.
- \`customFields\`: array of custom field objects.
- \`checklist\`: array of checklist item objects.
- \`comments\`: array of imported comment objects.
- \`subtasks\`: array of subtask objects.

Do not include these root fields because they are ignored and reported as warnings:
- \`inputFormatId\`
- \`outputFormatId\`
- \`attachments\`
- \`agent\`
- \`skills\`

Attachments and files are never imported. If a file matters, reference it in \`description\` or \`comments\` as plain text.

## Subtask Object Schema

Required subtask field:
- \`title\`: string.

Optional subtask fields:
- \`description\`: string. Markdown body for the subtask.
- \`status\`: string. Project status name or id. If omitted, the subtask inherits its parent task status.
- \`tags\`: string array.
- \`customFields\`: array. Same structure as root \`customFields\`.
- \`checklist\`: array. Same structure as root \`checklist\`.
- \`comments\`: array. Same structure as root \`comments\`.
- \`dueAt\`: number. Unix timestamp in milliseconds.

Do not include unsupported subtask fields: \`inputFormatId\`, \`outputFormatId\`, \`attachments\`, \`agent\`, or \`skills\`.

## Nested Object Shapes

\`customFields\` item:
- \`name\`: string, required.
- \`type\`: string, optional. One of \`text\`, \`number\`, \`boolean\`, \`json\`. Defaults to \`text\`.
- \`value\`: any. Must match the intended field type. JSON fields may be objects, arrays, primitives, or valid JSON strings.

\`checklist\` item:
- \`title\`: string, required. Empty titles are skipped.
- \`checked\`: boolean, optional. Defaults to false.

\`comments\` item:
- \`body\`: string, required. Empty bodies are skipped.
- \`authorName\`: string, optional. Defaults to \`Operator\`.

## AI Generation Rules

- Keep each array item independent; do not rely on ordering unless the task text explicitly requires it.
- Prefer concise task titles and put detail in \`description\`, \`checklist\`, and \`subtasks\`.
- Use \`subtasks\` for real child work, not for generic steps like "test" or "review" unless the user explicitly asks for them.
- Use \`checklist\` for completion criteria that belong inside one task or subtask.
- Preserve exact user-provided names for statuses, tags, and custom fields when available.
- Do not invent agents, skills, attachments, input formats, or output formats.
- If project-level guidance is needed, include it in a separate \`## Project Instructions\` section outside the JSON. It will not be imported into project settings through this flow.

## Validation And Import Behavior

- The root must be an array and must contain at least one task.
- Every task and subtask must have a non-empty \`title\`.
- \`tags\`, \`customFields\`, \`checklist\`, \`comments\`, and \`subtasks\` must be arrays when present.
- Status values must match a project status name or id.
- Number custom fields must be numeric or numeric strings.
- Invalid array imports are atomic: if any item is invalid, no task is created.
- Validation errors include the failing array index, for example \`tasks[1].subtasks[0].status\`.
- During import, the modal shows progress and the number of created tasks.

## Project Instructions Note

Project instructions are not written through this import. Include project instructions in exported \`INSTRUCT.md\` files under a separate \`## Project Instructions\` section when sharing context with agents.

Example project instructions section:

\`\`\`md
## Project Instructions

### General Prompt
Commit and push completed task changes before review.

### Project Rules
Use component-scoped module.scss files. Keep TSX parent-child structure mirrored by nested SCSS selectors.
\`\`\`

Full array example:

\`\`\`json
${BULK_TASK_JSON_IMPORT_EXAMPLE}
\`\`\`
`

export const TASK_JSON_IMPORT_INSTRUCT = `# Task JSON Import Instructions

Use this file when an AI agent needs to generate JSON for Open Mission Control single task or task template import.

## Output Contract

Return only valid JSON. Do not wrap the JSON in Markdown fences, prose, comments, or trailing commas.

## Root Object

The JSON root must be a single object. The root object creates or overwrites one task/template and may include a full subtask list.

Required field:
- \`title\`: string. The task or template title.

Optional fields:
- \`description\`: string. Markdown text used as the main task/template description.
- \`status\`: string. Project status name or id. Falls back to the first project status when omitted.
- \`tags\`: string array. Shared labels for the main task/template. Existing tags are reused by name or id; missing tags are created.
- \`customFields\`: array. Custom field values for the main task/template. Existing fields are reused by name; missing fields are created.
- \`checklist\`: array. Checklist rows for the main task/template.
- \`comments\`: array. Imported notes/comments for the main task/template.
- \`subtasks\`: array. Full child task list.

Unsupported root fields:
- \`inputFormatId\`
- \`outputFormatId\`
- \`attachments\`
- \`agent\`
- \`skills\`

Unsupported fields are ignored and reported as warnings. Attachments/files are never imported.

## Status Behavior

Imported tasks and subtasks may include \`status\` as a project status name or id. When omitted, imported tasks use the first status in the target project and subtasks inherit the parent task status.

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
- When importing into an existing task, omitted, null, or empty root \`tags\` preserve existing task tags. A non-empty root \`tags\` array replaces them.

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
- \`status\`: string, optional. Project status name or id. Defaults to the parent task status.
- \`tags\`: string array, optional. Existing tags are reused; missing tags are created.
- \`customFields\`: array, optional. Same structure as root customFields.
- \`checklist\`: array, optional. Same structure as root checklist.
- \`comments\`: array, optional. Same structure as root comments.
- \`dueAt\`: number, optional. Unix timestamp in milliseconds.

Unsupported subtask fields:
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
- Tags are preserved when root \`tags\` is omitted, null, or empty; otherwise tags are replaced from JSON.
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

export function parseBulkTaskJsonImportPreview(value: string): TaskJsonImportPreview[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('JSON root must be an array.')
  if (parsed.length === 0) throw new Error('JSON array must include at least one task.')
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`tasks[${index}]: item must be an object.`)
    const root = item as Record<string, unknown>
    const title = typeof root.title === 'string' ? root.title.trim() : ''
    if (!title) throw new Error(`tasks[${index}]: title is required.`)
    return {
      title,
      description: typeof root.description === 'string' ? root.description : ''
    }
  })
}
