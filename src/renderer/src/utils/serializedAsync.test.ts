import { describe, expect, it } from 'vitest'
import { createSerializedAsyncRunner } from './serializedAsync'

describe('createSerializedAsyncRunner', () => {
  it('keeps one in-flight run and coalesces overlapping calls into one pending run', async () => {
    const calls: number[] = []
    let releaseFirst: (() => void) | null = null
    const runner = createSerializedAsyncRunner(async (value: number) => {
      calls.push(value)
      if (value === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
    })

    const first = runner(1)
    const second = runner(2)
    const third = runner(3)

    expect(calls).toEqual([1])
    releaseFirst?.()
    await Promise.all([first, second, third])

    expect(calls).toEqual([1, 3])
  })
})
