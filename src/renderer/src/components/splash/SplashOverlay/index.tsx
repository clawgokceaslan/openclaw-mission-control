import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import styles from './index.module.scss'
import { getBootMotivation, splashConfig } from './splashContent'

import appIconSrc from './app-icon-splash.png'

hljs.registerLanguage('typescript', typescript)

interface CodeLine {
  lane: number
  html: string
}

interface CodeBlock {
  lane: number
  lines: CodeLine[]
}

const codeSamples = [
  'const missionRuntime = await loadWorkspace({ projectId: "open-mission-control", hydrate: true })',
  'const visibleTasks = taskGraph.filter(task => task.status !== "closed").sort(byPriority)',
  'gateway.stream({ channel: "codex:activity", mode: "plan-and-run", heartbeatMs: 1200 })',
  'await agent.applyProjectRules({ scssModules: true, nestedSelectors: true, scope: "renderer/splash" })',
  'const reviewPayload = serializeTask({ title, status: "Review", checklist: completedItems, comments })',
  'if (build.typecheck === "green") await git.push({ branch: "main", includeDirtyFiles: false })',
  'dispatch(missionSlice.actions.setSplashReady({ minimumElapsed: true, rendererReady: Boolean(user) }))',
  'const timeline = activityMessages.map(({ phase, body }) => formatEvent({ phase, body, colorize: true }))',
  'renderer.mount(<SplashOverlay ready={initialized || Boolean(errorMessage)} intensity="cinematic" />)',
  'const diffSummary = changedFiles.reduce((summary, file) => summary.add(file.path, file.insertions), new DiffSummary())',
  'await omc.readyForReview({ taskId, status: "Review", verification: "npm run build", pushedCommit })',
  'queue.schedule({ kind: "subtask", owner: activeAgent.name, dueAt: Date.now() + 60000 })',
  'const checklistRatio = Math.round((doneItems / Math.max(totalItems, 1)) * 100)',
  'notifyOperators({ tag: "renderer", signal: "desktop-and-mobile-splash-balanced" })'
]

function highlightStaticCode(code: string): string {
  return hljs.highlight(code, { language: 'typescript', ignoreIllegals: true }).value
}

const codeRain: CodeLine[] = codeSamples.map((code, index) => ({
  lane: index * 7,
  html: highlightStaticCode(code)
}))

const codeBlocks: CodeBlock[] = [
  { lane: -8, lines: [codeRain[0], codeRain[1], codeRain[2], codeRain[3], codeRain[4], codeRain[5], codeRain[6], codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11]] },
  { lane: 4, lines: [codeRain[1], codeRain[2], codeRain[3], codeRain[4], codeRain[5], codeRain[6], codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11], codeRain[0]] },
  { lane: 18, lines: [codeRain[2], codeRain[3], codeRain[4], codeRain[5], codeRain[6], codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11], codeRain[0], codeRain[1]] },
  { lane: 32, lines: [codeRain[3], codeRain[4], codeRain[5], codeRain[6], codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11], codeRain[0], codeRain[1], codeRain[2]] },
  { lane: 46, lines: [codeRain[4], codeRain[5], codeRain[6], codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11], codeRain[0], codeRain[1], codeRain[2], codeRain[3]] },
  { lane: 60, lines: [codeRain[5], codeRain[6], codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11], codeRain[0], codeRain[1], codeRain[2], codeRain[3], codeRain[4]] },
  { lane: 74, lines: [codeRain[6], codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11], codeRain[0], codeRain[1], codeRain[2], codeRain[3], codeRain[4], codeRain[5]] },
  { lane: 88, lines: [codeRain[7], codeRain[8], codeRain[9], codeRain[10], codeRain[11], codeRain[0], codeRain[1], codeRain[2], codeRain[3], codeRain[4], codeRain[5], codeRain[6]] }
]

interface TaskRainTemplate {
  status: string
  title: string
  tag: string
  agent: string
  subtasks: string
  checklist: string
  signal: string
  progress: number
}

const taskTemplates: TaskRainTemplate[] = [
  {
    status: 'Running',
    title: 'Splash Loader Gelistir',
    tag: 'renderer',
    agent: 'ElectoVite Pilot',
    subtasks: '4 subtasks',
    checklist: '6/8 checklist',
    signal: 'icon crop + motion pass',
    progress: 76
  },
  {
    status: 'Review',
    title: 'Task Detail Flow',
    tag: 'ux',
    agent: 'Control Reviewer',
    subtasks: '5 subtasks',
    checklist: '9/10 checklist',
    signal: 'handoff ready',
    progress: 91
  },
  {
    status: 'Queued',
    title: 'Gateway Context Sync',
    tag: 'gateway',
    agent: 'Runtime Agent',
    subtasks: '3 subtasks',
    checklist: '2/6 checklist',
    signal: 'workspace hydrate',
    progress: 38
  },
  {
    status: 'Active',
    title: 'Mission Timeline Review',
    tag: 'planner',
    agent: 'Plan Scout',
    subtasks: '7 subtasks',
    checklist: '11/14 checklist',
    signal: 'comment digest',
    progress: 68
  },
  {
    status: 'Ready',
    title: 'Build Verification',
    tag: 'build',
    agent: 'Electron Guard',
    subtasks: '2 subtasks',
    checklist: '4/4 checklist',
    signal: 'typecheck green',
    progress: 100
  },
  {
    status: 'Running',
    title: 'Command Palette Sweep',
    tag: 'navigation',
    agent: 'UX Pilot',
    subtasks: '6 subtasks',
    checklist: '5/9 checklist',
    signal: 'shortcuts aligned',
    progress: 57
  },
  {
    status: 'Active',
    title: 'Project Signal Cleanup',
    tag: 'data',
    agent: 'Schema Pilot',
    subtasks: '4 subtasks',
    checklist: '3/7 checklist',
    signal: 'stale rows pruned',
    progress: 49
  },
  {
    status: 'Review',
    title: 'Agent Runtime Check',
    tag: 'agent',
    agent: 'Codex Operator',
    subtasks: '3 subtasks',
    checklist: '7/7 checklist',
    signal: 'ready-for-review',
    progress: 96
  }
]

