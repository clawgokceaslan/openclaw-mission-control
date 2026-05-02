import { useCallback } from 'react'
import type { TaskEntity, TaskSubtask } from '@shared/types/entities'
import type { ProjectDetailStateBindings } from './state/projectDetailState'

export interface ProjectSelectionContext {
  state: Pick<ProjectDetailStateBindings, 'selectedTaskId' | 'selectedSubtaskId' | 'setSelectedTaskId' | 'setSelectedSubtaskId' | 'setDetailTab' | 'setDetailViewMode' | 'setIsTitleEditing' | 'setTitleDraft' | 'setIsDescriptionEditing' | 'setDescriptionDraft'>
  tasks: TaskEntity[]
}

export interface ProjectSelectionHandlers {
  selectedTask: TaskEntity | null
  selectedSubtask: TaskSubtask | null
  clearSelection: () => void
  openTask: (taskId: string | null) => void
  openSubtask: (subtaskId: string, taskId?: string) => void
}

export function useProjectSelection({ state, tasks }: ProjectSelectionContext): ProjectSelectionHandlers {
  const {
    selectedTaskId,
    selectedSubtaskId,
    setSelectedTaskId,
    setSelectedSubtaskId,
    setDetailTab,
    setDetailViewMode,
    setIsTitleEditing,
    setTitleDraft,
    setIsDescriptionEditing,
    setDescriptionDraft
  } = state

  const selectedTask = tasks.find((item) => item.id === selectedTaskId) ?? null
  const selectedSubtask = selectedTask?.subtasks?.find((item: TaskSubtask) => item.id === selectedSubtaskId) ?? null

  const clearSelection = useCallback(() => {
    setSelectedTaskId(null)
    setSelectedSubtaskId(null)
    setDetailTab('subtasks')
    setDetailViewMode('task')
    setIsTitleEditing(false)
    setIsDescriptionEditing(false)
    setTitleDraft('')
    setDescriptionDraft('')
  }, [
    setSelectedTaskId,
    setSelectedSubtaskId,
    setDetailTab,
    setDetailViewMode,
    setIsTitleEditing,
    setTitleDraft,
    setIsDescriptionEditing,
    setDescriptionDraft
  ])

  const openTask = useCallback(
    (taskId: string | null) => {
      setSelectedTaskId(taskId)
      if (!taskId) {
        setSelectedSubtaskId(null)
        return
      }
      setSelectedSubtaskId(null)
      setIsTitleEditing(false)
      setIsDescriptionEditing(false)
      setDetailTab('subtasks')
      setDetailViewMode('task')
    },
    [setSelectedTaskId, setSelectedSubtaskId, setIsTitleEditing, setIsDescriptionEditing, setDetailTab, setDetailViewMode]
  )

  const openSubtask = useCallback(
    (subtaskId: string, taskId?: string) => {
      if (taskId) {
        setSelectedTaskId(taskId)
      }
      setSelectedSubtaskId(subtaskId)
      setDetailViewMode('subtask')
    },
    [setSelectedTaskId, setSelectedSubtaskId, setDetailViewMode]
  )

  return {
    selectedTask,
    selectedSubtask,
    clearSelection,
    openTask,
    openSubtask
  }
}
