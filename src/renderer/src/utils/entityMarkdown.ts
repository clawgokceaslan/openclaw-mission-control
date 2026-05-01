import type { Agent, Skill } from '@shared/types/entities'

function markdownCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
}

export function buildSingleAgentMarkdown(agent: Agent): string {
  const sections = [
    `# ${agent.name}`,
    [
      '## Agent Details',
      '| Field | Value |',
      '| --- | --- |',
      `| ID | ${markdownCell(agent.id)} |`,
      `| Name | ${markdownCell(agent.name)} |`,
      `| Title | ${markdownCell(agent.title || '-')} |`,
      `| Description | ${markdownCell(agent.description || '-')} |`,
      `| Status | ${markdownCell(agent.status)} |`,
      `| Reasoning level | ${markdownCell(agent.reasoningLevel ?? 'medium')} |`
    ].join('\n')
  ]
  if (agent.trainingMarkdown?.trim()) sections.push(`## Agent Prompt\n${agent.trainingMarkdown.trim()}`)
  const steps = [...(agent.steps ?? [])]
    .filter((step) => step.title?.trim() || step.description?.trim() || step.prompt?.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder)
  if (steps.length) {
    sections.push([
      '## Steps',
      ...steps.map((step, index) => [
        `### Step ${index + 1}: ${step.title || 'Untitled step'}`,
        step.description?.trim() ? step.description.trim() : '',
        step.prompt?.trim() ? `#### Prompt\n${step.prompt.trim()}` : ''
      ].filter(Boolean).join('\n\n'))
    ].join('\n\n'))
  }
  return `${sections.join('\n\n')}\n`
}

export function buildSingleSkillMarkdown(skill: Skill): string {
  const sections = [
    `# ${skill.name}`,
    [
      '## Skill Metadata',
      `- ID: ${skill.id}`,
      `- Name: ${skill.name}`,
      `- Slug: ${skill.slug}`,
      `- Category: ${skill.category}`,
      `- Version: ${skill.version}`,
      `- Status: ${skill.status}`,
      `- Enabled: ${skill.enabled ? 'yes' : 'no'}`,
      `- Updated: ${skill.updatedAt ? new Date(skill.updatedAt).toLocaleString() : '-'}`
    ].join('\n')
  ]
  if (skill.descriptionMarkdown?.trim()) sections.push(`## Instructions\n${skill.descriptionMarkdown.trim()}`)
  return `${sections.join('\n\n')}\n`
}
