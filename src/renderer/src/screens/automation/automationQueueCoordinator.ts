type AutomationQueueType = 'plan' | 'run'

type AutomationQueueJob<T> = {
  id: string
  type: AutomationQueueType
  execute: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const activeJobs: Record<AutomationQueueType, AutomationQueueJob<unknown> | null> = {
  plan: null,
  run: null
}
const pendingJobs: Record<AutomationQueueType, AutomationQueueJob<unknown>[]> = {
  plan: [],
  run: []
}
const listeners = new Set<() => void>()

function createJobId(type: AutomationQueueType): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function notifyListeners() {
  listeners.forEach((listener) => listener())
}

function runNextJob(type: AutomationQueueType) {
  if (activeJobs[type] || pendingJobs[type].length === 0) {
    notifyListeners()
    return
  }

  activeJobs[type] = pendingJobs[type].shift() ?? null
  notifyListeners()
  if (!activeJobs[type]) return

  const job = activeJobs[type]
  job.execute()
    .then(job.resolve)
    .catch(job.reject)
    .finally(() => {
      if (activeJobs[type]?.id === job.id) activeJobs[type] = null
      runNextJob(type)
    })
}

export function enqueueAutomationQueue<T>(type: AutomationQueueType, execute: () => Promise<T>): { id: string; promise: Promise<T> } {
  const id = createJobId(type)
  const promise = new Promise<T>((resolve, reject) => {
    pendingJobs[type].push({ id, type, execute, resolve, reject } as AutomationQueueJob<unknown>)
  })
  runNextJob(type)
  return { id, promise }
}

export function automationQueueSnapshot() {
  return {
    active: {
      plan: activeJobs.plan ? { id: activeJobs.plan.id, type: activeJobs.plan.type } : null,
      run: activeJobs.run ? { id: activeJobs.run.id, type: activeJobs.run.type } : null
    },
    pending: {
      plan: pendingJobs.plan.map((job) => ({ id: job.id, type: job.type })),
      run: pendingJobs.run.map((job) => ({ id: job.id, type: job.type }))
    }
  }
}

export function subscribeAutomationQueue(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetAutomationQueueForTests() {
  activeJobs.plan = null
  activeJobs.run = null
  pendingJobs.plan = []
  pendingJobs.run = []
  listeners.clear()
}
