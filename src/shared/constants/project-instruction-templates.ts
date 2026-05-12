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
- Use balanced subtask decomposition: 1-3 subtasks for small tasks, 3-8 subtasks for typical tasks, and at most 10 subtasks for very large tasks.
- Create subtasks for cohesive implementation areas, independent workflows, separate ownership boundaries, or meaningful verification paths.
- Do not create a separate subtask for every file, UI state, edge case, or verification command; put those details inside the relevant subtask description.
- Keep subtasks ordered by execution dependency.
- Do not remove user-provided constraints from the description or comments.

## Task fields to inspect

- title
- status
- project
- project group
- tags
- description
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
- Update description with the general goal, implementation scope, and overall AI guidance.
- Use comments for important flows, risks, dependencies, edge cases, and decision notes.
- Subtasks are the primary execution plan, but should stay compact enough to fit the task context.
- Every subtask must follow the Title + Description shape: short action-oriented title, concise AI-guiding description.
- Checklist items are optional for planned subtasks. Use them only when they add concrete clarity.
- Do not scatter test cases across subtasks; if verification is needed, make the final subtask a concrete verification step.
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
- Keep generated task updates compatible with Open Mission Control planner JSON.`,
  postRunPrompt: `Review the completed run output and workspace changes. Apply only final follow-up work that directly improves the completed task, such as targeted cleanup, documentation updates, or missing verification notes. Do not restart the task or broaden scope.`
}