const taskAccents = ['blue', 'green', 'violet', 'amber']
const taskLanes = [0, 1, 2, 3, 4, 5]
const statusNodes = ['CONTEXT', 'TASKS', 'GATEWAY', 'AGENTS', 'BUILD', 'REVIEW']

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function buildTaskRain() {
  return Array.from({ length: 30 }, (_, index) => ({
    ...pickRandom(taskTemplates),
    id: `${index}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    accent: pickRandom(taskAccents),
    lane: pickRandom(taskLanes),
    progress: 34 + Math.floor(Math.random() * 63)
  }))
}

interface SplashOverlayProps {
  ready: boolean
}

export function SplashOverlay({ ready }: SplashOverlayProps) {
  const motivation = useMemo(() => getBootMotivation(), [])
  const taskRain = useMemo(() => buildTaskRain(), [])
  const [minimumElapsed, setMinimumElapsed] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumElapsed(true), splashConfig.minimumDurationMs)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!ready || !minimumElapsed) {
      return
    }

    setExiting(true)
    const timer = window.setTimeout(() => setVisible(false), splashConfig.exitDurationMs)
    return () => window.clearTimeout(timer)
  }, [minimumElapsed, ready])

  if (!visible) {
    return null
  }

  return (
    <section
      className={`${styles.splashOverlay} ${exiting ? styles.splashOverlayExit : ''}`}
      aria-live="polite"
      aria-busy={!exiting}
    >
      <div className={styles.animationField} aria-hidden="true">
        <div className={styles.orbit}>
          {statusNodes.map((node, index) => (
            <span key={node} style={{ '--node-index': index } as CSSProperties}>{node}</span>
          ))}
        </div>
        <div className={styles.codeRain}>
          {codeBlocks.map((block, blockIndex) => (
            <div
              key={`${blockIndex}-${block.lane}`}
              className={styles.codeBlock}
              style={{
                '--block-index': blockIndex,
                '--block-lane': block.lane
              } as CSSProperties}
            >
              <div className={styles.codeBlockBody}>
                {block.lines.map((line, lineIndex) => (
                  <code
                    key={`${blockIndex}-${lineIndex}-${line.lane}`}
                    className={styles.codeLine}
                    style={{ '--line-index': lineIndex } as CSSProperties}
                    dangerouslySetInnerHTML={{ __html: line.html }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.taskRain}>
          {taskRain.map((task, index) => (
            <article
              key={task.id}
              className={styles.taskCard}
              style={{
                '--task-index': index,
                '--task-lane': task.lane,
                '--task-progress': `${task.progress}%`
              } as CSSProperties}
              data-accent={task.accent}
            >
              <div className={styles.taskCardHeader}>
                <span>{task.status}</span>
                <small>{task.tag}</small>
              </div>
              <strong>{task.title}</strong>
              <div className={styles.taskCardMeta}>
                <span>{task.agent}</span>
                <span>{task.subtasks}</span>
              </div>
              <div className={styles.taskCardSignal}>
                <span>{task.checklist}</span>
                <span>{task.signal}</span>
              </div>
              <div className={styles.taskCardProgress} />
            </article>
          ))}
        </div>
        <div className={styles.signalGrid} />
      </div>

      <div className={styles.splashPanel}>
        <div className={styles.brandStack}>
          <div className={styles.logoShell}>
            <span />
            <img src={appIconSrc} alt={splashConfig.iconAlt} />
          </div>
          <div className={styles.titleBlock}>
            <p>{motivation.eyebrow}</p>
            <h1>{splashConfig.appTitle}</h1>
          </div>
        </div>

        <div className={styles.messageBlock}>
          <h2>{motivation.title}</h2>
          <p>{motivation.body}</p>
        </div>

        <div className={styles.loaderRow}>
          <div className={styles.spinner} aria-hidden="true">
            <span />
            <span />
            <span />
            <img src={appIconSrc} alt="" />
          </div>
          <span>{splashConfig.spinnerLabel}</span>
        </div>
      </div>
    </section>
  )
}
