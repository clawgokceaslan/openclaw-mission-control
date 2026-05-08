import { afterEach, describe, expect, it } from 'vitest'
import { automationQueueSnapshot, enqueueAutomationQueue, resetAutomationQueueForTests } from './automationQueueCoordinator'

describe('automationQueueCoordinator', () => {
  afterEach(() => {
    resetAutomationQueueForTests()
  })

  it('keeps plan lane serial while run lane can progress independently', async () => {
    const events: string[] = []
    let releasePlan: (() => void) | null = null
    let releaseRun: (() => void) | null = null

    const firstPlan = enqueueAutomationQueue('plan', async () => {
      events.push('plan-1-start')
      await new Promise<void>((resolve) => {
        releasePlan = resolve
      })
      events.push('plan-1-end')
    })
    const secondPlan = enqueueAutomationQueue('plan', async () => {
      events.push('plan-2-start')
    })
    const firstRun = enqueueAutomationQueue('run', async () => {
      events.push('run-1-start')
      await new Promise<void>((resolve) => {
        releaseRun = resolve
      })
      events.push('run-1-end')
    })

    await Promise.resolve()
    expect(events).toEqual(['plan-1-start', 'run-1-start'])
    expect(automationQueueSnapshot().active.plan?.id).toBe(firstPlan.id)
    expect(automationQueueSnapshot().active.run?.id).toBe(firstRun.id)
    expect(automationQueueSnapshot().pending.plan).toHaveLength(1)

    releasePlan?.()
    await firstPlan.promise
    await secondPlan.promise
    releaseRun?.()
    await firstRun.promise
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events).toEqual(['plan-1-start', 'run-1-start', 'plan-1-end', 'plan-2-start', 'run-1-end'])
    expect(automationQueueSnapshot().active.plan).toBeNull()
    expect(automationQueueSnapshot().active.run).toBeNull()
  })
})
