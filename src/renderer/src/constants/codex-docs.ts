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
    id: 'claude-cli-gateway',
    title: 'Claude CLI Gateway',
    category: 'Gateway',
    summary: 'Claude CLI kurulumu, auth, model seçimi, izinler ve OMC içindeki plan/run akışı.',
    sourceFiles: [
      'src/main/services/task.service.ts',
      'src/main/services/gateway/gateway.service.ts',
      'src/main/utils/codex-cli-resolver.ts',
      'src/renderer/src/screens/gateways/*'
    ],
    terms: [
      { term: 'Claude CLI', description: 'Anthropic Claude Code komut satırı aracı; OMC headless çalıştırmada claude -p kullanır.' },
      { term: 'Print mode', description: 'claude -p ile non-interactive çalışma ve stream-json çıktı üretimi.' },
      { term: 'ANTHROPIC_API_KEY', description: 'Claude CLI için varsayılan API anahtarı environment değişkeni.' }
    ],
    markdown: `# Claude CLI Gateway

Open Mission Control, Claude CLI'ı Codex gateway akışıyla aynı lifecycle'a bağlar: proje ayarlarında gateway seçilir, plan/run modeli belirlenir, task export dosyaları geçici workspace'e yazılır ve çıktı task chat'e stream edilir.

## Kurulum

\`\`\`bash
claude --version
claude auth status
claude auth login
\`\`\`

Headless çalıştırma için \`ANTHROPIC_API_KEY\` ortam değişkeni de kullanılabilir. Project veya task export dosyalarına API anahtarı yazılmaz; OMC sadece process environment üzerinden CLI'a aktarır.

## OMC ayarı

1. Settings > Gateways ekranında Add gateway seçin.
2. Provider alanında Claude CLI seçin.
3. Execution mode için Exec / Headless seçerseniz OMC \`claude -p --output-format stream-json\` çalıştırır.
4. Terminal mode seçerseniz macOS Terminal.app içinde Claude CLI açılır.
5. Project settings > Models bölümünde bu gateway'i ve plan/run modellerini seçin.

Varsayılan model seçenekleri \`sonnet\` ve \`opus\` olarak eklenir. Claude CLI tam model id kabul ediyorsa proje veya task model alanına tam id yazılabilir.

## İzinler ve MCP

Claude CLI dokümantasyonundaki \`--permission-mode\`, \`--tools\`, \`--allowedTools\` ve MCP ayarları CLI tarafında desteklenir. OMC bu MVP'de Claude'u mevcut gateway çalışma modu ile başlatır, task context içinde Agent Tools girdilerini katalog bilgisi olarak tutar ve MCP/tool çalıştırma politikasını Codex akışındaki gibi task talimatına yazar. Sırlar ve API key değerleri export edilen Task.md, Agents.md, Skills.md veya Tools.md dosyalarına yazılmaz.

## Bilinen sınırlamalar

- Claude CLI model kataloğu için Codex'teki \`debug models\` eşdeğeri yoktur; OMC temel \`sonnet\` ve \`opus\` seçeneklerini cache'ler.
- Headless stream Claude'un \`stream-json\` formatından normalize edilir; farklı CLI sürümleri ek event tipleri döndürürse raw log olarak gösterilebilir.
- Terminal mode macOS Terminal.app gerektirir.
- MCP upstream yürütmesi OMC onay köprüsü tamamlanana kadar policy-gated katalog bağlamı olarak aktarılır.`
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
      { term: 'Plan guide', description: 'Project-level instructions that shape how future planning updates task descriptions, subtasks, checklist items, comments, and verification notes.' },
      { term: 'Planner questions', description: 'Clarification prompts that wait globally until the user answers them or opens the related task chat.' },
      { term: 'Plan-ready task', description: 'A task whose planning phase has completed and can appear in the header menu for execution or missing-setting repair.' }
    ],
    markdown: `# Task Planning Features

Planning is the preparation layer for task execution in Open Mission Control. It helps users turn rough tasks into implementation-ready work by clarifying scope, shaping subtasks, recording verification notes, and surfacing the task as ready to run.

This document covers user-facing planning features in project and task workflows. Plan Pipeline and Pipeline Runs are separate automation surfaces and are intentionally outside this scope.

## Task lifecycle panel

Each task detail view includes a lifecycle panel with four stages:

- Planla: shows whether the task still needs planning, is currently being planned, has a ready plan, or needs attention.
- Çalıştır: becomes available after a plan is ready, or when run history already exists.
- Doğrula: summarizes post-run verification state after execution.
- Tamamla: guides the user to close the task only after the result and verification notes are checked.

The planning stage can show states such as Plan bekliyor, Planlanıyor, Plan hazır, Onay bekliyor, Duraklatıldı, Kontrol gerekiyor, Bloke, or Müdahale gerekiyor. The same panel provides Planla, Yeniden dene, or Duraklat actions depending on the current state.

## Plan action

Users can start planning from the task detail primary action or from the task chat planning action. Planning is disabled until the task can resolve a gateway and plan model from project settings or task-level overrides.

When a plan is started, the app asks whether the planner should first ask clarification questions or proceed directly from the available task context. Clarification-first planning is useful when product decisions, scope boundaries, or verification expectations are not obvious. Direct planning is useful when the existing task data is already enough.

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
- capture verification expectations in subtasks, checklist, or comments;
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
  },
  {
    id: 'agents-skills-tools-gateway-guide',
    title: 'Agents, Skills, Tools and Gateway Guide',
    category: 'Capabilities',
    summary: 'OpenAI-aligned mental model and Open Mission Control architecture for agents, skills, tools, and gateway execution.',
    sourceFiles: [
      'src/shared/types/entities.ts',
      'src/main/services/agent.service.ts',
      'src/main/services/skill.service.ts',
      'src/main/services/tool.service.ts',
      'src/main/services/gateway/*',
      'src/renderer/src/screens/tools/ToolsPage.tsx'
    ],
    terms: [
      { term: 'Agent', description: 'A model-facing operating profile: name, instructions, tags, attached skills, attached tools, and future orchestration policy.' },
      { term: 'Tool', description: 'A callable capability definition. In OMC v1 tools are catalog records only and are not executed.' },
      { term: 'Skill', description: 'A reusable instruction/workflow bundle concept aligned with SKILL.md-style guidance.' },
      { term: 'Gateway', description: 'The runtime bridge that launches Codex CLI or connects to OpenClaw RPC capabilities.' }
    ],
    markdown: `# Agents, Skills, Tools and Gateway Guide

