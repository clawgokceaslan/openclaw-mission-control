import { describe, expect, it } from 'vitest'
import type { TaskEntity } from '@shared/types/entities'
import type { TaskActivityMessage } from '../types'
import {
  appendActivityMessageToTasks,
  buildChatConversationSummaries,
  buildGeneratedContextEntries,
  buildLatestGeneratedFollowUpContext,
  codexChangesSummary,
  buildLatestRunFollowUpContext,
  formatCodexWorkDuration,
  formatPlannerClarificationAnswer,
  groupCodexTranscriptMessages,
  hasNoChangesMessage,
  plannerQuestionPromptFromMessages,
  preserveScrollTopAfterPrepend,
  shouldLoadEarlierMessages,
  thinkingDurationLabel,
  userMessageCount,
  visibleChatMessagesForLimit
} from './chatUtils'

function message(overrides: Partial<TaskActivityMessage>): TaskActivityMessage {
  return {
    id: overrides.id ?? `message-${overrides.createdAt ?? 1}`,
    runId: overrides.runId ?? 'conversation-1',
    conversationId: overrides.conversationId ?? overrides.runId ?? 'conversation-1',
    source: overrides.source ?? 'codex-chat',
    role: overrides.role ?? 'assistant',
    status: overrides.status,
    body: overrides.body ?? 'body',
    metadata: overrides.metadata,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt
  }
}

describe('chat conversation summaries', () => {
  it('counts only user-sent messages', () => {
    const messages = [
      message({ id: 'user-1', role: 'user', createdAt: 1 }),
      message({ id: 'thinking-1', role: 'thinking', status: 'running', createdAt: 2 }),
      message({ id: 'tool-1', role: 'tool', status: 'completed', createdAt: 3 }),
      message({ id: 'system-1', role: 'system', status: 'completed', createdAt: 4 }),
      message({ id: 'user-2', role: 'user', createdAt: 5 })
    ]

    expect(userMessageCount(messages)).toBe(2)
    expect(buildChatConversationSummaries(messages, 10)[0].count).toBe(2)
  })

  it('uses appended terminal activity to resolve stale conversations', () => {
    const now = 30 * 60 * 1000
    const summaries = buildChatConversationSummaries([
      message({ id: 'stopped-running', runId: 'stopped', conversationId: 'stopped', role: 'thinking', status: 'running', createdAt: 1 }),
      message({ id: 'stopped-terminal', runId: 'stopped', conversationId: 'stopped', role: 'system', status: 'completed', createdAt: 2, metadata: { codexBlock: 'run-complete', stopped: true } }),
      message({ id: 'completed-running', runId: 'completed', conversationId: 'completed', role: 'thinking', status: 'running', createdAt: 3 }),
      message({ id: 'completed-terminal', runId: 'completed', conversationId: 'completed', role: 'system', status: 'completed', createdAt: 4, metadata: { codexBlock: 'run-complete', manuallyResolved: true, resolution: 'completed' } }),
      message({ id: 'failed-running', runId: 'failed', conversationId: 'failed', role: 'thinking', status: 'running', createdAt: 5 }),
      message({ id: 'failed-terminal', runId: 'failed', conversationId: 'failed', role: 'error', status: 'failed', createdAt: 6, metadata: { codexBlock: 'run-complete', manuallyResolved: true, resolution: 'failed' } })
    ], now)

    const statusById = new Map(summaries.map((summary) => [summary.id, summary.status]))
    expect(statusById.get('stopped')).toBe('completed')
    expect(statusById.get('completed')).toBe('completed')
    expect(statusById.get('failed')).toBe('failed')
  })

  it('keeps the original plan or run source when later follow-up messages land in the same conversation', () => {
    const summaries = buildChatConversationSummaries([
      message({ id: 'run-start', runId: 'run-1', conversationId: 'run-1', source: 'codex-run', role: 'system', createdAt: 1, body: 'Run started.' }),
      message({ id: 'follow-up', runId: 'chat-1', conversationId: 'run-1', source: 'codex-chat', role: 'user', createdAt: 2, body: 'Continue from the run output.' })
    ], 10)

    expect(summaries[0].title).toBe('Run')
    expect(summaries[0].source).toBe('codex-run')
    expect(summaries[0].count).toBe(1)
  })
})

