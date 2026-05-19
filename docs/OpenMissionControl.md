# OpenMissionControl Guide

This guide documents how the OpenMissionControl desktop application works at a system and feature level. It is written for humans and AI agents that need to understand the application before planning or executing tasks.

## Purpose

OpenMissionControl is an Electron desktop application for organizing software work into projects, tasks, agents, tools, skills, MCP servers, and AI-assisted planning or execution flows. It stores its own operational data in SQLite, renders the product with React, and launches Codex CLI based gateway sessions from project/task context.

The application is built around a small number of core ideas:

- **Projects** group tasks and define project-level instructions, workspace settings, gateway defaults, runtime language, prompt shape, and default agent/skill assignments.
- **Tasks** are the executable work units. They include descriptions, statuses, comments, checklists, custom fields, tags, subtasks, attachments, and gateway activity history.
- **Agents, skills, tools, and MCP servers** describe AI capabilities that can be attached to projects or tasks and exported into gateway context.
- **Plan pipelines** organize groups of tasks for planning.
- **Run pipelines** execute planned tasks through Codex gateway runs.
- **Pipeline status** creates a live operational view of planning, running, blocked, failed, and completed work.

## Technology Stack

- Runtime: Electron main process plus React renderer.
- Build tooling: `electron-vite`, Vite, TypeScript, Sass modules.
- UI: React 19, React Router, Redux Toolkit, Mantine, React Bootstrap, React Icons, TanStack Table, Chart.js.
- Storage: SQLite through a local `SqliteAdapter`.
- AI gateway: local Codex CLI, optionally launched in terminal mode or `codex exec` mode.
- MCP support: local stdio and Streamable HTTP MCP servers through `@modelcontextprotocol/sdk`.
- Tests: Vitest.

Important entry points:

- Main process bootstrap: `src/main/index.ts`, `src/main/bootstrap/app.ts`
- Service composition: `src/main/services/service-container.ts`
- IPC routing: `src/main/ipc/router.ts`
- HTTP internal API: `src/main/internal-api/http-server.ts`
- Shared IPC contract: `src/shared/contracts/ipc.ts`
- Shared entity types: `src/shared/types/entities.ts`
- Renderer app routes: `src/renderer/src/App.tsx`
- Navigation config: `src/renderer/src/navigation/nav.config.ts`

## Runtime Architecture

### Main Process

The main process starts from `bootstrapApp()`. It creates the application context, registers IPC routes, starts the job scheduler, starts the internal HTTP server, creates the main browser window, and on macOS creates a companion tray window.

The main process owns:

- SQLite connection and migrations.
- Repository and service instances.
- IPC handlers.
- Internal HTTP API and Server-Sent Events.
- Gateway process launch scripts.
- Renderer health monitoring and restart behavior.
- Local OS integrations such as file pickers, shell open, restart, avatar file serving, database relocation, and companion window navigation.

The Electron window uses `contextIsolation: false`, `nodeIntegration: true`, and `sandbox: false`, so renderer code can access Electron IPC through `require('electron')`.

### Renderer

The renderer is a React app mounted by `src/renderer/src/main.tsx` and routed by `src/renderer/src/App.tsx`. Signed-in users see the `AppShell` layout with navigation groups:

- Overview: Dashboard, Chats
- Projects: Project groups, Projects, Plan Pipeline, Run Pipeline, Pipeline Status
- Templates: Statuses, Task Templates, Project Instructions, Tags, Custom fields, Data Formats
- Capabilities: Agents, Tools, MCP, Skills
- Administration: Settings, Documentation

The renderer calls backend functionality through `invokeBridge()` and listens to events with `subscribeToChannel()`. In Electron it uses IPC. In web-like contexts it can fall back to HTTP endpoints exposed by the internal server.

### Shared Contract

