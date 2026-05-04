import type { ProjectPromptTab } from '@renderer/screens/projects/detail/types'

export const PROJECT_INSTRUCTION_TABS: Array<{
  id: ProjectPromptTab
  label: string
  title: string
  description: string
  placeholder: string
}> = [
  { id: 'context', label: 'Context', title: 'General context', description: 'Shared background and project facts that every task should know.', placeholder: 'Add common project context...' },
  { id: 'prompt', label: 'Prompt', title: 'General prompt', description: 'Shared behavior instructions for planning, running, and follow-up chat.', placeholder: 'Set shared instructions for this project...' },
  { id: 'planGuide', label: 'Plan guide', title: 'Plan guide', description: 'Instructions used specifically when Codex plans or revises a task.', placeholder: 'Tell Codex how to plan tasks in this project...' },
  { id: 'output', label: 'Output', title: 'Default output', description: 'Default response or deliverable format expected from agents.', placeholder: 'Set default output format...' },
  { id: 'rules', label: 'Rules', title: 'Project rules', description: 'Hard rules that Codex must apply in Task.md, planning, run, and chat flows.', placeholder: 'Add project-specific rules, one per line...' }
]
