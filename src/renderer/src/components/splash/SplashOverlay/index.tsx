import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import styles from './index.module.scss'
import { getBootMotivation, splashConfig } from './splashContent'

const appIconSrc = new URL('../../../../../../app-icon.png', import.meta.url).href

const codeRain = [
  'task.status -> review',
  'agent.sync(context)',
  'workspace.ready = true',
  'gateway.pulse(200)',
  'plan.execute(next)',
  'diff.check(scope)',
  'subtasks.map(run)',
  'ship.when(green)'
]

const taskRain = [
  'Read Task.md',
  'Resolve context',
  'Map renderer state',
  'Check IPC boundary',
  'Prepare overlay',
  'Verify build',
  'Push mission log',
  'Ready for review'
]

const statusNodes = ['CONTEXT', 'TASKS', 'GATEWAY', 'AGENTS', 'BUILD', 'REVIEW']

interface SplashOverlayProps {
  ready: boolean
}

export function SplashOverlay({ ready }: SplashOverlayProps) {
  const motivation = useMemo(() => getBootMotivation(), [])
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
            <span key={task} style={{ '--task-index': index } as CSSProperties}>{task}</span>
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
