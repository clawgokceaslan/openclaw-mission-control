export interface CodexDocTerm {
  term: string
  description: string
}

export interface CodexDoc {
  id: string
  title: string
  category: string
  summary: string
  sourceFiles: string[]
  terms: CodexDocTerm[]
  markdown: string
}

export const CODEX_DOCS: CodexDoc[] = [
  {
    id: 'omc-runtime-operations',
    title: 'OMC Runtime Operations',
    category: 'OMC Runtime',
    summary: 'Single source for Open Mission Control runtime file locations, OMC task flow, CLI commands, and documentation guidance.',
    sourceFiles: [
      'src/main/bootstrap/app.ts',
      'src/main/ipc/router.ts',
      'src/main/services/app-settings.service.ts',
      'src/main/services/service-container.ts',
      'src/db/config.ts',
      'src/shared/contracts/ipc.ts',
      'src/renderer/src/screens/settings/SettingsPage.tsx',
      'src/renderer/src/constants/codex-docs.ts'
    ],
    terms: [
      { term: 'Database folder', description: 'Folder where the SQLite database file is written.' },
      { term: 'Pending restart', description: 'State that requires an app restart before the location switch is applied.' },
      { term: 'Runtime docs', description: 'Runtime and OMC CLI execution guidance shown in Documentation instead of Settings.' }
    ],
    markdown: `# OMC Runtime Operations

Open Mission Control now keeps runtime helper instructions in Documentation and supports configurable SQLite database folder selection in Settings.

## Runtime workflow

1. Open Mission Control exports \`Task.md\`, \`Agents.md\`, \`Skills.md\` and attachments into a temporary export workspace.
2. The project workspace is opened as a runtime directory.
3. \`.omc/runs/<run-id>/\` is created in the workspace.
4. The run folder includes \`session.json\`, \`omc-task-client.mjs\`, and \`OMC_CLI.md\`.
5. Codex receives the exported task path and executes changes in the runtime workspace.
6. After implementation, Codex runs the local ready-for-review command.

## Database folder behavior

- Database location is stored before fallback to \`userData/data\`.
- Moving the database file is snapshot-and-restart:
  - Current \`mission-control.sqlite\` is written to the selected folder with a live SQLite snapshot when the app database is open.
  - In development, \`data/mission-control.sqlite\` is detected as a source candidate when Electron points at a userData folder.
  - If the configured source is missing, the user can select an existing SQLite database file manually.
  - New folder is persisted.
  - New path is used only on next app start.

Allowed path checks include:

- destination is created when it does not exist;
- destination must not already contain \`mission-control.sqlite\`;
- existing non-file named \`mission-control.sqlite\` blocks move;
- same-folder selections clear pending changes;
- selecting the current pending folder is idempotent.

## Helpful OMC commands

\`\`\`bash
node .omc/runs/<run-id>/omc-task-client.mjs context
node .omc/runs/<run-id>/omc-task-client.mjs validate .omc/runs/<run-id>/planned-task.json
node .omc/runs/<run-id>/omc-task-client.mjs create .omc/runs/<run-id>/planned-task.json
node .omc/runs/<run-id>/omc-task-client.mjs update .omc/runs/<run-id>/planned-task.json
node .omc/runs/<run-id>/omc-task-client.mjs ask .omc/runs/<run-id>/questions.json
node .omc/runs/<run-id>/omc-task-client.mjs ready-for-review
node .omc/runs/<run-id>/omc-task-client.mjs finish
\`\`\`

## Migration notes

- Existing \`Settings\` inline OMC docs were moved here.
- Documentation keeps both Codex CLI and OMC Runtime entries in separate categories.`
  },
  {
    id: 'codex-cli-gateway',
    title: 'Codex CLI Gateway',
    category: 'Gateway',
    summary: 'How Open Mission Control stores named Codex CLI app-server endpoints.',
    sourceFiles: ['src/renderer/src/screens/gateways/*', 'src/main/services/gateway/*', 'src/shared/types/entities.ts'],
    terms: [
      { term: 'Codex CLI gateway', description: 'A named endpoint for an externally managed Codex CLI app-server.' },
      { term: 'app-server URL', description: 'A ws:// or wss:// URL started outside Open Mission Control with codex app-server.' },
      { term: 'external runtime', description: 'Codex CLI owns the workspace and command execution environment.' }
    ],
    markdown: `# Codex CLI Gateway

Gateways now represent named Codex CLI endpoints. Open Mission Control stores the endpoint, display name, optional bearer token, and optional workspace note.

Open Mission Control does not start Codex CLI, run commands, pair devices, or sync agents from the Gateway screen yet. The CLI is expected to run outside the app.

## Remote app-server shape

\`\`\`bash
codex app-server --listen ws://127.0.0.1:4500
codex --remote ws://127.0.0.1:4500
\`\`\`

For non-local access, run the app server on a reachable interface and put authenticated non-local connections behind TLS.

\`\`\`bash
codex app-server --listen ws://0.0.0.0:4500
codex --remote wss://codex.example.com:4500
\`\`\`

## Authentication notes

- No WebSocket auth is acceptable for localhost or SSH port-forwarded connections.
- Capability token auth uses \`--ws-auth capability-token\` and \`--ws-token-file\`.
- Signed bearer token auth uses \`--ws-auth signed-bearer-token\` and \`--ws-shared-secret-file\`.
- Remote auth tokens are sent as \`Authorization: Bearer <token>\` only over \`wss://\` or local \`ws://\` hosts.

## Product rule

Agent sync is removed. Agent definitions stay in Open Mission Control until a future Codex CLI execution flow is implemented.`
  },
  {
    id: 'task-planning-features',
    title: 'Task Planning Features',
    category: 'Planning',
    summary: 'User-facing planning features for preparing tasks before execution, including plan status, plan-ready tasks, project guidance, model settings, and planner questions.',
    sourceFiles: [
      'src/renderer/src/popups/TaskDetail/index.tsx',
      'src/renderer/src/components/navigation/PlannedTasksMenu/index.tsx',
      'src/renderer/src/components/navigation/TopHeader.tsx',
      'src/renderer/src/components/planner/PlannerQuestionHost.tsx',
      'src/renderer/src/components/planner/plannerQuestionQueue.ts',
      'src/renderer/src/popups/PlanChoiceModal/index.tsx',
      'src/renderer/src/popups/ProjectPromptSettings/index.tsx',
      'src/renderer/src/popups/ProjectDetailSettingsPopup/index.tsx',
      'src/renderer/src/screens/projects/detail/hooks/useProjectGatewayFlow.ts',
      'src/renderer/src/screens/projects/detail/projectDetailUtils.ts',
      'src/shared/constants/project-instruction-templates.ts',
      'src/shared/contracts/ipc.ts'
    ],
    terms: [
      { term: 'Task planning', description: 'The product workflow that turns a task into an implementation-ready work item before run execution.' },
      { term: 'Plan status', description: 'The task lifecycle state that shows whether planning is pending, running, ready, blocked, failed, paused, or stale.' },
      { term: 'Plan guide', description: 'Project-level instructions that shape how future planning updates task descriptions, subtasks, checklist items, comments, and acceptance criteria.' },
      { term: 'Planner questions', description: 'Clarification prompts that wait globally until the user answers them or opens the related task chat.' },
      { term: 'Plan-ready task', description: 'A task whose planning phase has completed and can appear in the header menu for execution or missing-setting repair.' }
    ],
    markdown: `# Task Planning Features

Planning is the preparation layer for task execution in Open Mission Control. It helps users turn rough tasks into implementation-ready work by clarifying scope, shaping subtasks, recording acceptance criteria, and surfacing the task as ready to run.

This document covers user-facing planning features in project and task workflows. Plan Pipeline and Pipeline Runs are separate automation surfaces and are intentionally outside this scope.

## Task lifecycle panel

Each task detail view includes a lifecycle panel with four stages:

- Planla: shows whether the task still needs planning, is currently being planned, has a ready plan, or needs attention.
- Çalıştır: becomes available after a plan is ready, or when run history already exists.
- Doğrula: summarizes post-run verification state after execution.
- Tamamla: guides the user to close the task only after the result and acceptance criteria are checked.

The planning stage can show states such as Plan bekliyor, Planlanıyor, Plan hazır, Onay bekliyor, Duraklatıldı, Kontrol gerekiyor, Bloke, or Müdahale gerekiyor. The same panel provides Planla, Yeniden dene, or Duraklat actions depending on the current state.

## Plan action

Users can start planning from the task detail primary action or from the task chat planning action. Planning is disabled until the task can resolve a gateway and plan model from project settings or task-level overrides.

When a plan is started, the app asks whether the planner should first ask clarification questions or proceed directly from the available task context. Clarification-first planning is useful when product decisions, scope boundaries, or acceptance criteria are not obvious. Direct planning is useful when the existing task data is already enough.

Planning updates the task plan only. Implementation work remains a separate run step.

## Plan-ready tasks menu

The top navigation includes a plan-ready tasks menu. It lists tasks whose planning phase has produced a runnable plan or tasks that are nearly runnable but still miss required execution settings.

Rows show:

- task title;
- project name;
- readiness label such as Çalıştırmaya hazır, Gateway gerekli, Çalışma modeli gerekli, or Gateway ve çalışma modeli gerekli;
- a play action when the task is runnable;
- a settings action when required gateway or model configuration is missing.

The menu refreshes when task activity or task updates change planning or run readiness. It supports pagination so users can work through many planned tasks without opening each project first.

## Planner questions

Planner questions are clarification prompts created during planning. The global planner question control in the top header shows how many unanswered question batches are waiting.

Opening a question shows the related task, project, summary, visible question path, recommended options, optional notes, and an action to open the related chat. Follow-up questions appear only when their parent option is selected, and hidden branch answers are pruned before submission.

When the user submits an answer, the app sends the selected options and notes back into the same planning conversation. If a question includes first-option defaults, the user can skip with those first answers. Questions that already have later clarification answers are removed from the queue.

## Project plan guide

Project prompt settings include a Plan guide tab. This is the main place to define how task planning should behave for the project.

The standard plan guide tells planning to:

- inspect all task fields before changing the task;
- make the task implementation-ready;
- preserve useful user-provided details;
- rewrite the subtask list into a clearer execution plan when needed;
- keep subtasks ordered by dependency;
- fill missing or incomplete acceptance criteria;
- avoid marking the task complete during planning.

The plan guide is exported with task context, so future planning updates can follow project-specific expectations instead of relying only on generic behavior.

## Project planning settings

Project Codex settings provide the default planning configuration:

- gateway;
- runtime workspace;
- plan model;
- plan reasoning effort when supported by the selected model;
- run model and run reasoning effort for the later execution stage;
- language and prompt shape settings.

Planning specifically uses the project plan model, falling back to the project default model when appropriate. It does not use the run model unless the user is starting execution rather than planning.

## Task planning overrides

Individual tasks can override project-level planning configuration in the task detail Model tab. A task can set its own gateway, plan model, and plan reasoning effort while still inheriting project defaults for fields left blank.

Changing the task gateway also rechecks available models. If the current task model selection is not available on the newly selected gateway, the task-level model override is cleared so the task can fall back to a valid project setting.

## Task plan content

A planned task can include updates to:

- title and description;
- acceptance criteria;
- subtasks and subtask descriptions;
- checklist items;
- comments and decision notes;
- tags, skills, agent assignment, and custom fields when relevant;
- gateway and model context used by later task export and run workflows.

The resulting task plan is what users review before execution and what later appears in exported task context for a run.

## Out of scope

This Planning documentation does not cover Plan Pipeline creation, saved pipeline groups, pipeline dashboards, Pipeline Runs, or pipeline execution history. Those features have their own navigation, state model, and documentation needs.`
  },
  {
    id: 'codex-cli-interactive',
    title: 'Interactive CLI Workflows',
    category: 'CLI',
    summary: 'Core interactive mode, resume, images, reviews, web search, and automation.',
    sourceFiles: ['Codex CLI feature documentation'],
    terms: [
      { term: 'codex', description: 'Launches the full-screen terminal UI.' },
      { term: 'codex resume', description: 'Reopens a previous local transcript.' },
      { term: 'codex exec', description: 'Runs Codex non-interactively for scripts and CI-style tasks.' }
    ],
    markdown: `# Interactive CLI Workflows

Run \`codex\` to open the terminal UI. You can also provide an initial prompt:

\`\`\`bash
codex "Explain this codebase to me"
\`\`\`

Inside the TUI, Codex can read the repository, make edits, run commands, display diffs, accept screenshots, and queue follow-up prompts while work is running.

## Resume

\`\`\`bash
codex resume
codex resume --last
codex resume --all
codex resume <SESSION_ID>
codex exec resume --last "Implement the plan"
\`\`\`

Resumed runs keep the original transcript, plan history, and approvals.

## Automation

\`\`\`bash
codex exec "fix the CI failure"
codex exec --json --output-last-message result.md "summarize this repo"
\`\`\`

Use \`--cd\` to set the working root and \`--add-dir\` to grant additional writable roots.

## Reviews and inputs

- \`/review\` runs a local code review without touching the working tree.
- \`--image\` or \`-i\` attaches one or more images to the first message.
- \`--search\` enables live web search for a run; cached search is the default for local CLI tasks.`
  },
  {
    id: 'codex-cli-reference',
    title: 'Command Reference',
    category: 'Reference',
    summary: 'Important Codex CLI commands and global flags.',
    sourceFiles: ['Codex CLI command reference'],
    terms: [
      { term: '--model', description: 'Overrides the configured model for a run.' },
      { term: '--sandbox', description: 'Selects read-only, workspace-write, or danger-full-access command sandboxing.' },
      { term: '--remote', description: 'Connects the TUI to a remote app-server WebSocket endpoint.' }
    ],
    markdown: `# Command Reference

## Stable commands

- \`codex\`: launch the terminal UI.
- \`codex exec\`: run non-interactively.
- \`codex resume\`: continue a previous interactive session.
- \`codex fork\`: fork a previous session into a new thread.
- \`codex login\` / \`codex logout\`: manage authentication.
- \`codex completion\`: generate shell completions.
- \`codex features\`: list, enable, or disable feature flags.
- \`codex apply\`: apply a Codex Cloud task diff.

## App-server

\`codex app-server\` is experimental. It can listen on \`stdio://\` or \`ws://IP:PORT\`.

Important options:

- \`--listen stdio:// | ws://IP:PORT\`
- \`--ws-auth capability-token | signed-bearer-token\`
- \`--ws-token-file /absolute/path\`
- \`--ws-shared-secret-file /absolute/path\`

## Global flags

- \`--model, -m\`: choose a model, for example \`gpt-5.5\`.
- \`--profile, -p\`: load a config profile.
- \`--sandbox, -s\`: select the sandbox policy.
- \`--ask-for-approval, -a\`: choose approval behavior.
- \`--cd, -C\`: set the working directory.
- \`--add-dir\`: grant additional write roots.
- \`--remote\`: connect to an app-server endpoint.
- \`--remote-auth-token-env\`: read the remote bearer token from an environment variable.
- \`--search\`: use live web search for the run.`
  },
  {
    id: 'codex-cli-slash-commands',
    title: 'Slash Commands',
    category: 'TUI',
    summary: 'Built-in slash commands for model selection, permissions, review, sessions, and diagnostics.',
    sourceFiles: ['Codex CLI slash command documentation'],
    terms: [
      { term: '/permissions', description: 'Changes approval and sandbox behavior during a session.' },
      { term: '/model', description: 'Switches model and reasoning effort.' },
      { term: '/review', description: 'Runs a working-tree review.' }
    ],
    markdown: `# Slash Commands

Type \`/\` in the composer to open the slash command picker. While a task is running, press Tab to queue a slash command for the next turn.

## Session control

- \`/clear\`: clear terminal and start a fresh chat.
- \`/new\`: start a new conversation in the same CLI session.
- \`/resume\`: resume a saved conversation.
- \`/fork\`: fork the current conversation.
- \`/side\`: start an ephemeral side conversation.
- \`/compact\`: summarize the transcript to free context.

## Work controls

- \`/permissions\`: switch approval mode.
- \`/model\`: set active model.
- \`/fast\`: toggle fast mode.
- \`/plan\`: switch to plan mode.
- \`/review\`: inspect local changes.
- \`/diff\`: show working tree diff.

## Diagnostics and configuration

- \`/status\`: inspect model, approvals, roots, and tokens.
- \`/debug-config\`: inspect config layers and policy requirements.
- \`/mcp\`: list configured MCP tools.
- \`/apps\`: browse apps and insert app mentions.
- \`/plugins\`: browse installed and discoverable plugins.
- \`/statusline\`, \`/title\`, and \`/keymap\`: customize the TUI.`
  }
]

export const CODEX_DOC_CATEGORIES = [...new Set(CODEX_DOCS.map((doc) => doc.category))]
