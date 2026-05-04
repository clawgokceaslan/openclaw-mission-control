import { useEffect, useState } from 'react'
import { LuBookOpen, LuDownload, LuX } from 'react-icons/lu'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { ProjectInstructionTemplate } from '@shared/types/entities'
import type { ProjectPromptTab } from '@renderer/screens/projects/detail/types'
import { PROJECT_INSTRUCTION_TABS } from '@renderer/constants/project-instructions'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { loadList } from '@renderer/utils/api'
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

const PLAN_GUIDE_EXAMPLE = `# Standard Plan Guide

Use this guide when planning or revising tasks. Read every available task field before changing the task JSON.

## Planning principles

- Start from the current task data. Preserve existing useful details.
- Make the task implementation-ready for Codex Run.
- Prefer clear, verifiable scope over broad or vague instructions.
- Refactor the entire subtasks array during planning. Treat existing subtasks, including completed/done/closed ones, as input context that can be rewritten into a clearer execution plan.
- Use extreme subtask decomposition: split every meaningful operation, file/module group, UI state, backend/data-flow change, migration, verification step, and edge-case handling area into its own subtask.
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
- Subtasks are the primary execution plan. Produce detailed subtasks even for short tasks when they clarify implementation.
- Every subtask must include a markdown description with Objective, Task context, Exact work, Files/areas, and Done when sections.
- Every subtask must include unchecked checklist items that are specific to that subtask.
- Do not write generic subtasks or checklist items such as "Test yap", "Run tests", "Fix bugs", "Implement feature", "Implement UI", or "Check everything".
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

- During planning, completed/done/closed subtasks may be rewritten as part of the full planned subtask list.
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
  const { token } = useAuth()
  const [templates, setTemplates] = useState<ProjectInstructionTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const active = PROJECT_INSTRUCTION_TABS.find((item) => item.id === tab) ?? PROJECT_INSTRUCTION_TABS[0]
  const value = tab === 'context' ? context : tab === 'prompt' ? prompt : tab === 'planGuide' ? planGuide : tab === 'output' ? output : rules
  const onChange = tab === 'context' ? onContextChange : tab === 'prompt' ? onPromptChange : tab === 'planGuide' ? onPlanGuideChange : tab === 'output' ? onOutputChange : onRulesChange
  const hasDraftContent = Boolean(context.trim() || prompt.trim() || planGuide.trim() || output.trim() || rules.trim())

  useEffect(() => {
    let cancelled = false
    const loadTemplates = async () => {
      const response = await loadList<ProjectInstructionTemplate[]>(IPC_CHANNELS.projectInstructionTemplates.list, token)
      if (cancelled || !response.ok) return
      setTemplates(Array.isArray(response.data) ? response.data : [])
    }
    void loadTemplates()
    return () => {
      cancelled = true
    }
  }, [token])

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const selectedTemplate = templates.find((item) => item.id === templateId)
    if (!selectedTemplate) return
    const template = selectedTemplate.template ?? {}
    onContextChange(template.generalContext ?? '')
    onPromptChange(template.generalPrompt ?? '')
    onPlanGuideChange(template.planGuide ?? '')
    onOutputChange(template.defaultOutput ?? '')
    onRulesChange(template.rules ?? '')
  }

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
          {PROJECT_INSTRUCTION_TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? styles.tabActive : styles.tab} onClick={() => onTabChange(item.id)}>
              {item.label}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          <section className={styles.templateApplyCard}>
            <div>
              <strong>Template</strong>
              <span>{hasDraftContent ? 'Selecting a template immediately replaces the current unsaved draft across all instruction fields. Save writes the copied text to this project.' : 'Choose a template to immediately fill every Project Instructions field together.'}</span>
            </div>
            <div className={styles.templateApplyControls}>
              <select value={selectedTemplateId} onChange={(event) => handleTemplateSelect(event.target.value)}>
                <option value="">Select project instructions template...</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.builtIn ? ' (built-in)' : ''}</option>
                ))}
              </select>
            </div>
          </section>
          <label className={styles.field}>
            <div className={styles.fieldHeader}>
              <div>
                <span>{active.title}</span>
                <small>{active.description}</small>
              </div>
              <b>No character limit</b>
            </div>
            <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={active.placeholder} />
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
