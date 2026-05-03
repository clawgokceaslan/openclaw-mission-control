import { useEffect, useMemo, useState } from 'react'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { LuActivity, LuCalendarClock, LuCircleCheck, LuCircleDot, LuClock3, LuTags, LuUsers, LuX } from 'react-icons/lu'
import type { Agent, Project, TaskEntity } from '@shared/types/entities'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import { buildProjectAnalyticsModel, type AnalyticsBucket } from './analytics'
import styles from './index.module.scss'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, PointElement, LineElement, Filler, Tooltip, Legend)

interface ProjectAnalyticsModalProps {
  project: Project
  tasks: TaskEntity[]
  statusColumns: ProjectStatusColumn[]
  agents: Agent[]
  onClose: () => void
}

type TabId = 'overview' | 'status' | 'workload' | 'timeline'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'status', label: 'Status' },
  { id: 'workload', label: 'Workload' },
  { id: 'timeline', label: 'Timeline' }
]

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function chartTextColor() {
  return cssVar('--omc-text-muted', '#7284a4')
}

function chartGridColor() {
  return cssVar('--omc-border-subtle', '#edf2fa')
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: chartTextColor(),
          boxWidth: 10,
          usePointStyle: true
        }
      },
      tooltip: {
        backgroundColor: cssVar('--omc-surface-raised', '#ffffff'),
        titleColor: cssVar('--omc-text-strong', '#17233a'),
        bodyColor: cssVar('--omc-text', '#1f2a3f'),
        borderColor: cssVar('--omc-border', '#d7deea'),
        borderWidth: 1
      }
    },
    scales: {
      x: {
        ticks: { color: chartTextColor() },
        grid: { color: chartGridColor() }
      },
      y: {
        beginAtZero: true,
        ticks: { color: chartTextColor(), precision: 0 },
        grid: { color: chartGridColor() }
      }
    }
  }
}

function doughnutOptions() {
  return {
    ...chartOptions(),
    cutout: '64%',
    scales: undefined
  }
}

function KpiCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string | number; hint: string }) {
  return (
    <article className={styles.kpiCard}>
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </article>
  )
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.emptyState}>
      <LuActivity size={22} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

function BucketList({ rows }: { rows: AnalyticsBucket[] }) {
  if (!rows.length) return <EmptyState title="No breakdown yet" text="Add tasks or metadata to populate this report." />
  return (
    <div className={styles.bucketList}>
      {rows.map((row) => (
        <div key={row.key} className={styles.bucketRow}>
          <span className={styles.bucketSwatch} style={{ background: row.color }} />
          <div>
            <strong>{row.label}</strong>
            <i><b style={{ width: `${Math.max(row.percent, row.count > 0 ? 4 : 0)}%`, background: row.color }} /></i>
          </div>
          <em>{row.count}</em>
        </div>
      ))}
    </div>
  )
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.chartPanel}>
      <h3>{title}</h3>
      <div className={styles.chartFrame}>{children}</div>
    </section>
  )
}

