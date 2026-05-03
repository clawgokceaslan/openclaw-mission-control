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
import {
  LuActivity,
  LuCalendarClock,
  LuCircleAlert,
  LuCircleCheck,
  LuCircleDot,
  LuClock3,
  LuFlag,
  LuHeartPulse,
  LuMessageSquare,
  LuSquareCheck,
  LuTags,
  LuUsers,
  LuX
} from 'react-icons/lu'
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

type TabId = 'overview' | 'progress' | 'workload' | 'timeline' | 'activity' | 'health'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'progress', label: 'Progress' },
  { id: 'workload', label: 'Workload' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'activity', label: 'Activity' },
  { id: 'health', label: 'Health' }
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

function horizontalBarOptions() {
  return {
    ...chartOptions(),
    indexAxis: 'y' as const
  }
}

function bucketChartData(rows: AnalyticsBucket[], label: string) {
  return {
    labels: rows.map((row) => row.label),
    datasets: [{
      label,
      data: rows.map((row) => row.count),
      backgroundColor: rows.map((row) => row.color),
      borderRadius: 8,
      maxBarThickness: 36
    }]
  }
}

function KpiCard({ icon, label, value, hint, tone = 'neutral' }: { icon: React.ReactNode; label: string; value: string | number; hint: string; tone?: 'neutral' | 'good' | 'warn' | 'risk' }) {
  return (
    <article className={`${styles.kpiCard} ${styles[`kpiCard_${tone}`]}`}>
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

function ChartPanel({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) {
  return (
    <section className={styles.chartPanel}>
      <header className={styles.panelHeader}>
        <h3>{title}</h3>
        {summary ? <span>{summary}</span> : null}
      </header>
      <div className={styles.chartFrame}>{children}</div>
    </section>
  )
}

export function ProjectAnalyticsModal({ project, tasks, statusColumns, agents, onClose }: ProjectAnalyticsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const model = useMemo(() => buildProjectAnalyticsModel(tasks, statusColumns, agents), [agents, statusColumns, tasks])
  const options = useMemo(() => chartOptions(), [])
  const donutOptions = useMemo(() => doughnutOptions(), [])
  const horizontalOptions = useMemo(() => horizontalBarOptions(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tabIndex: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (tabIndex + direction + TABS.length) % TABS.length
    setActiveTab(TABS[nextIndex].id)
    event.currentTarget.parentElement?.querySelectorAll('button')[nextIndex]?.focus()
  }

  const chartData = useMemo(() => {
    const statusData = {
      labels: model.statusBuckets.map((row) => row.label),
      datasets: [{
        data: model.statusBuckets.map((row) => row.count),
        backgroundColor: model.statusBuckets.map((row) => row.color),
        borderWidth: 0
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
        },
        {
          label: 'Comments',
          data: model.timeline.map((point) => point.comments),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fill: false,
          tension: 0.32
        }
      ]
    }
    return {
      status: statusData,
      categories: bucketChartData(model.categoryBuckets, 'Tasks'),
      agents: bucketChartData(model.agentBuckets, 'Tasks'),
      tags: bucketChartData(model.tagBuckets, 'Tags'),
      subtasks: bucketChartData(model.subtaskStatusBuckets, 'Subtasks'),
      checklist: bucketChartData(model.checklistBuckets, 'Checklist items'),
      priority: bucketChartData(model.priorityBuckets, 'Tasks'),
      ages: bucketChartData(model.ageBuckets, 'Tasks'),
      comments: bucketChartData(model.commentBuckets, 'Tasks'),
      health: bucketChartData(model.healthBuckets, 'Signals'),
      due: bucketChartData(model.dueBuckets, 'Subtasks'),
      timeline: timelineData
    }
  }, [model])

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
          {TABS.map((tab, tabIndex) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? styles.tabActive : undefined}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, tabIndex)}
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
                <KpiCard icon={<LuCircleCheck size={18} />} label="Completion" value={`${model.completionRate}%`} hint={`${model.completedTasks} done or closed`} tone="good" />
                <KpiCard icon={<LuClock3 size={18} />} label="Needs attention" value={model.reviewTasks + model.staleTasks + model.overdueSubtasks} hint={`${model.reviewTasks} review, ${model.staleTasks} stale, ${model.overdueSubtasks} overdue`} tone={model.reviewTasks + model.staleTasks + model.overdueSubtasks > 0 ? 'risk' : 'good'} />
                <KpiCard icon={<LuActivity size={18} />} label="Subtask progress" value={`${model.subtaskCompletionRate}%`} hint={`${model.completedSubtasks}/${model.totalSubtasks} completed`} />
              </div>
              <div className={styles.twoColumn}>
                <ChartPanel title="Status distribution" summary={`${model.statusBuckets.length} statuses`}>
                  <Doughnut data={chartData.status} options={donutOptions} />
                </ChartPanel>
                <ChartPanel title="Project flow" summary={`${model.completionRate}% complete`}>
                  <Bar data={chartData.categories} options={options} />
                </ChartPanel>
              </div>
            </div>
          ) : null}

          {activeTab === 'progress' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.twoColumn}>
                <ChartPanel title="Task status" summary={`${model.completedTasks}/${model.totalTasks} finished`}>
                  <Doughnut data={chartData.status} options={donutOptions} />
                </ChartPanel>
                <section className={styles.reportPanel}>
                  <h3>Status detail</h3>
                  <BucketList rows={model.statusBuckets} />
                </section>
              </div>
              <div className={styles.twoColumn}>
                <ChartPanel title="Subtask status" summary={`${model.subtaskCompletionRate}% complete`}>
                  {model.totalSubtasks > 0 ? (
                    <Bar data={chartData.subtasks} options={horizontalOptions} />
                  ) : <EmptyState title="No subtasks yet" text="Subtask status analytics will appear after subtasks are added." />}
                </ChartPanel>
                <ChartPanel title="Checklist completion" summary={`${model.checklistCompletionRate}% checked`}>
                  {model.totalChecklistItems > 0 ? <Doughnut data={chartData.checklist} options={donutOptions} /> : <EmptyState title="No checklist items" text="Checklist progress appears after tasks include checklist items." />}
                </ChartPanel>
              </div>
            </div>
          ) : null}

          {activeTab === 'workload' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.twoColumn}>
                <ChartPanel title="Agent workload" summary={`${model.unassignedTasks} unassigned`}>
                  <Bar data={chartData.agents} options={horizontalOptions} />
                </ChartPanel>
                <ChartPanel title="Priority mix" summary={`${model.priorityBuckets.find((row) => row.key === 'high')?.count ?? 0} high`}>
                  <Doughnut data={chartData.priority} options={donutOptions} />
                </ChartPanel>
              </div>
              <div className={styles.twoColumn}>
                <section className={styles.reportPanel}><h3><LuUsers size={16} /> Agent detail</h3><BucketList rows={model.agentBuckets} /></section>
                <section className={styles.reportPanel}><h3><LuTags size={16} /> Tag distribution</h3><BucketList rows={model.tagBuckets} /></section>
              </div>
            </div>
          ) : null}

          {activeTab === 'timeline' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.twoColumn}>
                <ChartPanel title="14-day task movement" summary="Created, completed, comments">
                  <Line data={chartData.timeline} options={options} />
                </ChartPanel>
                <ChartPanel title="Task age" summary={`${model.staleTasks} stale open`}>
                  <Bar data={chartData.ages} options={options} />
                </ChartPanel>
              </div>
              <ChartPanel title="Subtask due dates" summary={`${model.overdueSubtasks} overdue, ${model.dueSoonSubtasks} due soon`}>
                {model.totalSubtasks > 0 ? <Bar data={chartData.due} options={options} /> : <EmptyState title="No due dates yet" text="Add dated subtasks to see schedule risk." />}
              </ChartPanel>
              <section className={styles.reportPanel}>
                <h3><LuCalendarClock size={16} /> Recent cadence</h3>
                <div className={styles.timelineRows}>
                  {model.timeline.slice(-7).map((point) => (
                    <span key={point.label}>
                      <strong>{point.label}</strong>
                      <em>{point.created} created</em>
                      <em>{point.completed} completed</em>
                      <em>{point.comments} comments</em>
                    </span>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === 'activity' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.kpiGrid}>
                <KpiCard icon={<LuMessageSquare size={18} />} label="Comments" value={model.totalComments} hint={`${model.tasksWithComments} tasks have discussion`} />
                <KpiCard icon={<LuSquareCheck size={18} />} label="Checklist" value={`${model.completedChecklistItems}/${model.totalChecklistItems}`} hint="Checked items" />
                <KpiCard icon={<LuTags size={18} />} label="Tags" value={model.tagBuckets.length} hint="Top tag groups" />
                <KpiCard icon={<LuFlag size={18} />} label="High priority" value={model.priorityBuckets.find((row) => row.key === 'high')?.count ?? 0} hint="Detected from fields" tone="warn" />
              </div>
              <div className={styles.twoColumn}>
                <ChartPanel title="Comment intensity" summary={`${model.totalComments} total comments`}>
                  <Doughnut data={chartData.comments} options={donutOptions} />
                </ChartPanel>
                <ChartPanel title="Tag usage" summary={`${model.tagBuckets.reduce((sum, row) => sum + row.count, 0)} tag assignments`}>
                  {model.tagBuckets.length > 0 ? <Bar data={chartData.tags} options={horizontalOptions} /> : <EmptyState title="No tags yet" text="Assign tags to tasks to compare project themes." />}
                </ChartPanel>
              </div>
            </div>
          ) : null}

          {activeTab === 'health' && model.totalTasks > 0 ? (
            <div className={styles.view}>
              <div className={styles.kpiGrid}>
                <KpiCard icon={<LuHeartPulse size={18} />} label="Steady tasks" value={model.healthBuckets.find((row) => row.key === 'steady')?.count ?? 0} hint="No current risk signal" tone="good" />
                <KpiCard icon={<LuCircleAlert size={18} />} label="Overdue subtasks" value={model.overdueSubtasks} hint="Open subtasks past due" tone={model.overdueSubtasks > 0 ? 'risk' : 'good'} />
                <KpiCard icon={<LuClock3 size={18} />} label="Due soon" value={model.dueSoonSubtasks} hint="Open subtasks in 7 days" tone={model.dueSoonSubtasks > 0 ? 'warn' : 'neutral'} />
                <KpiCard icon={<LuUsers size={18} />} label="Unassigned" value={model.unassignedTasks} hint="Tasks without an agent" />
              </div>
              <div className={styles.twoColumn}>
                <ChartPanel title="Health signals" summary={`${model.reviewTasks + model.staleTasks + model.overdueSubtasks + model.dueSoonSubtasks} signals`}>
                  <Doughnut data={chartData.health} options={donutOptions} />
                </ChartPanel>
                <section className={styles.reportPanel}>
                  <h3><LuHeartPulse size={16} /> Signal detail</h3>
                  <BucketList rows={model.healthBuckets} />
                </section>
              </div>
              <section className={styles.reportPanel}>
                <h3>Operational counters</h3>
                <div className={styles.signalGrid}>
                  <span><b>{model.activeTasks}</b> active tasks</span>
                  <span><b>{model.reviewTasks}</b> review tasks</span>
                  <span><b>{model.staleTasks}</b> stale open tasks</span>
                  <span><b>{model.completedTasks}</b> completed tasks</span>
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
