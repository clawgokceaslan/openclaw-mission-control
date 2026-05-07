import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import styles from './index.module.scss'
import { getBootMotivation, splashConfig } from './splashContent'

const appIconSrc = new URL('../../../../../../app-icon.png', import.meta.url).href

const codeRain = [
  'const mission = await loadWorkspace()',
  'if (task.ready) queue.push(task)',
  'gateway.stream({ mode: "plan" })',
  'agent.apply(projectRules)',
  'diff.scope(["renderer", "scss"])',
  'await build.when(typecheck.green)',
  'task.status = "review"',
  'push({ branch: "main", clean: true })'
]

const taskTitles = [
  'App Splash Loader',
  'Renderer Overlay Polish',
  'Gateway Context Sync',
  'Mission Timeline Review',
  'Task Detail Flow',
  'Agent Runtime Check',
  'Build Verification',
  'Command Palette Sweep',
  'Project Signal Cleanup',
  'Review Handoff'
]

const taskStatuses = ['Running', 'Review', 'Queued', 'Active', 'Ready', 'Done']
const taskTags = ['renderer', 'electron', 'ux', 'build', 'gateway', 'planner']
const taskOwners = ['Pilot', 'Agent', 'Control', 'Runtime', 'Review']
const taskPoints = [2, 3, 5, 8, 13]
const taskAccents = ['blue', 'green', 'violet', 'amber']
const statusNodes = ['CONTEXT', 'TASKS', 'GATEWAY', 'AGENTS', 'BUILD', 'REVIEW']

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function buildTaskRain() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `${index}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: pickRandom(taskStatuses),
    title: pickRandom(taskTitles),
    tag: pickRandom(taskTags),
    owner: pickRandom(taskOwners),
    points: pickRandom(taskPoints),
    accent: pickRandom(taskAccents),
    progress: 32 + Math.floor(Math.random() * 62)
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
          {codeRain.map((line, index) => (
            <span key={line} style={{ '--line-index': index } as CSSProperties}>{line}</span>
          ))}
        </div>
        <div className={styles.taskRain}>
          {taskRain.map((task, index) => (
            <article
              key={task.id}
              className={styles.taskCard}
              style={{
                '--task-index': index,
                '--task-progress': `${task.progress}%`
              } as CSSProperties}
              data-accent={task.accent}
            >
              <div className={styles.taskCardHeader}>
                <span>{task.status}</span>
                <small>{task.points}p</small>
              </div>
              <strong>{task.title}</strong>
              <div className={styles.taskCardMeta}>
                <span>{task.owner}</span>
                <span>{task.tag}</span>
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
          </div>
          <span>{splashConfig.spinnerLabel}</span>
        </div>
      </div>
    </section>
  )
}