`IPC_CHANNELS` is the central channel map. `SERVICE_ROUTING` maps channels to service methods. The dispatcher normalizes request envelopes, injects actor tokens, blocks Electron-only routes over HTTP, invokes the service method, and wraps response metadata.

Request shape:

```json
{
  "requestId": "uuid",
  "correlationId": "uuid",
  "actorToken": "session-token",
  "payload": {},
  "meta": {}
}
```

Response shape uses the shared service response contract: successful responses include `ok: true` and `data`; failures include `ok: false` and an `error` with a code and message.

## Data Storage

The app stores data in `mission-control.sqlite`. The database location is normally under the Electron `userData` folder in a `db` directory. A `.omc/database-location.json` metadata file can point to a pending or active database folder. In development, the app prefers the default user data database folder and can adopt an older repo-local `data/mission-control.sqlite`.

Migrations live in `src/db/migrations`. The schema has evolved from "boards" to "projects"; migration `007_projects_rename.sql` renames board tables and columns.

Major persisted entities:

- Organizations, users, sessions, refresh tokens, memberships
- Projects and project groups
- Tasks, subtasks, task tags, task skills
- Status templates and project statuses
- Tags and custom fields
- Agents, skills, packs, AI tools
- Gateways, gateway sessions, gateway commands, gateway history
- MCP servers, capabilities, OAuth tokens, links, audit events
- Task templates and project instruction templates
- Plan pipeline records and batches
- Run pipeline batches, stages, items, and public status tokens
- Jobs, activities, webhooks, webhook deliveries

## Authentication and Sessions

`AuthService` manages users, sessions, refresh tokens, profile data, avatars, login rate limiting, and password updates.

Key behavior:

- Passwords are stored with bcrypt for new hashes.
- Legacy plain or PBKDF2-style hashes can be recognized and rehashed.
- Login attempts are rate-limited by email and source.
- Desktop IPC calls can create a local desktop session automatically when a route requires auth and no actor token exists.
- Refresh tokens are persisted differently in desktop and web-style contexts.
- Profile avatars are stored under the Electron user data folder and served through `/api/profile/avatar`.

## Projects

Projects are the main container for work. A project includes:

- Name and description.
- Workspace assignment.
- General context.
- General prompt.
- Default output instruction.
- Gateway settings under `metrics.gateway`.
- Project rules, plan guide, and post-run prompt under project metrics.
- Default agent and default skills.
- Linked MCP servers.

Project services can list, create, update, delete, move workspace, and export workspace content. Moving a workspace relocates project/task attachment payloads into the new project folder where possible.

Project-level gateway settings include:

- `gatewayId`
- `runtimeWorkspaceId`
- `defaultModel`
- `planModel`
- `runModel`
- `language`
- `promptShape`: `markdown`, `json`, or `toon`
- `planReasoningEffort`
- `runReasoningEffort`

Project instructions are applied during gateway planning and execution. The run prompt gives priority to the task objective first, then task details, then project instructions, then agent/skill/tool capability context.

## Workspaces

Workspaces represent local filesystem roots. A project may have a normal workspace and a gateway runtime workspace. The gateway runtime workspace is where Codex CLI is launched and where `.omc/runs/<run-id>/` helper files are created.

Workspace features:

- Create, update, remove workspace records.
- Pick folders using Electron dialogs.
- Store project exports under workspace-specific folders.
- Use runtime workspace paths as trusted Codex CLI working directories.

## Statuses

OpenMissionControl supports reusable status templates and project-specific statuses. Status categories are:

- `not_started`
- `active`
- `done`
- `closed`

The status category matters for AI execution. Exported task context marks done or closed subtasks with a bypass action so execution agents do not redo completed work.

Status features:

- Create, update, delete status templates.
- Apply templates to projects.
- Update project statuses with mappings.
- Normalize task statuses to valid project statuses.
- Move tasks after planning into the first status after the planning state when applicable.

## Tasks

Tasks are the main unit of planning and execution. A task can include:

