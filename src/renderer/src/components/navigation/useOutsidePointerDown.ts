import { useEffect, type RefObject } from 'react'

export function useOutsidePointerDown(
  enabled: boolean,
  ref: RefObject<HTMLElement | null>,
  onOutsidePointerDown: () => void
): void {
  useEffect(() => {
    if (!enabled) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target)) return
      onOutsidePointerDown()
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [enabled, onOutsidePointerDown, ref])
}
