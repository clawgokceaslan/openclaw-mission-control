import type { EventEmitter } from 'node:events'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc.js'
import { JobRepository } from '../../../db/repositories/job-repo.js'

export class JobScheduler {
  private timer?: NodeJS.Timeout
  private running = false
  private runningTypes = new Set<string>()

  constructor(
    private readonly jobRepository: JobRepository,
    private readonly eventBus: EventEmitter,
    private readonly tickMs = 1500
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.eventBus.emit(IPC_CHANNELS.events.jobProgress, {
          type: 'scheduler-error',
          error: error instanceof Error ? error.message : String(error),
          at: Date.now()
        })
      })
    }, this.tickMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const due = await this.jobRepository.listDue(Date.now())
      for (const job of due.slice(0, 10)) {
        void this.process(job.id, job.type)
      }
    } finally {
      this.running = false
    }
  }

  private async process(jobId: string, type: string): Promise<void> {
    if (this.runningTypes.has(type)) {
      return
    }
    this.runningTypes.add(type)

    await this.jobRepository.markRunning(jobId)
    const startAt = Date.now()
    try {
      if (type === 'gateway.reconnect') {
        await this.sleep(300)
      }
      if (type === 'webhook.delivery') {
        await this.sleep(200)
      }
      await this.jobRepository.markDone(jobId)
      this.eventBus.emit(IPC_CHANNELS.events.jobProgress, { jobId, type, status: 'done', at: Date.now() })
    } catch (error) {
      const state = await this.jobRepository.get(jobId)
      const attempts = (state?.attempts ?? 0) + 1
      const canRetry = attempts < (state?.maxAttempts ?? 5)
      const nextRunAt = startAt + this.getRetryDelayMs(attempts)
      const result = await this.jobRepository.markFailed(
        jobId,
        error instanceof Error ? error.message : String(error),
        nextRunAt,
        canRetry
      )
      this.eventBus.emit(IPC_CHANNELS.events.jobProgress, {
        jobId,
        type,
        status: result.status,
        attempts: result.attempts,
        error: error instanceof Error ? error.message : String(error),
        at: Date.now()
      })
    } finally {
      this.runningTypes.delete(type)
    }
  }

  private getRetryDelayMs(attempts: number): number {
    const cappedAttempts = Math.max(1, attempts)
    const baseDelay = 800
    const maxDelay = 10_000
    const exponential = baseDelay * 2 ** (cappedAttempts - 1)
    return Math.min(maxDelay, exponential)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