- Title, status, description.
- Assigned agent.
- Tags and skills.
- Custom field values.
- Checklist items.
- Comments.
- Subtasks.
- Attachments stored in task payload.
- Gateway settings overrides.
- Gateway activity messages and plan state.

Task service capabilities include:

- List tasks by project.
- List planned gateway tasks.
- List running gateway tasks.
- Get, create, update, delete tasks.
- Import JSON into tasks.
- Export task snapshots.
- Add, update, and remove comments.
- Create, update, and remove subtasks.
- Set task tags and skills.
- Get task history.
- Build planner context.
- Validate planner JSON.
- Create or update tasks from planner JSON.
- Launch Codex planning, execution, and chat sessions.
- Stop or resolve gateway conversations.
- Move a task to review through the run-specific helper.

### Subtasks

Subtasks are treated as the authoritative execution plan inside exported task context. They are ordered by `sortOrder`, have their own status, description, payload metadata, assignee information, tags, skills, checklist, comments, custom fields, and attachments.

Execution agents should:

1. Read the parent task first.
2. Execute actionable subtasks in order.
3. Bypass subtasks marked done, completed, or closed.
4. Treat subtask descriptions as primary guidance and checklist items as supporting detail.

### Task Payload Conventions

Task and subtask payloads carry structured metadata that does not have first-class columns:

- `description`
- `attachments`
- `checklistItems`
- `comments`
- `tagIds`
- `skillIds`
- `customFields`
- `agentId` / `assigneeId`
- `inputFormatId`
- `outputFormatId`
- `gateway`
- `activityMessages`
- `gatewayPlanState`

When changing task behavior, check both entity fields and payload conventions.

## Task Import

The task JSON importer normalizes user-provided JSON into `TaskEntity` and subtask records. It accepts one task object for single import and an array for bulk import.

Supported root task fields:

- `title` required
- `description`
- `status`
- `tags`
- `customFields`
- `checklist`
- `comments`
- `subtasks`

Supported subtask fields:

- `title` required
- `description`
- `status`
- `tags`
- `customFields`
- `checklist`
- `comments`
- `dueAt`

Unsupported import keys currently produce warnings instead of full import behavior:

- `inputFormatId`
- `outputFormatId`
- `attachments`
- `agent`
- `skills`

### Example Task Import

```json
{
  "title": "Add pipeline status filters",
  "description": "Add UI and service support for filtering pipeline status by project, phase, and runtime state. Preserve existing watch-token behavior.",
  "status": "Not started",
  "tags": ["frontend", "pipeline"],
  "customFields": {
    "Priority": "High",
    "Risk": "Medium"
  },
  "checklist": [
    {
      "title": "Review existing pipeline status snapshot shape",
      "checked": false
    },
    {
      "title": "Keep public watch URL behavior unchanged",
      "checked": false
    }
  ],
  "comments": [
    {
      "authorName": "Planner",
      "body": "The filter should apply to displayed rows without changing persisted pipeline state."
    }
  ],
  "subtasks": [
    {
      "title": "Add filter state and controls",
      "description": "Extend the Pipeline Status screen with project, phase, and status filters using existing page styling conventions.",
      "status": "Not started",
      "tags": ["frontend"],
      "checklist": [
        {
          "title": "Filters should compose together",
          "checked": false
        }
      ]
    },
    {
      "title": "Verify status snapshot filtering behavior",
      "description": "Confirm active tasks, run status items, and public watch views still render correctly after filtering.",
      "status": "Not started",
      "tags": ["verification"]
    }
  ]
}
```

## Task Export and Gateway Context

Task export is used for manual download and Codex gateway execution. The renderer builds a project workspace export payload and can generate a ZIP or send file content directly to the main process.

Exported files:

- `Task.md`
- `Task.json`
- `Task.toon`
- `Agents.md`
- `Skills.md`
- `Tools.md`
- `attachments/`

