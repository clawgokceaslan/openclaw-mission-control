import { FormEvent, useEffect, useState } from 'react'
import styles from './ActivityPage.module.scss'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import { invokeBridge, loadList } from '@renderer/utils/api'
import { Job } from '@shared/types/entities'
import { useAuth } from '@renderer/providers/auth/auth-state'

type JobMetric = Record<string, number>

export function ActivityPage() {
  const { token } = useAuth()
  const [status, setStatus] = useState('Yükleniyor...')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [jobs, setJobs] = useState<Job[]>([])
  const [metrics, setMetrics] = useState<JobMetric>({})
  const [error, setError] = useState<string | null>(null)

  const loadJobs = async (filter?: string) => {
    setStatus('Yükleniyor...')
    const response = await loadList<Job[]>(IPC_CHANNELS.jobs.list, token)
    const metricsResponse = await invokeBridge<JobMetric>(IPC_CHANNELS.jobs.metrics, { actorToken: token })

    if (!response.ok) {
      setStatus('Hata')
      setError(response.error?.message ?? 'Aktivite yüklenemedi')
      return
    }

    const rows = Array.isArray(response.data) ? (response.data as Job[]) : []
    const filtered = filter && filter !== 'all' ? rows.filter((row) => row.status === filter) : rows
    setJobs(filtered)
    setMetrics(metricsResponse.ok ? (metricsResponse.data as JobMetric) : {})
    setStatus('Yüklendi')
    setError(null)
  }

  useEffect(() => {
    void loadJobs()
  }, [token])

  const onFilter = (event: FormEvent) => {
    event.preventDefault()
    void loadJobs(statusFilter)
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Activity / Jobs</h1>
      <p className={styles.status}>{status}</p>
      {error && <p className={styles.error}>{error}</p>}
      <form className={styles.form} onSubmit={onFilter}>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Tüm durumlar</option>
          <option value="pending">pending</option>
          <option value="running">running</option>
          <option value="done">done</option>
          <option value="failed">failed</option>
          <option value="dead">dead</option>
        </select>
        <button type="submit">Filtrele</button>
      </form>
      <section className={styles.page}>
        <h2>Job metrikleri</h2>
        <pre>{JSON.stringify(metrics, null, 2)}</pre>
      </section>
      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            {job.type} - {job.status} - {job.attempts}/{job.maxAttempts}
          </li>
        ))}
      </ul>
    </section>
  )
}

