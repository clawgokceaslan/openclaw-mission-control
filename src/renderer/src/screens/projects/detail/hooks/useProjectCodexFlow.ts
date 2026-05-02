import { useCallback } from 'react'
import type { ChatAttachmentDraft } from '../types'
import type { ProjectDetailStateBindings } from './state/projectDetailState'

export interface ProjectCodexContext {
  state: Pick<
    ProjectDetailStateBindings,
    | 'setCodexRunLaunching'
    | 'setCodexPlanLaunching'
    | 'setCodexRunFeedback'
    | 'setChatDraft'
    | 'setChatSending'
    | 'setChatStopping'
    | 'setError'
    | 'setIsStartingNewChat'
    | 'setChatComposerFocused'
    | 'setSlashCommandIndex'
    | 'setChatDragDepth'
    | 'setBusy'
  >
}

export interface UseProjectCodexFlowResult {
  run: (taskId: string) => void
  plan: (taskId: string) => void
  stop: () => void
  resetDraft: () => void
  setDraft: (next: string) => void
  setSending: (value: boolean) => void
  setAttachments: (next: ChatAttachmentDraft[]) => void
}

export function useProjectCodexFlow({ state }: ProjectCodexContext): UseProjectCodexFlowResult {
  const {
    setCodexRunLaunching,
    setCodexPlanLaunching,
    setCodexRunFeedback,
    setChatDraft,
    setChatSending,
    setChatStopping,
    setError,
    setIsStartingNewChat,
    setChatComposerFocused,
    setSlashCommandIndex,
    setChatDragDepth,
    setBusy
  } = state

  const run = useCallback(
    (taskId: string) => {
      if (!taskId) return
      setError(null)
      setCodexRunFeedback(null)
      setCodexRunLaunching(true)
      setCodexPlanLaunching(false)
      setBusy(false)
    },
    [setError, setCodexRunFeedback, setCodexRunLaunching, setCodexPlanLaunching, setBusy]
  )

  const plan = useCallback(
    (taskId: string) => {
      if (!taskId) return
      setError(null)
      setCodexRunFeedback(null)
      setCodexPlanLaunching(true)
      setCodexRunLaunching(false)
      setBusy(false)
    },
    [setError, setCodexRunFeedback, setCodexPlanLaunching, setCodexRunLaunching, setBusy]
  )

  const stop = useCallback(() => {
    setChatStopping(true)
    setCodexRunLaunching(false)
    setCodexPlanLaunching(false)
    setBusy(false)
    setSlashCommandIndex(0)
    setChatDragDepth(0)
  }, [setChatStopping, setCodexRunLaunching, setCodexPlanLaunching, setBusy, setSlashCommandIndex, setChatDragDepth])

  const resetDraft = useCallback(() => {
    setChatDraft('')
    setIsStartingNewChat(false)
    setChatComposerFocused(false)
    setChatSending(false)
  }, [setChatDraft, setIsStartingNewChat, setChatComposerFocused, setChatSending])

  const setDraft = useCallback(
    (next: string) => {
      setChatDraft(next)
    },
    [setChatDraft]
  )

  const setSending = useCallback(
    (value: boolean) => {
      setChatSending(value)
    },
    [setChatSending]
  )

  const setAttachments = useCallback(
    (_next: ChatAttachmentDraft[]) => {
      setError(null)
    },
    [setError]
  )

  return {
    run,
    plan,
    stop,
    resetDraft,
    setDraft,
    setSending,
    setAttachments
  }
}
