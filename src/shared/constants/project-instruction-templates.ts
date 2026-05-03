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
- Add subtasks only when they reduce ambiguity or split independent work.
- Keep tags as names or ids.
- Keep customFields as { name, value } entries.

## Status handling

- Keep completed/done/closed subtasks untouched unless the user explicitly asks.
- Do not mark the task complete during planning.`,
  defaultOutput: `Summaries should include changed files, key behavior changes, verification performed, and known follow-ups. Plans should be concise, ordered, and implementation-ready.`,
  rules: `- Do not ignore project-specific instructions.
- Do not overwrite user work unless explicitly requested.
- Do not mark work complete without implementation and verification notes.
- Keep generated task updates compatible with Open Mission Control planner JSON.`
}
