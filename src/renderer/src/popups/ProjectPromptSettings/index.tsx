import { LuBookOpen, LuDownload, LuX } from 'react-icons/lu'
import type { ProjectPromptTab } from '@renderer/screens/projects/detail/types'
import styles from './index.module.scss'

interface ProjectPromptSettingsPopupProps {
  tab: ProjectPromptTab
  context: string
  prompt: string
  planGuide: string
  output: string
  rules: string
  error?: string | null
  saving: boolean
  onTabChange: (tab: ProjectPromptTab) => void
  onContextChange: (value: string) => void
  onPromptChange: (value: string) => void
  onPlanGuideChange: (value: string) => void
  onOutputChange: (value: string) => void
  onRulesChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}

const TAB_CONFIG: Array<{ id: ProjectPromptTab; label: string; title: string; description: string; placeholder: string; max: number }> = [
  { id: 'context', label: 'Context', title: 'General context', description: 'Shared background and project facts that every task should know.', placeholder: 'Add common project context...', max: 4000 },
  { id: 'prompt', label: 'Prompt', title: 'General prompt', description: 'Shared behavior instructions for planning, running, and follow-up chat.', placeholder: 'Set shared instructions for this project...', max: 4000 },
  { id: 'planGuide', label: 'Plan guide', title: 'Plan guide', description: 'Instructions used specifically when Codex plans or revises a task.', placeholder: 'Tell Codex how to plan tasks in this project...', max: 4000 },
  { id: 'output', label: 'Output', title: 'Default output', description: 'Default response or deliverable format expected from agents.', placeholder: 'Set default output format...', max: 3000 },
  { id: 'rules', label: 'Rules', title: 'Project rules', description: 'Hard rules that Codex must apply in Task.md, planning, run, and chat flows.', placeholder: 'Add project-specific rules, one per line...', max: 4000 }
]

const PLAN_GUIDE_EXAMPLE = `# Standard Plan Guide

Use this guide when planning or revising tasks. Read every available task field before changing the task JSON.

## Planning principles

- Start from the current task data. Preserve existing useful details.
- Make the task implementation-ready for Codex Run.
- Prefer clear, verifiable scope over broad or vague instructions.
- Keep subtasks ordered by execution dependency.
- Fill Acceptance Criteria when it is missing or incomplete.
- Do not remove user-provided constraints from the description or comments.

## Task fields to inspect

### Identity

- title
- status
- project
- project group
- tags

### Core task content

- description
- acceptanceCriteria
- checklist
- comments
- customFields
- attachments

### Assignment and capability context

- assigned agent
- selected skills
- agent instructions
- skill instructions

### Model and execution context

- task gateway override
- task plan model override
- task run model override
- project Codex gateway
- project plan model
- project run model

### Subtasks

For every subtask, inspect:

- title
- description
- status
- tags
- checklist
- comments
- customFields
- dueAt, if present

## Output expectations

When producing planned task JSON:

- Update title only if it improves clarity.
- Update description with concise implementation context.
- Set agenticInputs.acceptanceCriteria with measurable completion checks.
- Add or revise checklist items for concrete verification steps.
- Add subtasks only when they reduce ambiguity or split independent work.
- Keep tags as names or ids.
- Keep customFields as { name, value } entries.

## Acceptance criteria style

Write acceptance criteria as a short checklist:

- User-visible behavior is described.
- Edge cases are covered.
- Data/state persistence is mentioned when relevant.
- UI states are covered when relevant.
- Validation/build/test expectations are explicit when relevant.

## Status handling

- Keep completed/done/closed subtasks untouched unless the user explicitly asks.
- Prefer active/in-progress status only when the task is ready for execution.
- Do not mark the task complete during planning.
`

function downloadPlanGuideExample() {
  const blob = new Blob([PLAN_GUIDE_EXAMPLE], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'standard-plan-guide.md'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function ProjectPromptSettingsPopup({
  tab,
  context,
  prompt,
  planGuide,
  output,
  rules,
  error,
  saving,
  onTabChange,
  onContextChange,
  onPromptChange,
  onPlanGuideChange,
  onOutputChange,
  onRulesChange,
  onClose,
  onSave
}: ProjectPromptSettingsPopupProps) {
  const active = TAB_CONFIG.find((item) => item.id === tab) ?? TAB_CONFIG[0]
  const value = tab === 'context' ? context : tab === 'prompt' ? prompt : tab === 'planGuide' ? planGuide : tab === 'output' ? output : rules
  const onChange = tab === 'context' ? onContextChange : tab === 'prompt' ? onPromptChange : tab === 'planGuide' ? onPlanGuideChange : tab === 'output' ? onOutputChange : onRulesChange

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <section className={styles.shell} role="dialog" aria-modal="true" aria-label="Project instructions">
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.icon}><LuBookOpen size={18} /></span>
            <div>
              <h2>Project instructions</h2>
              <p>Define shared context, planning guidance, prompts, output expectations, and rules for every Codex flow in this project.</p>
            </div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close project instructions"><LuX size={18} /></button>
        </header>

        <div className={styles.tabRow} role="tablist" aria-label="Project instruction tabs">
          {TAB_CONFIG.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? styles.tabActive : styles.tab} onClick={() => onTabChange(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <div className={styles.fieldHeader}>
              <div>
                <span>{active.title}</span>
                <small>{active.description}</small>
              </div>
              <b>{value.length}/{active.max}</b>
            </div>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={active.placeholder} maxLength={active.max} />
          </label>
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>

        <footer className={styles.footer}>
          <div className={styles.footerHint}>
            <strong>{active.label}</strong>
            <span>{tab === 'planGuide' ? 'Download the example, adapt it, then paste the parts that should guide planning.' : 'Changes apply to future planning, run, and chat context after saving.'}</span>
          </div>
          <div className={styles.footerActions}>
            {tab === 'planGuide' ? (
              <button type="button" className={styles.secondaryAction} onClick={downloadPlanGuideExample} disabled={saving}>
                <LuDownload size={15} />
                Example MD
              </button>
            ) : null}
            <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </footer>
      </section>
    </>
  )
}
