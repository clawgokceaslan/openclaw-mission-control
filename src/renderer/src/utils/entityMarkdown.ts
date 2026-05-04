import type { Agent, Skill } from '@shared/types/entities'

function markdownCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
}

export function buildSingleAgentMarkdown(agent: Agent): string {
  const tagNames = (agent.tags ?? []).map((tag) => tag.name).filter(Boolean).join(', ')
  const extraConfig = agent.config && typeof agent.config === 'object' ? { ...agent.config } : {}
  delete extraConfig.title
  delete extraConfig.description
  delete extraConfig.trainingMarkdown
  delete extraConfig.steps
  delete extraConfig.reasoningLevel
  delete extraConfig.status
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
      `| Tags | ${markdownCell(tagNames || '-')} |`
    ].join('\n')
  ]
  if (agent.trainingMarkdown?.trim()) sections.push(`## Agent Prompt\n${agent.trainingMarkdown.trim()}`)
  if (Object.keys(extraConfig).length > 0) {
    sections.push(`## Extra Config\n\`\`\`json\n${JSON.stringify(extraConfig, null, 2)}\n\`\`\``)
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
