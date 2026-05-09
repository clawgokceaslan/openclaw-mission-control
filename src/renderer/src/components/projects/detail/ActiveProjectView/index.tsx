import type { DragEvent } from 'react'
import { ProjectBoardView } from '@renderer/components/projects/detail/ProjectBoardView'
import type { Agent, TaskEntity } from '@shared/types/entities'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import type { TaskDropPosition } from '@renderer/screens/projects/detail/projectDetailUtils'

export interface ActiveProjectViewProps {
  statusColumns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
  agents: Agent[]
  onDropStatus: (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => void
  onReorder: (sourceTaskId: string, targetTaskId: string, position: TaskDropPosition) => void
  onOpenTask: (taskId: string) => void
  onOpenSubtask: (taskId: string, subtaskId: string) => void
  onOpenCreateTask: (status: TaskEntity['status']) => void
}

export function ActiveProjectView({
  statusColumns,
  tasksByStatus,
  agents,
  onDropStatus,
  onReorder,
  onOpenTask,
  onOpenSubtask,
  onOpenCreateTask
}: ActiveProjectViewProps) {
  return (
    <ProjectBoardView
      columns={statusColumns}
      tasksByStatus={tasksByStatus}
      agents={agents}
      onDropStatus={onDropStatus}
      onReorder={(sourceTaskId, targetTaskId, position) => void onReorder(sourceTaskId, targetTaskId, position)}
      onOpenTask={onOpenTask}
      onOpenSubtask={onOpenSubtask}
      onOpenCreateTask={onOpenCreateTask}
    />
  )
}
