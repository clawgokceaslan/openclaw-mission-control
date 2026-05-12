import { useEffect, useRef } from 'react'
import { subscribeToChannel, unsubscribeFromChannel } from '@renderer/utils/api'

export function useDebouncedEventRefresh(
  channels: string[],
  refresh: () => void | Promise<void>,
  options: { delay?: number; enabled?: boolean; filter?: (payload: unknown, channel: string) => boolean } = {}
): void {
  const { delay = 180, enabled = true, filter } = options
  const refreshRef = useRef(refresh)
  const filterRef = useRef(filter)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  useEffect(() => {
    if (!enabled || channels.length === 0) return undefined
    const uniqueChannels = Array.from(new Set(channels))
    const listener = (...args: unknown[]) => {
      const channel = typeof args[0] === 'string' && args.length > 1 ? args[0] : ''
      const payload = (args[1] ?? args[0]) as unknown
      if (filterRef.current && !filterRef.current(payload, channel)) return
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void refreshRef.current()
      }, delay)
    }
    for (const channel of uniqueChannels) subscribeToChannel(channel, listener)
    return () => {
      for (const channel of uniqueChannels) unsubscribeFromChannel(channel, listener)
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [channels.join('\n'), delay, enabled])
}
