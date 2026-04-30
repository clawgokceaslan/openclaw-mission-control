import { useMemo, useState } from 'react'
import { LuBot, LuPlus, LuSearch, LuSparkles, LuTrash2, LuX } from 'react-icons/lu'
import type { Agent, Skill } from '@shared/types/entities'
import styles from '../ProjectDetailPage.module.scss'

type MaybePromise = void | Promise<void>

interface AgentAssignmentPanelProps {
  agent: Agent | null
  agents: Agent[]
  ctaDescription: string
  onChange: (agentId: string | null) => MaybePromise
}

interface SkillsAssignmentPanelProps {
  selectedSkills: Skill[]
  skills: Skill[]
  source: string
  ctaDescription: string
  onChange: (skillIds: string[]) => MaybePromise
}

function markdownSnippet(markdown?: string): string {
  const normalized = (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\-[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || 'No description.'
}

function formatTimestamp(value?: number): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function formatReasoning(value?: Agent['reasoningLevel']): string {
  if (!value) return 'Not set'
  return value.replace(/_/g, ' ')
}

export function AgentAssignmentPanel({ agent, agents, ctaDescription, onChange }: AgentAssignmentPanelProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [savingAgentId, setSavingAgentId] = useState<string | null>(null)

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('tr')
    return [...agents]
      .filter((item) => {
        if (!normalizedQuery) return true
        return [item.name, item.title, item.status, item.reasoningLevel]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('tr').includes(normalizedQuery))
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [agents, query])

  const selectAgent = async (agentId: string | null) => {
    setSavingAgentId(agentId ?? 'clear')
    try {
      await onChange(agentId)
      setIsPickerOpen(false)
      setQuery('')
    } finally {
      setSavingAgentId(null)
    }
  }

  return (
    <div className={styles.assignmentPanel}>
      <div className={styles.tabCtaCard}>
        <div>
          <strong>{agent ? 'Change agent' : 'Assign agent'}</strong>
          <span>{ctaDescription}</span>
        </div>
        <button type="button" className={styles.tabActionButton} onClick={() => setIsPickerOpen(true)}>
          <LuBot size={15} />
          {agent ? 'Change agent' : 'Select agent'}
        </button>
      </div>

      <div className={styles.assignmentTableWrap}>
        <table className={styles.assignmentTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Title</th>
              <th>Reasoning</th>
              <th>Steps</th>
              <th>Last heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {agent ? (
              <tr>
                <td>
                  <span className={styles.assignmentPrimary}>{agent.name}</span>
                  <span className={styles.assignmentSecondary}>{markdownSnippet(agent.trainingMarkdown)}</span>
                </td>
                <td><span className={styles.assignmentBadge}>{agent.status}</span></td>
                <td>{agent.title || 'Not set'}</td>
                <td>{formatReasoning(agent.reasoningLevel)}</td>
                <td>{agent.steps?.length ?? 0}</td>
                <td>{formatTimestamp(agent.heartbeatAt)}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan={6} className={styles.assignmentEmptyCell}>Unassigned</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isPickerOpen ? (
        <div className={styles.assignmentModalBackdrop} role="presentation">
          <section className={styles.assignmentModal} role="dialog" aria-modal="true" aria-label="Select agent">
            <header>
              <div>
                <h4>Select agent</h4>
                <p>{agent ? `Current: ${agent.name}` : 'No agent assigned'}</p>
              </div>
              <button type="button" onClick={() => setIsPickerOpen(false)} aria-label="Close agent picker"><LuX size={17} /></button>
            </header>
            <div className={styles.assignmentSearch}>
              <LuSearch size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents..." autoFocus />
            </div>
            <div className={styles.assignmentPickerTableWrap}>
              <table className={styles.assignmentTable}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Title</th>
                    <th>Reasoning</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.length > 0 ? filteredAgents.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className={styles.assignmentPrimary}>{item.name}</span>
                        <span className={styles.assignmentSecondary}>{markdownSnippet(item.trainingMarkdown)}</span>
                      </td>
                      <td><span className={styles.assignmentBadge}>{item.status}</span></td>
                      <td>{item.title || 'Not set'}</td>
                      <td>{formatReasoning(item.reasoningLevel)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.assignmentTableAction}
                          disabled={savingAgentId !== null || item.id === agent?.id}
                          onClick={() => void selectAgent(item.id)}
                        >
                          {item.id === agent?.id ? 'Selected' : 'Select'}
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={5} className={styles.assignmentEmptyCell}>No agents found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer>
              <button type="button" onClick={() => setIsPickerOpen(false)}>Cancel</button>
              <button type="button" disabled={savingAgentId !== null || !agent} onClick={() => void selectAgent(null)}>Clear agent</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export function SkillsAssignmentPanel({ selectedSkills, skills, source, ctaDescription, onChange }: SkillsAssignmentPanelProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draftSkillIds, setDraftSkillIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const selectedSkillIds = useMemo(() => new Set(selectedSkills.map((skill) => skill.id)), [selectedSkills])
  const selectedRows = useMemo(() => [...selectedSkills].sort((a, b) => a.name.localeCompare(b.name, 'tr')), [selectedSkills])

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('tr')
    return [...skills]
      .filter((skill) => skill.status === 'active' || skill.enabled || selectedSkillIds.has(skill.id))
      .filter((skill) => {
        if (!normalizedQuery) return true
        return [skill.name, skill.status, skill.category, skill.descriptionMarkdown]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('tr').includes(normalizedQuery))
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [query, selectedSkillIds, skills])

  const toggleDraftSkill = (skillId: string) => {
    setDraftSkillIds((current) => current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId])
  }

  const saveDraftSkills = async () => {
    if (draftSkillIds.length === 0) return
    setIsSaving(true)
    try {
      await onChange([...selectedSkillIds, ...draftSkillIds])
      setDraftSkillIds([])
      setQuery('')
      setIsPickerOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  const removeSkill = async (skillId: string) => {
    await onChange(selectedRows.filter((skill) => skill.id !== skillId).map((skill) => skill.id))
  }

  return (
    <div className={styles.assignmentPanel}>
      <div className={styles.tabCtaCard}>
        <div>
          <strong>Attach skills</strong>
          <span>{ctaDescription}</span>
        </div>
        <button
          type="button"
          className={styles.tabActionButton}
          onClick={() => {
            setDraftSkillIds([])
            setQuery('')
            setIsPickerOpen(true)
          }}
        >
          <LuPlus size={15} />
          Add skills
        </button>
      </div>

      <div className={styles.assignmentTableWrap}>
        <table className={styles.assignmentTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Description</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {selectedRows.length > 0 ? selectedRows.map((skill) => (
              <tr key={skill.id}>
                <td>
                  <span className={styles.assignmentPrimary}>{skill.name}</span>
                  <span className={styles.assignmentSecondary}>{skill.category || skill.slug}</span>
                </td>
                <td><span className={styles.assignmentBadge}>{skill.status}</span></td>
                <td>{markdownSnippet(skill.descriptionMarkdown)}</td>
                <td>{source}</td>
                <td>
                  <button type="button" className={`${styles.assignmentTableAction} ${styles.assignmentDangerAction}`} onClick={() => void removeSkill(skill.id)}>
                    <LuTrash2 size={14} />
                    Remove
                  </button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className={styles.assignmentEmptyCell}>No skills assigned yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isPickerOpen ? (
        <div className={styles.assignmentModalBackdrop} role="presentation">
          <section className={styles.assignmentModal} role="dialog" aria-modal="true" aria-label="Add skills">
            <header>
              <div>
                <h4>Add skills</h4>
                <p>{draftSkillIds.length} selected</p>
              </div>
              <button type="button" onClick={() => setIsPickerOpen(false)} aria-label="Close skills picker"><LuX size={17} /></button>
            </header>
            <div className={styles.assignmentSearch}>
              <LuSearch size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills..." autoFocus />
            </div>
            <div className={styles.assignmentPickerTableWrap}>
              <table className={styles.assignmentTable}>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Status</th>
                    <th>Description</th>
                    <th>Pick</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSkills.length > 0 ? filteredSkills.map((skill) => {
                    const alreadySelected = selectedSkillIds.has(skill.id)
                    const checked = alreadySelected || draftSkillIds.includes(skill.id)
                    return (
                      <tr key={skill.id}>
                        <td>
                          <span className={styles.assignmentPrimary}>{skill.name}</span>
                          <span className={styles.assignmentSecondary}>{skill.category || skill.slug}</span>
                        </td>
                        <td><span className={styles.assignmentBadge}>{skill.status}</span></td>
                        <td>{markdownSnippet(skill.descriptionMarkdown)}</td>
                        <td>
                          <label className={styles.assignmentCheckbox}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={alreadySelected}
                              onChange={() => toggleDraftSkill(skill.id)}
                            />
                            {alreadySelected ? 'Added' : 'Add'}
                          </label>
                        </td>
                      </tr>
                    )
                  }) : (
                    <tr>
                      <td colSpan={4} className={styles.assignmentEmptyCell}>No skills found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer>
              <button type="button" onClick={() => setIsPickerOpen(false)}>Cancel</button>
              <button type="button" disabled={isSaving || draftSkillIds.length === 0} onClick={() => void saveDraftSkills()}>
                <LuSparkles size={15} />
                Save skills
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