describe('planner question helpers', () => {
  it('extracts the latest unanswered planner question with options', () => {
    const prompt = plannerQuestionPromptFromMessages([
      message({
        id: 'question-1',
        source: 'codex-plan',
        role: 'assistant',
        createdAt: 10,
        metadata: {
          codexBlock: 'planner-question',
          summary: 'Need scope.',
          questions: [
            {
              id: 'scope',
              question: 'Which scope should the planner use?',
              why: 'Scope changes subtasks.',
              options: [
                { id: 'chat', label: 'Chat only', description: 'Limit changes to chat.' },
                { id: 'all', label: 'All screens' }
              ]
            }
          ]
        }
      })
    ])

    expect(prompt?.summary).toBe('Need scope.')
    expect(prompt?.questions[0]).toMatchObject({
      id: 'scope',
      question: 'Which scope should the planner use?',
      options: [{ id: 'chat', label: 'Chat only', description: 'Limit changes to chat.' }, { id: 'all', label: 'All screens' }]
    })
  })

  it('does not return a planner question after a clarification answer', () => {
    const prompt = plannerQuestionPromptFromMessages([
      message({ id: 'question-1', source: 'codex-plan', role: 'assistant', createdAt: 10, metadata: { codexBlock: 'planner-question', questions: [{ id: 'scope', question: 'Scope?' }] } }),
      message({ id: 'answer-1', source: 'codex-plan', role: 'user', createdAt: 11, body: 'Answer', metadata: { clarification: true } })
    ])

    expect(prompt).toBeNull()
  })

  it('formats selected options and free text as planner clarification', () => {
    const prompt = plannerQuestionPromptFromMessages([
      message({
        id: 'question-1',
        source: 'codex-plan',
        role: 'assistant',
        createdAt: 10,
        metadata: {
          codexBlock: 'planner-question',
          questions: [
            { id: 'scope', question: 'Scope?', options: [{ id: 'chat', label: 'Chat only' }] },
            { id: 'note', question: 'Anything else?' }
          ]
        }
      })
    ])

    expect(prompt).not.toBeNull()
    const answer = formatPlannerClarificationAnswer({
      prompt: prompt!,
      selectedOptionIds: { scope: 'chat' },
      notes: { note: 'Keep current design language.' }
    })

    expect(answer).toContain('Question: Scope?')
    expect(answer).toContain('Selected option: Chat only')
    expect(answer).toContain('Answer: Keep current design language.')
  })

  it('keeps selected options and typed notes as separate planner clarification signals', () => {
    const prompt = plannerQuestionPromptFromMessages([
      message({
        id: 'question-1',
        source: 'codex-plan',
        role: 'assistant',
        createdAt: 10,
        metadata: {
          codexBlock: 'planner-question',
          questions: [
            { id: 'scope', question: 'Scope?', options: [{ id: 'chat', label: 'Chat only', description: 'Stay in chat surfaces.' }] }
          ]
        }
      })
    ])

    expect(prompt).not.toBeNull()
    const answer = formatPlannerClarificationAnswer({
      prompt: prompt!,
      selectedOptionIds: { scope: 'chat' },
      notes: { scope: 'Also keep the popup blocking.' }
    })

    expect(answer).toContain('Selected option: Chat only - Stay in chat surfaces.')
    expect(answer).toContain('Additional context: Also keep the popup blocking.')
  })

  it('tells Codex to use judgment when no option or note is provided', () => {
    const prompt = plannerQuestionPromptFromMessages([
      message({
        id: 'question-1',
        source: 'codex-plan',
        role: 'assistant',
        createdAt: 10,
        metadata: {
          codexBlock: 'planner-question',
          questions: [
            { id: 'scope', question: 'Scope?', options: [{ id: 'chat', label: 'Chat only' }] },
            { id: 'reset', question: 'Include reset?' }
          ]
        }
      })
    ])

    expect(prompt).not.toBeNull()
    const answer = formatPlannerClarificationAnswer({
      prompt: prompt!,
      selectedOptionIds: {},
      notes: {}
    })

    expect(answer.match(/No explicit answer provided; use your best judgment from the task context\./g)).toHaveLength(2)
  })
})

