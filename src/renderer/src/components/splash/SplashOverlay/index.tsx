import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import styles from './index.module.scss'
import { getBootMotivation, splashConfig } from './splashContent'

const appIconSrc = new URL('../../../../../../app-icon.png', import.meta.url).href

interface CodeToken {
  value: string
  tone: 'keyword' | 'function' | 'string' | 'property' | 'number' | 'operator' | 'plain'
}

interface CodeLine {
  lane: number
  tokens: CodeToken[]
}

interface CodeBlock {
  lane: number
  lines: CodeLine[]
}

const codeRain: CodeLine[] = [
  {
    lane: 2,
    tokens: [
      { value: 'const ', tone: 'keyword' },
      { value: 'missionRuntime ', tone: 'property' },
      { value: '= await ', tone: 'keyword' },
      { value: 'loadWorkspace', tone: 'function' },
      { value: '({ projectId: ', tone: 'plain' },
      { value: '"open-mission-control"', tone: 'string' },
      { value: ', hydrate: ', tone: 'plain' },
      { value: 'true', tone: 'keyword' },
      { value: ' })', tone: 'plain' }
    ]
  },
  {
    lane: 9,
    tokens: [
      { value: 'const ', tone: 'keyword' },
      { value: 'visibleTasks ', tone: 'property' },
      { value: '= ', tone: 'operator' },
      { value: 'taskGraph', tone: 'property' },
      { value: '.filter', tone: 'function' },
      { value: '(task => task.status !== ', tone: 'plain' },
      { value: '"closed"', tone: 'string' },
      { value: ').sort', tone: 'function' },
      { value: '((a, b) => a.priority - b.priority)', tone: 'plain' }
    ]
  },
  {
    lane: 18,
    tokens: [
      { value: 'gateway', tone: 'property' },
      { value: '.stream', tone: 'function' },
      { value: '({ channel: ', tone: 'plain' },
      { value: '"codex:activity"', tone: 'string' },
      { value: ', mode: ', tone: 'plain' },
      { value: '"plan-and-run"', tone: 'string' },
      { value: ', heartbeatMs: ', tone: 'plain' },
      { value: '1200', tone: 'number' },
      { value: ' })', tone: 'plain' }
    ]
  },
  {
    lane: 29,
    tokens: [
      { value: 'await ', tone: 'keyword' },
      { value: 'agent', tone: 'property' },
      { value: '.applyProjectRules', tone: 'function' },
      { value: '({ scssModules: ', tone: 'plain' },
      { value: 'true', tone: 'keyword' },
      { value: ', nestedSelectors: ', tone: 'plain' },
      { value: 'true', tone: 'keyword' },
      { value: ', scope: ', tone: 'plain' },
      { value: '"renderer/splash"', tone: 'string' },
      { value: ' })', tone: 'plain' }
    ]
  },
  {
    lane: 40,
    tokens: [
      { value: 'const ', tone: 'keyword' },
      { value: 'reviewPayload ', tone: 'property' },
      { value: '= ', tone: 'operator' },
      { value: 'serializeTask', tone: 'function' },
      { value: '({ title, status: ', tone: 'plain' },
      { value: '"Review"', tone: 'string' },
      { value: ', checklist: completedItems, comments })', tone: 'plain' }
    ]
  },
  {
    lane: 51,
    tokens: [
      { value: 'if ', tone: 'keyword' },
      { value: '(', tone: 'plain' },
      { value: 'build', tone: 'property' },
      { value: '.typecheck', tone: 'property' },
      { value: ' === ', tone: 'operator' },
      { value: '"green"', tone: 'string' },
      { value: ') ', tone: 'plain' },
      { value: 'await ', tone: 'keyword' },
      { value: 'git', tone: 'property' },
      { value: '.push', tone: 'function' },
      { value: '({ branch: ', tone: 'plain' },
      { value: '"main"', tone: 'string' },
      { value: ', includeDirtyFiles: ', tone: 'plain' },
      { value: 'false', tone: 'keyword' },
      { value: ' })', tone: 'plain' }
    ]
  },
  {
    lane: 63,
    tokens: [
      { value: 'dispatch', tone: 'function' },
      { value: '(', tone: 'plain' },
      { value: 'missionSlice', tone: 'property' },
      { value: '.actions', tone: 'property' },
      { value: '.setSplashReady', tone: 'function' },
      { value: '({ minimumElapsed: ', tone: 'plain' },
      { value: 'true', tone: 'keyword' },
      { value: ', rendererReady: ', tone: 'plain' },
      { value: 'Boolean', tone: 'function' },
      { value: '(user || errorMessage) }))', tone: 'plain' }
    ]
  },
  {
    lane: 76,
    tokens: [
      { value: 'const ', tone: 'keyword' },
      { value: 'timeline ', tone: 'property' },
      { value: '= ', tone: 'operator' },
      { value: 'activityMessages', tone: 'property' },
      { value: '.map', tone: 'function' },
      { value: '(({ phase, body }) => ', tone: 'plain' },
      { value: 'formatEvent', tone: 'function' },
      { value: '({ phase, body, colorize: ', tone: 'plain' },
      { value: 'true', tone: 'keyword' },
      { value: ' }))', tone: 'plain' }
    ]
  },
  {
    lane: 4,
    tokens: [
      { value: 'renderer', tone: 'property' },
      { value: '.mount', tone: 'function' },
      { value: '(<', tone: 'plain' },
      { value: 'SplashOverlay', tone: 'function' },
      { value: ' ready={initialized || Boolean(errorMessage)} intensity=', tone: 'plain' },
      { value: '"cinematic"', tone: 'string' },
      { value: ' />)', tone: 'plain' }
    ]
  },
  {
    lane: 34,
    tokens: [
      { value: 'const ', tone: 'keyword' },
      { value: 'diffSummary ', tone: 'property' },
      { value: '= ', tone: 'operator' },
      { value: 'changedFiles', tone: 'property' },
      { value: '.reduce', tone: 'function' },
      { value: '((summary, file) => summary.add(file.path, file.insertions, file.deletions), ', tone: 'plain' },
      { value: 'new ', tone: 'keyword' },
      { value: 'DiffSummary', tone: 'function' },
      { value: '())', tone: 'plain' }
    ]
  },
  {
    lane: 57,
    tokens: [
      { value: 'await ', tone: 'keyword' },
      { value: 'omc', tone: 'property' },
      { value: '.readyForReview', tone: 'function' },
      { value: '({ taskId, status: ', tone: 'plain' },
      { value: '"Review"', tone: 'string' },
      { value: ', verification: ', tone: 'plain' },
      { value: '"npm run build"', tone: 'string' },
      { value: ', pushedCommit })', tone: 'plain' }
    ]
  },
  {
    lane: 84,
    tokens: [
      { value: 'queue', tone: 'property' },
      { value: '.schedule', tone: 'function' },
      { value: '({ kind: ', tone: 'plain' },
      { value: '"subtask"', tone: 'string' },
      { value: ', owner: activeAgent.name, dueAt: ', tone: 'plain' },
      { value: 'Date', tone: 'function' },
      { value: '.now', tone: 'function' },
      { value: '() + ', tone: 'plain' },
      { value: '60000', tone: 'number' },
      { value: ' })', tone: 'plain' }
    ]
  }
]