The selected project prompt shape determines the primary task file:

- Markdown uses `Task.md`
- JSON uses `Task.json`
- TOON uses `Task.toon`

The task format contract includes:

- Format metadata and file policy.
- Project identity, group, language, gateway settings, and instructions.
- Task title, status, description, tags, fields, checklist, comments, attachments, and counts.
- Agent and skill references.
- Ordered subtasks with `aiAction` values.

The generated AI execution flow tells agents to read task details, subtasks, comments, checklist, attachments, project instructions, agents, skills, and tools before implementing.

## Agents

Agents describe reusable AI personas or operating instructions. An agent includes:

- Name, title, description.
- Training markdown.
- Tags.
- Linked tools.
- Linked MCP servers.
- Configuration payload.

Agents can be assigned directly to a task or used as the project default. During export, effective agent resolution prefers the task agent, then the project default agent. Agent details are placed in `Agents.md`; task files contain references to that file.

## Skills

Skills are reusable capability descriptions. A skill includes:

- Name, slug, category, version.
- Enabled/status state.
- Description markdown.
- Linked MCP servers.

Skills can be assigned directly to tasks or inherited from project defaults. During export, effective skill resolution prefers task skills when present; otherwise it uses default project skill IDs. Skill details are placed in `Skills.md`.

## Tools

Tools are AI capability catalog records. Tool types are:

- `local_command`
- `function`
- `code`
- `reference`

Tool records can include:

- Description markdown.
- Code language and code body.
- Function name.
- Command template and prepare command.
- Working directory hint.
- Input and output JSON schemas.
- Execution flow markdown.
- Approval requirement.
- Timeout in seconds.
- Linked agents.

Tools are exported as capability context for agents. In the current gateway prompt policy, tools are catalog context only. AI agents should not execute catalog command templates or code bodies unless a future approved runtime explicitly enables tool invocation and approval.

## MCP Servers

MCP support is managed by `McpService`. Supported transports:

- `stdio`
- `streamable_http`

Supported auth modes:

- `none`
- `bearer_env`
- `oauth`

MCP records can define risk tier, required/enabled flags, command, args, cwd, env vars, URL, headers, enabled/disabled tools, startup timeout, tool timeout, capabilities, OAuth status, and audit history.

MCP features:

- Create, update, delete, list, and get servers.
- Test/discover server capabilities.
- OAuth start and complete for remote Streamable HTTP servers.
- OAuth logout.
- Link servers to agents, skills, and projects.
- Audit MCP activity.

Gateway runs compute effective MCP servers from project, agent, and skills. The run-specific `.omc` MCP proxy exposes configured servers to Codex CLI when applicable.

## Gateways

Gateways represent AI execution backends. The current primary provider is `codex_cli`.

Gateway records include:

- Name.
- Endpoint or Codex path.
- Status.
- Token field, masked when returned.
- Template config.
- Sessions, commands, and history.

Codex CLI gateway config includes:

- `provider: "codex_cli"`
- `codexPath`
- `executionMode`: `terminal` or `exec`
- Cached model catalog.
- Last model refresh metadata.

Gateway model refresh runs `codex debug models`, parses the returned model catalog, stores recommended/supports-reasoning flags, and falls back to cached models if refresh fails.

Gateway status events are emitted through `gatewayStatus`.

## Codex Planning Flow

Planning is launched through `tasks:plan-with-gateway`. It requires:

- Task ID.
- Project ID.
- Gateway ID.
- Model.
- Project runtime workspace.

The service resolves:

- Project prompt snapshot.
- Gateway language.
- Prompt shape.
- Plan reasoning effort.
- Effective agent.
- Effective skills.
- Effective MCP servers.

It then creates a temporary run folder and a runtime workspace `.omc/runs/<run-id>/` folder containing:

- `session.json`
- `omc-task-client.mjs`
- `omc-mcp-proxy.mjs`
- `OMC_CLI.md`
- `context.json` when generated
- `planned-task.json` when generated
- `questions.json` for ask-first planning

