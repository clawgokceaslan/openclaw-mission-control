import { useState } from 'react'
import type { ReactNode } from 'react'
import { LuCheck, LuClipboard, LuFileText, LuPlay, LuTerminal } from 'react-icons/lu'
import styles from './SettingsPage.module.scss'

const executionFlow = [
  'Open Mission Control exports Task.md, optional Agents.md, optional Skills.md, and attachments into a temporary export workspace.',
  'The selected project runtime workspace is opened as Codex working directory.',
  'Open Mission Control creates .omc/runs/<run-id>/ inside the runtime workspace.',
  'The run folder contains session.json, omc-task-client.mjs, and OMC_CLI.md.',
  'Codex receives a prompt that points to Task.md and OMC_CLI.md.',
  'Codex completes the implementation in the runtime workspace.',
  'Codex runs the local .omc CLI ready-for-review command when the task should move to review.'
]

const planningFlow = [
  'Open Mission Control creates .omc/runs/<run-id>/ in the project runtime workspace.',
  'Codex reads OMC_CLI.md before planning.',
  'Codex runs context to fetch the source task, project rules, allowed statuses, tags, skills, and custom fields.',
  'Codex writes planned-task.json into the run folder.',
  'Codex validates planned-task.json through the local CLI.',
  'Codex updates the scoped source task from the validated JSON.',
  'Codex runs finish so the temporary bridge and run folder can close.'
]

const operations = [
  { name: 'context', command: 'node .omc/runs/<run-id>/omc-task-client.mjs context', description: 'Prints scoped project, task, allowed values, export paths, and JSON format guidance.' },
  { name: 'validate', command: 'node .omc/runs/<run-id>/omc-task-client.mjs validate .omc/runs/<run-id>/planned-task.json', description: 'Validates and normalizes task JSON without writing changes.' },
  { name: 'create', command: 'node .omc/runs/<run-id>/omc-task-client.mjs create .omc/runs/<run-id>/planned-task.json', description: 'Creates a new task in the scoped project from task JSON.' },
  { name: 'update', command: 'node .omc/runs/<run-id>/omc-task-client.mjs update .omc/runs/<run-id>/planned-task.json', description: 'Updates the scoped source task from task JSON.' },
  { name: 'ready-for-review', command: 'node .omc/runs/<run-id>/omc-task-client.mjs ready-for-review', description: 'Moves the task and subtasks to Review, or the nearest pre-Done status.' },
  { name: 'finish', command: 'node .omc/runs/<run-id>/omc-task-client.mjs finish', description: 'Signals completion and lets Open Mission Control clean up the run folder.' }
]

const mdExample = `# Open Mission Control CLI

Use this local helper. Do not use MCP.

1. Read this file before changing project files.
2. Run context to load the scoped Open Mission Control task data.
3. Use validate before create or update.
4. For implementation runs, call ready-for-review only after the code work and checks are complete.
5. For planning runs, call finish after update succeeds.
`

export function SettingsPage() {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(key)
    window.setTimeout(() => setCopied((current) => current === key ? null : current), 1600)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Settings</h1>
          <p>CLI settings for Codex runs launched by Open Mission Control.</p>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon}><LuTerminal size={19} /></span>
          <div>
            <h2>.omc runtime CLI</h2>
            <p>Every Codex planning and execution run receives a local helper in the runtime workspace.</p>
          </div>
        </div>
        <div className={styles.infoGrid}>
          <span>
            <small>Run root</small>
            <strong>.omc/runs/&lt;run-id&gt;/</strong>
          </span>
          <span>
            <small>Instruction file</small>
            <strong>.omc/runs/&lt;run-id&gt;/OMC_CLI.md</strong>
          </span>
          <span>
            <small>Helper script</small>
            <strong>.omc/runs/&lt;run-id&gt;/omc-task-client.mjs</strong>
          </span>
        </div>
      </section>

      <div className={styles.clientGrid}>
        <FlowPanel icon={<LuPlay size={19} />} title="Execution flow" items={executionFlow} />
        <FlowPanel icon={<LuFileText size={19} />} title="Planning flow" items={planningFlow} />
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon}><LuTerminal size={19} /></span>
          <div>
            <h2>OMC operations</h2>
            <p>Commands available inside each runtime workspace run folder.</p>
          </div>
        </div>
        <div className={styles.operationList}>
          {operations.map((operation) => (
            <article key={operation.name}>
              <div>
                <code>{operation.name}</code>
                <p>{operation.description}</p>
              </div>
              <CodeBlock
                title="command"
                value={operation.command}
                copied={copied === operation.name}
                onCopy={() => copy(operation.name, operation.command)}
              />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelIcon}><LuFileText size={19} /></span>
          <div>
            <h2>Instruction file shape</h2>
            <p>Open Mission Control writes run-specific paths and exact commands into this Markdown file.</p>
          </div>
        </div>
        <CodeBlock
          title="OMC_CLI.md"
          value={mdExample}
          copied={copied === 'md-example'}
          onCopy={() => copy('md-example', mdExample)}
        />
      </section>
    </section>
  )
}

function FlowPanel({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelIcon}>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>Run sequence used by Codex through Open Mission Control.</p>
        </div>
      </div>
      <ol className={styles.flowList}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </section>
  )
}

function CodeBlock({ title, value, copied, onCopy }: { title: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className={styles.codeBlock}>
      <div>
        <span>{title}</span>
        <button type="button" onClick={onCopy} disabled={!value}>
          {copied ? <LuCheck size={14} /> : <LuClipboard size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  )
}