const codeBlocks: CodeBlock[] = [
  { lane: 0, lines: [codeRain[0], codeRain[1], codeRain[2], codeRain[3], codeRain[4]] },
  { lane: 18, lines: [codeRain[5], codeRain[6], codeRain[7], codeRain[8], codeRain[9]] },
  { lane: 40, lines: [codeRain[10], codeRain[11], codeRain[0], codeRain[2], codeRain[5]] },
  { lane: 62, lines: [codeRain[3], codeRain[4], codeRain[7], codeRain[9], codeRain[11]] },
  { lane: 8, lines: [codeRain[1], codeRain[6], codeRain[8], codeRain[10], codeRain[0]] },
  { lane: 52, lines: [codeRain[2], codeRain[5], codeRain[6], codeRain[7], codeRain[11]] }
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
const taskLanes = [0, 1, 2, 3, 4]
const statusNodes = ['CONTEXT', 'TASKS', 'GATEWAY', 'AGENTS', 'BUILD', 'REVIEW']

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function buildTaskRain() {
  return Array.from({ length: 18 }, (_, index) => ({
    id: `${index}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: pickRandom(taskStatuses),
    title: pickRandom(taskTitles),
    tag: pickRandom(taskTags),
    owner: pickRandom(taskOwners),
    points: pickRandom(taskPoints),
    accent: pickRandom(taskAccents),
    lane: pickRandom(taskLanes),
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
          {codeBlocks.map((block, blockIndex) => (
            <div
              key={`${blockIndex}-${block.lane}`}
              className={styles.codeBlock}
              style={{
                '--block-index': blockIndex,
                '--block-lane': block.lane
              } as CSSProperties}
            >
              <div className={styles.codeBlockChrome}>workspace://open-mission-control/src/renderer/runtime.tsx</div>
              <div className={styles.codeBlockBody}>
                {block.lines.map((line, lineIndex) => (
                  <code
                    key={`${blockIndex}-${lineIndex}-${line.lane}`}
                    className={styles.codeLine}
                    style={{ '--line-index': lineIndex } as CSSProperties}
                  >
                    {line.tokens.map((token, tokenIndex) => (
                      <span key={`${token.value}-${tokenIndex}`} data-tone={token.tone}>{token.value}</span>
                    ))}
                  </code>
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