describe('chat utils helpers', () => {
  it('slices visible chat messages from the newest end', () => {
    const rows = Array.from({ length: 5 }, (_, index) => `message-${index + 1}`)
    expect(visibleChatMessagesForLimit(rows, 3)).toEqual(['message-3', 'message-4', 'message-5'])
    expect(visibleChatMessagesForLimit(rows, 10)).toEqual(rows)
  })

  it('detects top-scroll lazy loading only when older messages are hidden', () => {
    expect(shouldLoadEarlierMessages(24, 5)).toBe(true)
    expect(shouldLoadEarlierMessages(120, 5)).toBe(false)
    expect(shouldLoadEarlierMessages(24, 0)).toBe(false)
  })

  it('preserves scroll position after older messages are prepended', () => {
    expect(preserveScrollTopAfterPrepend(40, 1_000, 1_480)).toBe(520)
  })

  it('appends activity messages to the matching task payload without duplicating ids', () => {
    const task: TaskEntity = {
      id: 'task-1',
      projectId: 'project-1',
      title: 'Task',
      status: 'active',
      agentId: null,
      payload: { activityMessages: [message({ id: 'old', createdAt: 1 })] },
      result: {},
      comments: [],
      commentCount: 0,
      tags: [],
      skills: [],
      subtasks: [],
      checklistItems: [],
      customFieldValues: {},
      createdAt: 1,
      updatedAt: 1
    }
    const nextMessage = message({ id: 'new', createdAt: 5, updatedAt: 6 })
    const updated = appendActivityMessageToTasks([task], 'task-1', nextMessage)

    expect((updated[0].payload?.activityMessages as TaskActivityMessage[]).map((item) => item.id)).toEqual(['old', 'new'])
    expect(updated[0].updatedAt).toBe(6)
    expect(appendActivityMessageToTasks(updated, 'task-1', nextMessage)).toBe(updated)
  })

  it('groups codex runtime rows into a readable work block and leaves user/completion rows outside', () => {
    const items = groupCodexTranscriptMessages([
      message({ id: 'user', role: 'user', createdAt: 1 }),
      message({ id: 'thinking', role: 'thinking', status: 'completed', body: 'Reading the current chat UI.', createdAt: 2, metadata: { codexBlock: 'thinking', thinkingDurationMs: 72_000 } }),
      message({ id: 'search', role: 'tool', status: 'completed', body: 'Command: rg -n "chat" src\nStatus: completed', createdAt: 3, metadata: { codexBlock: 'command', command: 'rg -n "chat" src' } }),
      message({ id: 'read', role: 'tool', status: 'completed', body: 'Command: sed -n 1,40p src/a.ts\nStatus: completed', createdAt: 4, metadata: { codexBlock: 'command', command: 'sed -n 1,40p src/a.ts' } }),
      message({ id: 'assistant', role: 'assistant', body: 'I found the command spam source.', createdAt: 5, metadata: { codexBlock: 'assistant', runStatus: 'running' } }),
      message({ id: 'run', role: 'tool', status: 'completed', body: 'Command: npm test\nStatus: completed\n\n```text\npassed\n```', createdAt: 6, metadata: { codexBlock: 'command', command: 'npm test' } }),
      message({ id: 'changes', role: 'tool', status: 'completed', body: 'Changes', createdAt: 7, metadata: { codexBlock: 'changes', changeFiles: 1, changeFileStats: [{ path: 'src/new.ts', insertions: 3, deletions: 0, blocks: 0, untracked: true }], changeHasNoChanges: false } }),
      message({ id: 'complete', role: 'system', status: 'completed', body: 'Codex chat completed.', createdAt: 8, metadata: { codexBlock: 'run-complete' } })
    ], 10)

    expect(items.map((item) => item.kind)).toEqual(['message', 'work-block', 'message'])
    const block = items[1].kind === 'work-block' ? items[1].block : null
    expect(block?.entries.some((entry) => entry.kind === 'text' && entry.message.body.includes('Reading'))).toBe(true)
    expect(block?.summaryRows.map((row) => row.label)).toEqual([
      'Explored 1 file, 1 search',
      'Ran 1 command',
      'Created 1 file'
    ])
    expect(block?.summaryRows[1].messages[0].body).toContain('passed')
  })

  it('uses thinking metadata before run timestamps for the work duration label', () => {
    const items = groupCodexTranscriptMessages([
      message({ id: 'thinking-duration', role: 'thinking', status: 'completed', createdAt: 1_000, updatedAt: 301_000, metadata: { codexBlock: 'thinking', thinkingDurationMs: 72_000 } }),
      message({ id: 'command-duration', role: 'tool', status: 'completed', createdAt: 302_000, metadata: { codexBlock: 'command', command: 'npm test' } })
    ], 400_000)

    const block = items[0].kind === 'work-block' ? items[0].block : null
    expect(block?.durationMs).toBe(72_000)
    expect(formatCodexWorkDuration(block?.durationMs, false)).toBe('Worked for 1m 12s')
  })

  it('falls back to elapsed run timestamps when thinking duration is missing', () => {
    const items = groupCodexTranscriptMessages([
      message({ id: 'thinking-elapsed', role: 'thinking', status: 'completed', createdAt: 1_000, metadata: { codexBlock: 'thinking' } }),
      message({ id: 'command-elapsed', role: 'tool', status: 'completed', createdAt: 4_400, metadata: { codexBlock: 'command', command: 'npm test' } })
    ], 10_000)

    const block = items[0].kind === 'work-block' ? items[0].block : null
    expect(formatCodexWorkDuration(block?.durationMs, false)).toBe('Worked for 3s')
  })

  it('freezes a running work block when the matching run-complete row exists', () => {
    const items = groupCodexTranscriptMessages([
      message({ id: 'thinking-running', runId: 'run-freeze', conversationId: 'conversation-freeze', role: 'thinking', status: 'running', createdAt: 1_000, updatedAt: 2_000, metadata: { codexBlock: 'thinking', runStatus: 'running' } }),
      message({ id: 'assistant-running', runId: 'run-freeze', conversationId: 'conversation-freeze', role: 'assistant', status: 'running', createdAt: 3_000, metadata: { runStatus: 'running' } }),
      message({ id: 'complete-freeze', runId: 'run-freeze', conversationId: 'conversation-freeze', role: 'system', status: 'completed', createdAt: 5_000, metadata: { codexBlock: 'run-complete' } })
    ], 60_000)

    const block = items[0].kind === 'work-block' ? items[0].block : null
    expect(block?.isRunning).toBe(false)
    expect(block?.durationMs).toBe(4_000)
  })

  it('does not treat command completion or failure as whole-run completion', () => {
    const items = groupCodexTranscriptMessages([
      message({ id: 'thinking-fresh', runId: 'run-fresh', conversationId: 'conversation-fresh', role: 'thinking', status: 'running', createdAt: 1_000, updatedAt: 2_000, metadata: { codexBlock: 'thinking', runStatus: 'running' } }),
      message({ id: 'command-failed', runId: 'run-fresh', conversationId: 'conversation-fresh', role: 'tool', status: 'failed', createdAt: 3_000, metadata: { codexBlock: 'command', command: 'npm test', runStatus: 'running' } })
    ], 10_000)

    const block = items[0].kind === 'work-block' ? items[0].block : null
    expect(block?.isRunning).toBe(true)
    expect(block?.durationMs).toBe(9_000)
  })

  it('freezes stale running work blocks at the last activity time without a terminal row', () => {
    const now = 30 * 60 * 1000
    const items = groupCodexTranscriptMessages([
      message({ id: 'thinking-stale', runId: 'run-stale', conversationId: 'conversation-stale', role: 'thinking', status: 'running', createdAt: 1_000, updatedAt: 2_000, metadata: { codexBlock: 'thinking', runStatus: 'running' } }),
      message({ id: 'assistant-stale', runId: 'run-stale', conversationId: 'conversation-stale', role: 'assistant', status: 'running', createdAt: 4_000, updatedAt: 5_000, metadata: { runStatus: 'running' } })
    ], now)

    const block = items[0].kind === 'work-block' ? items[0].block : null
    expect(block?.isRunning).toBe(false)
    expect(block?.durationMs).toBe(4_000)
  })

  it('detects explicit no-change tool messages', () => {
    const noChanges = message({
      id: 'changes-none',
      role: 'tool',
      body: 'No workspace changes detected.',
      metadata: { changeHasNoChanges: true, codexBlock: 'changes' }
    })

    expect(hasNoChangesMessage(noChanges)).toBe(true)
    expect(codexChangesSummary(noChanges)).toMatchObject({
      files: 0,
      blocks: 0,
      hasNoChanges: true,
      canRenderCard: false
    })
  })

  it('derives working duration from running started/ended timestamps', () => {
    const startedAt = 1_700_000_000_000
    const thinking = message({
      id: 'thinking-running',
      role: 'thinking',
      status: 'running',
      body: 'Inspecting dependencies',
      metadata: { thinkingStartedAt: startedAt }
    })

    expect(thinkingDurationLabel(thinking, startedAt + 5_500)).toBe('Working for 6 seconds')
  })

  it('derives completed thinking duration from duration_sec metadata', () => {
    const thinking = message({
      id: 'thinking-completed',
      role: 'thinking',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2_100,
      metadata: { thinkingDurationSec: '5' }
    })

    expect(thinkingDurationLabel(thinking)).toBe('Working for 5 seconds')
  })

  it('builds latest run follow-up context for the most recent run conversation', () => {
    const context = buildLatestRunFollowUpContext([
      message({
        id: 'run-1',
        source: 'codex-run',
        conversationId: 'run-1',
        createdAt: 1,
        role: 'assistant',
        status: 'completed',
        body: 'First run assistant note.',
        metadata: { codexBlock: 'assistant', runStatus: 'completed' }
      }),
      message({
        id: 'run-1-complete',
        source: 'codex-run',
        conversationId: 'run-1',
        createdAt: 2,
        role: 'system',
        status: 'completed',
        body: 'Run-1 complete.',
        metadata: { codexBlock: 'run-complete', code: 0 }
      }),
      message({
        id: 'run-2',
        source: 'codex-run',
        conversationId: 'run-2',
        createdAt: 3,
        role: 'assistant',
        status: 'running',
        body: 'Latest run in progress.',
        metadata: { codexBlock: 'assistant', runStatus: 'running' }
      }),
      message({
        id: 'run-2-changes',
        source: 'codex-run',
        conversationId: 'run-2',
        createdAt: 4,
        role: 'tool',
        status: 'completed',
        body: 'changes',
        metadata: { codexBlock: 'changes', changeFiles: 2, changeInsertions: 3, changeDeletions: 1, changeFileStats: [] }
      }),
      message({
        id: 'run-2-complete',
        source: 'codex-run',
        conversationId: 'run-2',
        createdAt: 5,
        role: 'system',
        status: 'completed',
        body: 'Run-2 complete.',
        metadata: { codexBlock: 'run-complete', code: 0 }
      }),
      message({
        id: 'non-run-2',
        source: 'codex-chat',
        conversationId: 'chat-2',
        createdAt: 6,
        role: 'assistant',
        status: 'completed',
        body: 'Ignored chat message'
      })
    ])

    expect(context).toContain('Latest run output context for conversation run-2:')
    expect(context).toContain('Final run status: Run-2 complete.')
    expect(context).toContain('Result: Exit code 0')
    expect(context).toContain('Recent run activity')
    expect(context).toContain('Reported changes: 2 files changed, +3 insertions, -1 deletions')
    expect(context).toContain('Final run status')
  })

  it('returns empty follow-up context for tasks with no run messages', () => {
    expect(buildLatestRunFollowUpContext([message({ id: 'chat-only', source: 'codex-chat', createdAt: 1, body: 'hello' })])).toBe('')
  })

  it('builds generated context entries across plan, run, and chat conversations', () => {
    const entries = buildGeneratedContextEntries([
      message({ id: 'plan-user', source: 'codex-plan', conversationId: 'plan-1', runId: 'plan-1', role: 'user', createdAt: 1, body: '/plan update scope' }),
      message({ id: 'plan-assistant', source: 'codex-plan', conversationId: 'plan-1', runId: 'plan-1', role: 'assistant', createdAt: 2, body: 'Planned the task structure.' }),
      message({ id: 'run-user', source: 'codex-run', conversationId: 'run-1', runId: 'run-1', role: 'user', createdAt: 3, body: 'Run task' }),
      message({ id: 'run-change', source: 'codex-run', conversationId: 'run-1', runId: 'run-1', role: 'tool', status: 'completed', createdAt: 4, body: 'changes', metadata: { codexBlock: 'changes', changeFiles: 1, changeInsertions: 2, changeDeletions: 0, changeFileStats: [] } }),
      message({ id: 'run-complete', source: 'codex-run', conversationId: 'run-1', runId: 'run-1', role: 'system', status: 'completed', createdAt: 5, body: 'Codex run completed.', metadata: { codexBlock: 'run-complete', code: 0 } }),
      message({ id: 'chat-user', source: 'codex-chat', conversationId: 'chat-1', runId: 'chat-1', role: 'user', createdAt: 6, body: 'Follow up' }),
      message({ id: 'chat-assistant', source: 'codex-chat', conversationId: 'chat-1', runId: 'chat-1', role: 'assistant', createdAt: 7, body: 'Follow-up answer.' })
    ])

    expect(entries.map((entry) => [entry.conversationId, entry.title])).toEqual([
      ['chat-1', 'Chat context'],
      ['run-1', 'Run context'],
      ['plan-1', 'Plan context']
    ])
    expect(entries.find((entry) => entry.conversationId === 'run-1')?.body).toContain('Reported changes: 1 file changed, +2 insertions')
    expect(buildLatestGeneratedFollowUpContext(entries.length ? [
      message({ id: 'chat-user', source: 'codex-chat', conversationId: 'chat-1', runId: 'chat-1', role: 'user', createdAt: 6, body: 'Follow up' }),
      message({ id: 'chat-assistant', source: 'codex-chat', conversationId: 'chat-1', runId: 'chat-1', role: 'assistant', createdAt: 7, body: 'Follow-up answer.' })
    ] : [])).toContain('Chat context for conversation chat-1')
  })

  it('summarizes patch block counts when metadata is unavailable', () => {
    const changes = message({
      id: 'changes-diff',
      role: 'tool',
      body: [
        'Changes',
        '',
        '```diff',
        'diff --git a/src/a.ts b/src/a.ts',
        'index 111..222 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,2 +1,3 @@',
        '+const a = 1',
        '-const b = 2',
        '@@ -10,2 +11,3 @@',
        '+const c = 3',
        '-const d = 4',
        '```'
      ].join('\n'),
      metadata: { codexBlock: 'changes', unavailable: false }
    })

    expect(codexChangesSummary(changes)).toMatchObject({
      files: 1,
      blocks: 2,
      insertions: 2,
      deletions: 2,
      hasNoChanges: false,
      canRenderCard: true
    })
  })
})