This guide defines how Open Mission Control models AI capabilities.

## Mental model

- Agent: the orchestration profile. It tells the AI who is responsible for a task, what behavior to follow, and which catalog capabilities are relevant.
- Tool: a callable capability surface. A tool has a name, description, schema, function/code detail, command preparation, and execution flow.
- Skill: reusable instructions, conventions, scripts, references, and assets. Skills teach a workflow; tools perform actions.
- Gateway: the runtime bridge. Codex CLI execution and OpenClaw RPC live here, not in the catalog editor.

## Current OMC architecture

Agents, Skills, and Tools are first-class capability records. Tasks can resolve an effective agent and export supporting files into the Codex runtime workspace.

In this phase, Tools are exported as \`Tools.md\` catalog context only. The runtime prompt explicitly says that listed commands must not be executed as tool invocations. This preserves safety while making the future execution contract visible.

## Tool schema guidance

Good tool definitions include:

- a short action-oriented name;
- a usage description that says when the AI should consider the tool;
- strict input and output JSON object schemas when the tool has structured data;
- a function name when the implementation is function-shaped;
- code or command snippets only as implementation reference;
- a clear execution flow with expected validation, approval, and result parsing.

Avoid vague descriptions such as "does project stuff." Prefer concrete capability boundaries such as "List changed files in the runtime workspace and return relative paths plus status labels."

## Local command model

Local command is the chosen future runtime shape. A local command tool can store:

- prepare command;
- command template;
- working directory hint;
- timeout;
- approval requirement;
- input/output schemas;
- execution flow notes.

OMC v1 does not execute these commands. A future phase should add explicit approval, command allow/deny policy, timeout enforcement, audit logs, stdout/stderr capture, and deterministic tool result records before any agent can invoke a local command.

## Gateway relationship

Codex CLI task execution already launches through Gateway configuration. OpenClaw method catalog already includes \`tools.catalog\`, \`tools.effective\`, and \`tools.invoke\` concepts. OMC Tools should remain provider-neutral so a future adapter can map catalog definitions to either local command execution or OpenClaw RPC invocation.

## Safety rules

- Skills are user-priority instructions, not security policy.
- Tool definitions are not permission grants.
- Write-capable or shell-capable tools must require explicit approval.
- Tool outputs should be logged and tied to task/run/conversation ids.
- Third-party MCP or remote tools need scoped credentials and prompt-injection review.

## Roadmap

1. Catalog phase: define and attach tools to agents.
2. Export phase: include \`Tools.md\` with task runtime context.
3. Approval phase: add command preview and approval records.
4. Execution phase: run local commands through a sandboxed service.
5. Invocation phase: allow agent loops to request approved tools and feed structured outputs back into the conversation.`
  }
]

export const CODEX_DOC_CATEGORIES = [...new Set(CODEX_DOCS.map((doc) => doc.category))]
