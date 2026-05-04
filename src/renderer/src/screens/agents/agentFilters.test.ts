import { describe, expect, it } from 'vitest'
import { AgentPromptFilter, AGENT_PROMPT_FILTER_OPTIONS, applyAgentFilters, isPromptMatch, isSearchMatch, parseAgentFilterState } from './agentFilters'
import type { Agent } from '@shared/types/entities'

describe('agent filter parsing', () => {
  const knownTagIds = ['tag-analytics', 'tag-research']

  it('reads valid filters and falls back for invalid values', () => {
    const parsed = parseAgentFilterState('?q=Research&tag=tag-analytics&prompt=ready', knownTagIds)

    expect(parsed).toEqual({
      search: 'Research',
      tagId: 'tag-analytics',
      promptState: 'ready'
    })

    const fallback = parseAgentFilterState('?q=abc&tag=ghost&prompt=weird', knownTagIds)

    expect(fallback).toEqual({
      search: 'abc',
      tagId: '',
      promptState: 'all'
    })
  })

  it('accepts unknown tag IDs while tag metadata is unavailable', () => {
    const parsed = parseAgentFilterState('?tag=ghost', [])

    expect(parsed.tagId).toBe('ghost')
  })
})

describe('agent filtering helpers', () => {
  const agents: Agent[] = [
    {
      id: 'a1',
      organizationId: 'org',
      name: 'Research Analyst',
      heartbeatAt: 0,
      createdAt: 1,
      updatedAt: 20,
      title: 'Research support',
      description: 'Reads dashboards and sends summaries',
      trainingMarkdown: 'Search across docs',
      tags: [{ id: 'tag-research', organizationId: 'org', name: 'Research' }]
    },
    {
      id: 'a2',
      organizationId: 'org',
      name: 'Notifier',
      heartbeatAt: 0,
      createdAt: 2,
      updatedAt: 10,
      title: 'Notification bot',
      description: 'Pings when tasks update',
      trainingMarkdown: '',
      tags: [{ id: 'tag-ops', organizationId: 'org', name: 'Ops' }]
    }
  ]

  it('matches search across name, title, description, prompt, and tag names', () => {
    const matchesTitle = applyAgentFilters(agents, {
      search: 'summaries',
      tagId: '',
      promptState: 'all'
    })

    expect(matchesTitle).toHaveLength(1)
    expect(matchesTitle[0].id).toBe('a1')

    const matchesTag = applyAgentFilters(agents, {
      search: 'ops',
      tagId: '',
      promptState: 'all'
    })

    expect(matchesTag).toHaveLength(1)
    expect(matchesTag[0].id).toBe('a2')
  })

  it('combines tag and prompt filters correctly', () => {
    const readyByTag = applyAgentFilters(agents, {
      search: '',
      tagId: 'tag-research',
      promptState: 'ready'
    })

    expect(readyByTag).toHaveLength(1)
    expect(readyByTag[0].id).toBe('a1')

    const notSetByPrompt = applyAgentFilters(agents, {
      search: '',
      tagId: '',
      promptState: 'not-set' as AgentPromptFilter
    })

    expect(notSetByPrompt).toHaveLength(1)
    expect(notSetByPrompt[0].id).toBe('a2')
  })

  it('returns all options list in prompt select config', () => {
    expect(AGENT_PROMPT_FILTER_OPTIONS.map((option) => option.value).sort()).toEqual(['all', 'not-set', 'ready'])
  })

  it('checks prompt matcher explicitly', () => {
    expect(isPromptMatch(agents[0], 'ready')).toBe(true)
    expect(isPromptMatch(agents[1], 'ready')).toBe(false)
    expect(isSearchMatch(agents[0], 'ANALYST')).toBe(true)
  })
})