export function ProjectAnalyticsModal({ project, tasks, statusColumns, agents, onClose }: ProjectAnalyticsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const model = useMemo(() => buildProjectAnalyticsModel(tasks, statusColumns, agents), [agents, statusColumns, tasks])
  const options = useMemo(() => chartOptions(), [])
  const donutOptions = useMemo(() => doughnutOptions(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const statusData = {
    labels: model.statusBuckets.map((row) => row.label),
    datasets: [{
      data: model.statusBuckets.map((row) => row.count),
      backgroundColor: model.statusBuckets.map((row) => row.color),
      borderWidth: 0
    }]
  }
  const categoryData = {
    labels: model.categoryBuckets.map((row) => row.label),
    datasets: [{
      label: 'Tasks',
      data: model.categoryBuckets.map((row) => row.count),
      backgroundColor: model.categoryBuckets.map((row) => row.color),
      borderRadius: 8
    }]
  }
  const timelineData = {
    labels: model.timeline.map((point) => point.label),
    datasets: [
      {
        label: 'Created',
        data: model.timeline.map((point) => point.created),
        borderColor: cssVar('--omc-primary', '#2f80ed'),
        backgroundColor: 'rgba(47, 128, 237, 0.14)',
        fill: true,
        tension: 0.32
      },
      {
        label: 'Completed',
        data: model.timeline.map((point) => point.completed),
        borderColor: cssVar('--omc-success', '#29b764'),
        backgroundColor: 'rgba(41, 183, 100, 0.12)',
        fill: true,
        tension: 0.32
      }
    ]
  }
  const dueData = {
    labels: model.dueBuckets.map((row) => row.label),
    datasets: [{
      label: 'Subtasks',
      data: model.dueBuckets.map((row) => row.count),
      backgroundColor: model.dueBuckets.map((row) => row.color),
      borderRadius: 8
    }]
  }

  return (
    <>
      <div className={styles.backdrop} onMouseDown={onClose} />
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={`${project.name} analytics`}>
        <header className={styles.header}>
          <div>
            <span>Project analytics</span>
            <h2>{project.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close analytics">
            <LuX size={18} />
          </button>
        </header>
        <nav className={styles.tabs} aria-label="Analytics views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? styles.tabActive : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className={styles.body}>
          {model.totalTasks === 0 ? (
            <EmptyState title="No tasks to analyze" text="Create project tasks to unlock status, workload, and timeline reports." />
          ) : null}

          {activeTab === 'overview' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.kpiGrid}>
                <KpiCard icon={<LuCircleDot size={18} />} label="Total tasks" value={model.totalTasks} hint={`${model.activeTasks} currently active`} />
                <KpiCard icon={<LuCircleCheck size={18} />} label="Completion" value={`${model.completionRate}%`} hint={`${model.completedTasks} done or closed`} />
                <KpiCard icon={<LuClock3 size={18} />} label="Needs attention" value={model.reviewTasks + model.staleTasks} hint={`${model.reviewTasks} review, ${model.staleTasks} stale`} />
                <KpiCard icon={<LuActivity size={18} />} label="Subtask progress" value={`${model.completedSubtasks}/${model.totalSubtasks}`} hint="Completed subtasks" />
              </div>
              <div className={styles.twoColumn}>
                <ChartPanel title="Status distribution">
                  <Doughnut data={statusData} options={donutOptions} />
                </ChartPanel>
                <ChartPanel title="Project flow">
                  <Bar data={categoryData} options={options} />
                </ChartPanel>
              </div>
            </div>
          ) : null}

          {activeTab === 'status' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.twoColumn}>
                <ChartPanel title="Task status">
                  <Doughnut data={statusData} options={donutOptions} />
                </ChartPanel>
                <section className={styles.reportPanel}>
                  <h3>Status detail</h3>
                  <BucketList rows={model.statusBuckets} />
                </section>
              </div>
              <div className={styles.twoColumn}>
                <ChartPanel title="Subtask status">
                  {model.totalSubtasks > 0 ? (
                    <Bar
                      data={{
                        labels: model.subtaskStatusBuckets.map((row) => row.label),
                        datasets: [{ label: 'Subtasks', data: model.subtaskStatusBuckets.map((row) => row.count), backgroundColor: model.subtaskStatusBuckets.map((row) => row.color), borderRadius: 8 }]
                      }}
                      options={options}
                    />
                  ) : <EmptyState title="No subtasks yet" text="Subtask status analytics will appear after subtasks are added." />}
                </ChartPanel>
                <section className={styles.reportPanel}>
                  <h3>Health signals</h3>
                  <div className={styles.signalGrid}>
                    <span><b>{model.activeTasks}</b> active tasks</span>
                    <span><b>{model.reviewTasks}</b> review tasks</span>
                    <span><b>{model.staleTasks}</b> stale open tasks</span>
                    <span><b>{model.completedTasks}</b> completed tasks</span>
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {activeTab === 'workload' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.twoColumn}>
                <section className={styles.reportPanel}>
                  <h3><LuUsers size={16} /> Agent workload</h3>
                  <BucketList rows={model.agentBuckets} />
                </section>
                <section className={styles.reportPanel}>
                  <h3><LuTags size={16} /> Tags</h3>
                  <BucketList rows={model.tagBuckets} />
                </section>
              </div>
            </div>
          ) : null}

          {activeTab === 'timeline' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.twoColumn}>
                <ChartPanel title="14-day task movement">
                  <Line data={timelineData} options={options} />
                </ChartPanel>
                <ChartPanel title="Subtask due dates">
                  {model.totalSubtasks > 0 ? <Bar data={dueData} options={options} /> : <EmptyState title="No due dates yet" text="Add dated subtasks to see schedule risk." />}
                </ChartPanel>
              </div>
              <section className={styles.reportPanel}>
                <h3><LuCalendarClock size={16} /> Recent cadence</h3>
                <div className={styles.timelineRows}>
                  {model.timeline.slice(-7).map((point) => (
                    <span key={point.label}>
                      <strong>{point.label}</strong>
                      <em>{point.created} created</em>
                      <em>{point.completed} completed</em>
                    </span>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}

export default ProjectAnalyticsModal
