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
    id: 'codex-planning-workflows',
    title: 'Codex Planning Workflows',
    category: 'Planning',
    summary: 'User-facing Codex planning flow from task planning launch through clarification, model settings, JSON validation, and task update.',
    sourceFiles: [
      'src/renderer/src/screens/projects/ProjectDetailPage.tsx',
      'src/renderer/src/screens/projects/detail/hooks/useProjectGatewayFlow.ts',
      'src/renderer/src/popups/PlanChoiceModal/index.tsx',
      'src/renderer/src/components/planner/PlannerQuestionHost.tsx',
      'src/renderer/src/components/planner/plannerQuestionQueue.ts',
      'src/renderer/src/popups/ProjectDetailSettingsPopup/index.tsx',
      'src/renderer/src/popups/TaskDetail/index.tsx',
      'src/main/services/task.service.ts',
      'src/shared/contracts/ipc.ts'
    ],
    terms: [
      { term: 'Plan launch', description: 'Starts a Codex planning conversation for the selected task from the project detail chat controls.' },
      { term: 'Ask-first mode', description: 'Planner must ask clarification questions before writing or applying planned-task JSON.' },
      { term: 'Direct mode', description: 'Planner skips clarification and updates the current task plan from existing project and task context.' },
      { term: 'Plan model', description: 'The Codex model used for planning; it can come from project settings or a task-level override.' },
      { term: 'Planner JSON', description: 'The planned task payload that is validated and then applied to the scoped source task.' }
    ],
    markdown: `# Codex Planning Workflows

Codex planning turns a selected Open Mission Control task into a clearer execution plan. The flow updates task planning content; it does not run implementation work.

This document covers normal user planning flows only. Plan Pipeline and Pipeline Runs are separate automation surfaces and are intentionally outside this feature scope.

## Start a plan

1. Open a project and select a task.
2. Configure the Codex gateway, runtime workspace, and plan model if the task cannot already inherit them from the project.
3. Use the task chat planning action.
4. Choose how the planner should proceed in the planning checkpoint modal.

The planning launch requires a Codex gateway and a plan model. If either is missing, the app opens the model settings area so the user can complete the setup before retrying.

## Ask-first planning

Ask-first mode is for planning decisions where user input can materially change the task. The planner reads the current task and project context, then writes a questions file and runs the OMC helper's ask command.

Expected behavior:

- the planner asks 1-3 concise root questions;
- options may include recommended choices and nested follow-up questions;
- the planner must not write \`planned-task.json\`;
- the planner must not validate or update the task until the answer is submitted.

The app shows unanswered planner questions through the global planner question modal. After the user chooses options and adds notes, the answer is sent back into the same planning conversation as a clarification message. That follow-up run continues in direct mode because the required clarification has already been supplied.

## Direct planning

Direct mode is for fast plan updates when the existing context is enough. The planner does not ask questions and does not run the ask command.

Expected behavior:

- the planner uses the exported \`currentTaskJson\` as the starting shape;
- the planner writes \`planned-task.json\`;
- the OMC helper validates the JSON;
- the OMC helper updates the scoped source task;
- the planning run finishes after the update.

Direct mode still respects planner quality rules: subtasks should be action-oriented, ordered for execution, and specific enough to guide a later Codex Run.

## Plan model and effort

Planning uses the plan model rather than the run model. The effective plan model is resolved in this order:

1. task-level plan model override;
2. project-level plan model;
3. project default Codex model.

Reasoning effort follows the same split between plan and run settings. If the selected model supports reasoning, the plan reasoning effort is sent with the planning launch; otherwise the reasoning field is omitted. This lets users tune planning depth separately from implementation speed.

## Answer planner questions

Planner questions are collected from gateway activity metadata and from existing unanswered task history. The modal keeps the active project, task, gateway, plan model, language, and reasoning effort attached to the question.

When the user submits an answer:

- selected options and notes are formatted into a clarification message;
- stale answers from hidden follow-up branches are pruned;
- the same task and conversation are resumed with \`planWithGateway\`;
- the answered question is removed from the queue after a successful response.

If available, the user can skip with the first options; this submits the default first-option path without free-form notes.

## Task update result

Planner JSON is validated before it changes task data. Validation normalizes tags, skills, custom fields, checklist items, comments, and subtasks, then checks planner quality for single-task updates.

When validation succeeds, \`plannerUpdateFromJson\` imports the planned JSON into the scoped source task. The result can change the task title, description, tags, checklist, comments, custom fields, and the full subtask array. Existing user comments are preserved by planner instructions, while planner decisions and assumptions should be added as Planner-authored comments when they matter for execution.

After the update, the task becomes the execution plan that later appears in exported \`Task.md\` for Codex Run.

## Out of scope

The Planning category does not document Plan Pipeline creation, saved pipeline groups, pipeline dashboards, or Pipeline Runs execution history. Those screens can use the same underlying task planning concepts, but they are separate product areas and should be documented independently.`
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