Planning modes:

- `ask-first`: the AI writes clarification questions and uses the helper `ask` command. It must not update the task in that run.
- `direct`: the AI writes `planned-task.json`, validates it, updates the scoped source task, and finishes.

Planner rules are intentionally strict:

- Use the current task title, description, status, comments, checklist, custom fields, tags, and subtasks as authoritative context.
- Refactor the entire subtask array when planning.
- Use balanced decomposition.
- Avoid generic subtasks such as "Run tests" or "Fix bugs".
- Preserve user comments.
- Add planner comments for assumptions, risks, and decisions.
- Keep status changes valid against allowed project statuses.

## Codex Run Flow

Execution is launched through `tasks:run-gateway`. It requires:

- Task ID and project ID.
- Gateway ID and model.
- Snapshot payload or ZIP bytes.
- Runtime workspace configured on the project.

The service writes or unzips the task export into a temporary export workspace, writes helper files into the runtime workspace, creates a bridge server scoped to the task, and launches Codex CLI.

The generated run prompt instructs the AI to:

- Read the primary task file first.
- Read `Agents.md`, `Skills.md`, `Tools.md`, and `attachments/` only if present and needed.
- Apply project rules before implementation decisions.
- Apply plan guide when planning or interpreting execution strategy.
- Bypass completed/done/closed subtasks.
- Use the local `.omc` helper only as hidden runtime plumbing.
- Use `ready-for-review` only after implementation and checks are complete.

Execution modes:

- `terminal`: writes and launches a shell wrapper in a terminal window.
- `exec`: launches `codex exec --json` and streams events to task activity.

Run activity is stored as task payload `activityMessages`. These messages power chat history, running gateway menus, pipeline status, and run pipeline state transitions.

## Gateway Chat Flow

Project detail includes a chat composer that can send follow-up messages to Codex. Chat can operate in normal chat mode or plan mode. A leading `/plan` command switches a message into planner mode.

Chat features:

- Start a new conversation or continue a selected conversation.
- Include current task/project context.
- Attach up to 10 files, with a 25 MB per-file limit.
- Send clarification answers for pending planner questions.
- Stop running conversations.
- Resolve a conversation as stopped, completed, or failed.
- Use a built-in code review prompt for review-oriented conversations.

Chat messages are persisted into task activity, grouped by `conversationId` and `runId`.

## Plan Pipelines

Plan pipelines group tasks into ordered planning stages. A batch contains one or more records; each record has:

- Source draft name.
- Group name and description.
- Group order.
- Project IDs.
- Task IDs.
- Status.
- Progress.
- Retry count.
- Run mode: `questioned` or `silent`.
- Summary context and last error.

Creation rules:

- A pipeline needs a name.
- At least one project must be selected.
- At least one group must exist.
- Every group needs a name and at least one task.
- A task can belong to only one group in the same pipeline.
- Task IDs must belong to selected projects.

Plan batches can be configured to create a run pipeline automatically when the full plan batch completes.

## Run Pipelines

Run pipelines execute tasks through Codex gateway runs. A run pipeline contains:

- Batch.
- Ordered stages.
- Items inside each stage.

A manual run pipeline can be created from selected projects and stages. A run pipeline can also be created from a completed plan pipeline batch.

Run behavior:

- `start` marks the batch running and launches the next queued item.
- Only one item runs at a time per pipeline.
- Launching an item calls `runGatewayForTask()`.
- Task activity messages update item state.
- Completed gateway activity marks the item completed and advances.
- Failed activity marks item failed, stage blocked, and batch blocked.
- `pause` stops the active gateway conversation and returns the item to queued.
- `resume` starts again.
- `cancel` stops the active gateway conversation and blocks remaining work.
- `retryItem` resets an item and launches again.
- `skipItem` marks an item skipped and advances.

