import type { ProjectInstructionTemplatePayload } from '../types/entities.js'

export const STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE_ID = 'builtin-standard-agentic-project-instructions'

export const STANDARD_PROJECT_INSTRUCTIONS_TEMPLATE: ProjectInstructionTemplatePayload = {
  generalContext: `This project is managed in Open Mission Control. Treat project tasks as implementation-ready work items. Always read project context, task description, comments, checklist, custom fields, attachments, agent instructions, skill instructions, and subtasks before planning or running work.`,
  generalPrompt: `Act as a pragmatic engineering agent. Keep scope tight, preserve existing user decisions, and avoid broad rewrites unless requested. Prefer concrete file-level changes and explicit verification notes. If the task is ambiguous, improve the task plan before implementation.`,
  planGuide: `# Standard Plan Guide

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

- title
- status
- project
- project group
- tags
- description
- acceptanceCriteria
- checklist
- comments
- customFields
- attachments
- assigned agent
- selected skills
- task gateway/model overrides
- project Codex gateway and plan/run models
- subtasks, including title, description, status, tags, checklist, comments, customFields, and dueAt if present

## Output expectations

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

## Status handling

- During planning, completed/done/closed subtasks may be rewritten as part of the full planned subtask list.
- Do not mark the task complete during planning.`,
  defaultOutput: `Summaries should include changed files, key behavior changes, verification performed, and known follow-ups. Plans should be concise, ordered, and implementation-ready.`,
  rules: `- Do not ignore project-specific instructions.
- Do not overwrite user work unless explicitly requested.
- Do not mark work complete without implementation and verification notes.
- Keep generated task updates compatible with Open Mission Control planner JSON.`
}
