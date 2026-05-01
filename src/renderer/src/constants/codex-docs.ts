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