The current failure policy is `stop_on_failure`.

## Pipeline Status

Pipeline status combines:

- Recent single-task gateway runs.
- Plan pipeline batches and records.
- Run pipeline batches, stages, and items.
- Active tasks.
- Project summaries.

The service builds a `PipelineStatusSnapshot` with `statusItems` ranked by runtime importance:

1. Running
2. Queued or pending
3. Needs input, planned, paused, blocked
4. Failed or cancelled
5. Completed or skipped
6. Other events

Status can be viewed inside the authenticated app or through public watch tokens. Watch tokens are stored hashed and can scope to all pipeline status or one run pipeline.

The internal HTTP server exposes public pipeline status snapshots and SSE events for status boards.

## Project Groups

Project groups organize projects. A group contains:

- Name.
- Description.
- Settings JSON.
- Project IDs.
- Project count.

Groups are used by the UI for project organization and can influence exported task context by providing group identity.

## Templates

### Task Templates

Task templates store reusable task payloads. A template can include:

- Title, description, status.
- Agent ID.
- Tags and skills.
- Custom field values.
- Checklist items.
- Comments and attachments.
- Gateway settings.
- Subtasks.

Templates can be created directly or imported from normalized task JSON.

### Project Instruction Templates

Project instruction templates store reusable instruction bundles:

- General context.
- General prompt.
- Plan guide.
- Default output.
- Rules.
- Post-run prompt.

These are applied to projects to keep gateway behavior consistent.

### Output Formats

Output formats describe structured input or output expectations for agents. They contain nested fields with:

- Key.
- Description.
- Default value.
- Value type.
- Required flag.
- Enum values.
- Children.

Formats also have a role: `input` or `output`, plus optional instruction markdown.

## Tags and Custom Fields

Tags are organization-scoped labels with color, description, update time, and task count metadata.

Custom fields are organization-scoped typed fields:

- `text`
- `number`
- `boolean`
- `json`

Task import and task editing normalize custom field values by type. JSON fields parse string JSON values when needed.

## Attachments

Attachments are uploaded through `AttachmentService`. They can belong to tasks, subtasks, or templates through payload metadata. Task export copies file attachments into the exported `attachments/` directory when they use local `file://` URLs. Unavailable or linked attachments remain referenced in the manifest.

Attachment upload and workspace export behavior depends on the project workspace path.

## Webhooks and Jobs

Webhooks are persisted with:

- URL.
- Active flag.
- Secret.
- Event types.
- Failure count.

Webhook deliveries track attempts and response details.

Jobs are persisted with status, attempts, max attempts, next run time, payload, and timestamps. The scheduler periodically claims pending jobs, processes them by type, retries failures with backoff, and marks exhausted jobs as dead.

## Settings and Administration

The settings service manages:

- Active gateway.
- Default agent.
- Default add-task project.
- Gateway language.
- Planner question attention behavior.
- Database location state.
- Web server status.
- Database folder/file picking.
- Database relocation.
- Revealing database location.
- Opening web server URLs.

Some settings actions are Electron-only and are blocked over HTTP by the internal API dispatcher.

## Internal HTTP API

The internal HTTP server supports:

- Static renderer serving.
- Auth REST endpoints under `/api/auth/*`.
- Generic service dispatch by IPC channel.
- Public pipeline status snapshots.
- Server-Sent Events for app events.
- Profile avatar serving.
- MCP OAuth callback handling.
- Management actions such as restart.

HTTP capabilities are intentionally narrower than IPC. File picker, shell, restart, and local file access behavior are marked separately in `INTERNAL_API_CAPABILITIES`, and some Electron-only routes are forbidden over HTTP.

## Events

Important renderer-facing events:

- `events:app-navigate`
- `events:gateway-status`
- `events:task-updated`
- `events:job-progress`
- `events:task-activity`
- `events:plan-pipeline-updated`
- `events:run-pipeline-updated`
- `events:pipeline-status-updated`

