import { useCallback } from 'react'
import type { ChatAttachmentDraft } from '../types'
import type { ProjectDetailStateBindings } from './state/projectDetailState'

export interface TaskMutationContext {
  state: Pick<
    ProjectDetailStateBindings,
    | 'setBusy'
    | 'setError'
    | 'setIsAddSubtaskOpen'
    | 'setSubtaskRows'
    | 'setChecklistRows'
    | 'setSubtaskStatusMenu'
    | 'setIsTaskImportOpen'
    | 'setIsCustomFieldModalOpen'
    | 'setIsCreateCustomFieldOpen'
    | 'setSelectedCustomFieldOption'
    | 'setCustomFieldDraft'
    | 'setCustomFieldError'
    | 'setIsCreateOutputFormatOpen'
    | 'setOutputFormatDraftOption'
    | 'setQuickOutputFormatName'
    | 'setQuickOutputFormatDescription'
    | 'setQuickFieldName'
    | 'setQuickFieldType'
    | 'setChatAttachments'
    | 'setSubtaskDraft'
    | 'setChecklistDraft'
  >
}

export interface TaskMutationHandlers {
  openSubtaskCreate: () => void
  closeSubtaskCreate: () => void
  openChecklistCreate: () => void
  openTaskImport: () => void
  openCustomFieldEditor: () => void
  openOutputFormatEditor: () => void
  updateChatAttachments: (next: ChatAttachmentDraft[]) => void
  clearError: () => void
}

export function useProjectTaskMutations({ state }: TaskMutationContext): TaskMutationHandlers {
  const {
    setBusy,
    setError,
    setIsAddSubtaskOpen,
    setSubtaskRows,
    setChecklistRows,
    setSubtaskStatusMenu,
    setIsTaskImportOpen,
    setIsCustomFieldModalOpen,
    setIsCreateCustomFieldOpen,
    setSelectedCustomFieldOption,
    setCustomFieldDraft,
    setCustomFieldError,
    setIsCreateOutputFormatOpen,
    setOutputFormatDraftOption,
    setQuickOutputFormatName,
    setQuickOutputFormatDescription,
    setQuickFieldName,
    setQuickFieldType,
    setChatAttachments,
    setSubtaskDraft,
    setChecklistDraft
  } = state

  const openSubtaskCreate = useCallback(() => {
    setIsAddSubtaskOpen(true)
  }, [setIsAddSubtaskOpen])

  const closeSubtaskCreate = useCallback(() => {
    setIsAddSubtaskOpen(false)
    setSubtaskRows([{ id: crypto.randomUUID?.() ?? String(Date.now()), title: '' }])
    setSubtaskStatusMenu(null)
  }, [setIsAddSubtaskOpen, setSubtaskRows, setSubtaskStatusMenu])

  const openChecklistCreate = useCallback(() => {
    setChecklistRows([{ id: crypto.randomUUID?.() ?? String(Date.now()), title: '' }])
    setChecklistDraft('')
  }, [setChecklistRows, setChecklistDraft])

  const openTaskImport = useCallback(() => {
    setIsTaskImportOpen(true)
  }, [setIsTaskImportOpen])

  const openCustomFieldEditor = useCallback(() => {
    setIsCustomFieldModalOpen(true)
    setIsCreateCustomFieldOpen(false)
    setSelectedCustomFieldOption(null)
    setCustomFieldDraft('')
    setCustomFieldError(null)
  }, [
    setIsCustomFieldModalOpen,
    setIsCreateCustomFieldOpen,
    setSelectedCustomFieldOption,
    setCustomFieldDraft,
    setCustomFieldError
  ])

  const openOutputFormatEditor = useCallback(() => {
    setIsCreateOutputFormatOpen(true)
    setOutputFormatDraftOption(null)
    setQuickOutputFormatName('')
    setQuickOutputFormatDescription('')
  }, [
    setIsCreateOutputFormatOpen,
    setOutputFormatDraftOption,
    setQuickOutputFormatName,
    setQuickOutputFormatDescription
  ])

  const updateChatAttachments = useCallback(
    (next: ChatAttachmentDraft[]) => {
      setChatAttachments(next)
      setBusy(false)
    },
    [setChatAttachments, setBusy]
  )

  const clearError = useCallback(() => {
    setError(null)
    setQuickFieldName('')
    setQuickFieldType('text')
    setSubtaskDraft('')
  }, [setError, setQuickFieldName, setQuickFieldType, setSubtaskDraft])

  return {
    openSubtaskCreate,
    closeSubtaskCreate,
    openChecklistCreate,
    openTaskImport,
    openCustomFieldEditor,
    openOutputFormatEditor,
    updateChatAttachments,
    clearError
  }
}
