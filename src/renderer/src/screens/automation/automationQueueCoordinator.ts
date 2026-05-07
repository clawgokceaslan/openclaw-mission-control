type AutomationQueueType = 'plan' | 'run'

type AutomationQueueJob<T> = {
  id: string
  type: AutomationQueueType
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

let activeJob: AutomationQueueJob<unknown> | null = null
const pendingJobs: AutomationQueueJob<unknown>[] = []
const listeners = new Set<() => void>()

function createJobId(type: AutomationQueueType): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function notifyListeners() {
  listeners.forEach((listener) => listener())
}

function runNextJob() {
  if (activeJob || pendingJobs.length === 0) {
    notifyListeners()
    return
  }

  activeJob = pendingJobs.shift() ?? null
  notifyListeners()
  if (!activeJob) return

  const job = activeJob
  job.execute()
    .then(job.resolve)
    .catch(job.reject)
    .finally(() => {
      if (activeJob?.id === job.id) activeJob = null
      runNextJob()
    })
}

export function enqueueAutomationQueue<T>(type: AutomationQueueType, execute: () => Promise<T>): { id: string; promise: Promise<T> } {
  const id = createJobId(type)
  const promise = new Promise<T>((resolve, reject) => {
    pendingJobs.push({ id, type, execute, resolve, reject } as AutomationQueueJob<unknown>)
  })
  runNextJob()
  return { id, promise }
}

export function automationQueueSnapshot() {
  return {
    active: activeJob ? { id: activeJob.id, type: activeJob.type } : null,
    pending: pendingJobs.map((job) => ({ id: job.id, type: job.type }))
  }
}

export function subscribeAutomationQueue(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