The service container bridges task, task activity, plan pipeline, and run pipeline events into pipeline status update events so dashboards and status screens can refresh without polling every model separately.

## Renderer Feature Map

### Dashboard

Shows overview-level navigation and summary information. Detailed dashboard route exists at `/dashboard/detail`.

### Projects

Project list, project creation, and project detail are the busiest parts of the app. Project detail manages:

- Board/table/list views.
- Task selection.
- Task creation.
- Task detail editing.
- Subtask detail routes.
- Drag/drop task ordering.
- Status editing.
- Project settings.
- Workspace selection.
- Project group assignment.
- Gateway planning, running, and chat.
- Recent project chats.
- Analytics modal.
- Bulk JSON import.
- Task export and ZIP generation.

### Plan Pipeline

Creates and monitors grouped planning batches. It can launch planning in questioned or silent mode and optionally trigger run pipeline creation when planning completes.

### Run Pipeline

Creates manual run pipelines, starts/pauses/resumes/cancels execution, and manages retry/skip for failed or blocked items.

### Pipeline Status

Displays live execution status and can operate as a standalone or watch-token route.

### Capabilities

Agents, tools, MCP servers, and skills are managed in their own screens and linked into project/task gateway context.

### Templates

Statuses, task templates, project instruction templates, tags, custom fields, and output formats provide reusable structure for task creation and AI context.

### Companion

The macOS companion window is a small always-on-top tray-triggered route. It can navigate the main window and open task creation flows.

## AI Planning Guidance

When giving this guide to an AI agent, the most important planning model is:

1. Identify whether the task changes main process services, renderer UI, shared contracts, database schema, gateway runtime, or documentation only.
2. Read the relevant shared contract and entity type before editing either side of the IPC boundary.
3. For UI changes, follow existing `index.tsx` plus `index.module.scss` locality and nested Sass conventions.
4. For task/project behavior, inspect both service code and repository code because some values live in payload JSON rather than columns.
5. For gateway behavior, inspect `TaskService`, task export builders, gateway service, and pipeline status code together.
6. For pipeline behavior, trace both persisted pipeline repositories and task activity events.
7. For import/export work, preserve backwards compatibility and produce warnings for unsupported fields instead of silently dropping user intent.
8. For database changes, add a migration and update repository mapping code and shared entity types together.
9. For new renderer routes, update route constants, `App.tsx`, navigation config if needed, and route metadata.
10. For any AI run prompt behavior, verify prompt priority and hidden `.omc` helper mechanics.

## Common Implementation Touch Points

- New service route: update `IPC_CHANNELS`, `SERVICE_ROUTING`, service class, renderer caller, and tests.
- New persisted field: migration, repository map/read/write code, shared entity type, service validation, renderer form state.
- New task metadata: decide whether it belongs in a column or payload JSON; update export/import if AI context needs it.
- New project gateway option: project metrics handling, settings UI, export context, plan/run prompt generation.
- New pipeline state: shared type, repository state transitions, service recalculation, pipeline status summary, renderer badges.
- New agent capability: agent/tool/skill/MCP link handling and export context.
- New documentation page content: renderer documentation constants or markdown source, plus route behavior if it is navigable.

## Verification Strategy

Use focused checks based on the changed surface:

- Type and build check: `npm run build`
- Full tests: `npm test`
- Service-only behavior: targeted Vitest files under `src/main/services` or `src/db/repositories`
- Renderer utility behavior: targeted tests under `src/renderer/src`
- Gateway prompt/export behavior: tests around `taskExport`, `task.service`, planner validation, and gateway activity parsing
- Pipeline behavior: `plan-pipeline.service.test.ts`, `run-pipeline.service.test.ts`, `pipelineStatusUtils.test.ts`

For documentation-only changes, check that the markdown file is in `docs/`, is readable, and accurately references current source structure.
