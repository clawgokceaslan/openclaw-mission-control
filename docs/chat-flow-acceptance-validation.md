# Chat Flow Acceptance Validation

Date: 2026-05-12

Scope: Task.md altindaki chat akisi iyilestirme kabul senaryolari.

## Verified Scenarios

- First run payload: `runGateway` uses exported `Task.md`, `Task.json`, `Task.toon`, `Agents.md`, `Skills.md`, and native attachment files instead of requiring a zip archive. The first Codex prompt points to the source-format task file and includes project instructions, language, effective agent, workspace, and OMC CLI guidance.
- Plan flow: `planWithGateway` writes structured planner instructions, preserves task title/description authority, preserves user comments, requires concrete subtasks, rejects generic items, and now caps planned subtasks at 10.
- Plan status transition: planner bridge update moves tasks from an initial/not-started workflow state to the first active project status, and does not move tasks already active or done.
- Chat send and attach: the renderer uses one submit path for button and Enter, keeps `/plan` and `/steer` command state separate from the prompt body, forwards command metadata, and sends attachment metadata/bytes while the sent-message renderer shows square preview tiles for outgoing attachments.
- Pause/stop: `gatewayChatStop` marks matching active child runs as stop requested, sends SIGTERM, and appends a terminal stopped message; no-running stop responses are settled locally so stale running UI does not remain.
- Steer: `/steer` targets the selected conversation, keeps metadata separate, allows sending while the selected conversation is running, interrupts the active exec turn for that conversation, and starts a steer continuation with the latest transcript/context.
- Follow-up depth: activity messages are persisted on the task payload up to 1000 entries; sidebar conversation summaries are grouped by `conversationId`, keep the selected conversation visible even beyond the 120-row performance window, and generated context entries summarize plan/run/chat history for later follow-ups.
- UI fit: chat header, lifecycle strip, composer, configuration details, attach, and send controls are implemented in nested module SCSS, with mobile breakpoints and overflow guards for compact widths.

## Verification Commands

- `npx vitest run src/main/services/task.service.test.ts`
- `npx vitest run src/renderer/src/screens/projects/detail/chat/chatUtils.test.ts src/renderer/src/screens/projects/detail/projectDetailUtils.test.ts src/renderer/src/screens/projects/detail/taskExport.test.ts`
- `npm run build`

All commands passed on 2026-05-12.
