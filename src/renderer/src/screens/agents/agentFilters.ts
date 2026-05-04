import { Agent } from '@shared/types/entities'

export const AGENT_SEARCH_QUERY_KEY = 'q'
export const AGENT_TAG_FILTER_KEY = 'tag'
export const AGENT_PROMPT_FILTER_KEY = 'prompt'

export type AgentPromptFilter = 'all' | 'ready' | 'not-set'

export type AgentFilterState = {
  search: string
  tagId: string
  promptState: AgentPromptFilter
}

export const AGENT_PROMPT_FILTER_OPTIONS = [
  { label: 'All prompt states', value: 'all' as const },
  { label: 'Ready', value: 'ready' as const },
  { label: 'Not set', value: 'not-set' as const }
] as const

function normalizeText(value: string | undefined): string {
  return (value ?? '').toLocaleLowerCase()
}

function normalizeQueryText(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export function normalizeAgentPromptFilter(value: string | null | undefined): AgentPromptFilter {
  if (value === 'ready' || value === 'not-set') return value
  return 'all'
}

export function normalizeAgentTagFilter(rawTagId: string | null | undefined, knownTagIds: string[] = []): string {
  const tagId = normalizeQueryText(rawTagId)
  if (!tagId) return ''
  if (knownTagIds.length === 0) return tagId
  return knownTagIds.includes(tagId) ? tagId : ''
}

export function parseAgentFilterState(search: string, knownTagIds: string[] = []): AgentFilterState {
  const searchParams = new URLSearchParams(search)
  const rawTagId = searchParams.get(AGENT_TAG_FILTER_KEY)
  return {
    search: normalizeQueryText(searchParams.get(AGENT_SEARCH_QUERY_KEY)),
    tagId: normalizeAgentTagFilter(rawTagId, knownTagIds),
    promptState: normalizeAgentPromptFilter(searchParams.get(AGENT_PROMPT_FILTER_KEY))
  }
}

function agentSearchTarget(agent: Agent): string {
  const tagNames = (agent.tags ?? []).map((tag) => tag.name)
  return [
    agent.name,
    agent.title,
    agent.description,
    agent.trainingMarkdown,
    ...tagNames
  ].map(normalizeText).join('\n')
}

export function isSearchMatch(agent: Agent, search: string): boolean {
  const normalizedSearch = normalizeText(search)
  if (!normalizedSearch) return true
  return agentSearchTarget(agent).includes(normalizedSearch)
}

export function isPromptMatch(agent: Agent, promptState: AgentPromptFilter): boolean {
  if (promptState === 'all') return true
  const hasPrompt = normalizeText(agent.trainingMarkdown).trim().length > 0
  return promptState === 'ready' ? hasPrompt : !hasPrompt
}

export function isTagMatch(agent: Agent, tagId: string): boolean {
  if (!tagId) return true
  const normalizedTagId = normalizeText(tagId)
  return (agent.tags ?? []).some((tag) => normalizeText(tag.id) === normalizedTagId || normalizeText(tag.name) === normalizedTagId)
}

export function applyAgentFilters(agents: Agent[], state: AgentFilterState): Agent[] {
  const search = state.search
  return [...agents]
    .filter((agent) => isSearchMatch(agent, search) && isPromptMatch(agent, state.promptState) && isTagMatch(agent, state.tagId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
