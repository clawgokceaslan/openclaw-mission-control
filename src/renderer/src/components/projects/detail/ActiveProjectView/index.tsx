import type { DragEvent } from 'react'
import { ProjectBoardView } from '@renderer/components/projects/detail/ProjectBoardView'
import { ProjectListView } from '@renderer/components/projects/detail/ProjectListView'
import { ProjectTableView } from '@renderer/components/projects/detail/ProjectTableView'
import type { Agent, TaskEntity } from '@shared/types/entities'
import type { ProjectStatusColumn } from '@renderer/screens/projects/detail/status'
import type { TableColumnConfig } from '@renderer/screens/projects/detail/types'
import type { CustomField } from '@shared/types/entities'

export interface ActiveProjectViewProps {
  viewMode: 'board' | 'list' | 'table'
  statusColumns: ProjectStatusColumn[]
  tasksByStatus: Record<TaskEntity['status'], TaskEntity[]>
  agents: Agent[]
  onDropStatus: (event: DragEvent<HTMLElement>, status: TaskEntity['status']) => void
  onReorder: (sourceTaskId: string, targetTaskId: string) => void
  onOpenTask: (taskId: string) => void
  onOpenCreateTask: (status: TaskEntity['status']) => void
  onStatusChange?: (taskId: string, status: TaskEntity['status']) => Promise<void> | void
  onToggleStatus?: (status: TaskEntity['status']) => void
  onOpenColumnPicker?: () => void
  onColumnWidthChange?: (columnId: string, width: number) => void
  collapsedStatuses?: TaskEntity['status'][]
  tableTasks?: TaskEntity[]
  tableColumns?: TableColumnConfig[]
  customFields?: CustomField[]
}

export function ActiveProjectView({
  viewMode,
  statusColumns,
  tasksByStatus,
  agents,
  onDropStatus,
  onReorder,
  onOpenTask,
  onOpenCreateTask,
  onStatusChange,
  onToggleStatus,
  onOpenColumnPicker,
  onColumnWidthChange,
  collapsedStatuses = [],
  tableTasks = [],
  tableColumns = [],
  customFields = []
}: ActiveProjectViewProps) {
  if (viewMode === 'board') {
    return (
      <ProjectBoardView
        columns={statusColumns}
        tasksByStatus={tasksByStatus}
        agents={agents}
        onDropStatus={onDropStatus}
        onReorder={(sourceTaskId, targetTaskId) => void onReorder(sourceTaskId, targetTaskId)}
        onOpenTask={onOpenTask}
        onOpenCreateTask={onOpenCreateTask}
      />
    )
  }

  if (viewMode === 'table') {
    return (
      <ProjectTableView
        columns={statusColumns}
        tasks={tableTasks}
        tableColumns={tableColumns}
        customFields={customFields}
        agents={agents}
        onOpenTask={onOpenTask}
        onOpenCreateTask={() => onOpenCreateTask(statusColumns[0]?.status ?? 'pending')}
        onStatusChange={onStatusChange ?? (() => undefined)}
        onReorder={(sourceTaskId, targetTaskId) => void onReorder(sourceTaskId, targetTaskId)}
        onOpenColumnPicker={onOpenColumnPicker ?? (() => undefined)}
        onColumnWidthChange={onColumnWidthChange ?? (() => undefined)}
      />
    )
  }

  return (
    <ProjectListView
      columns={statusColumns}
      tasksByStatus={tasksByStatus}
      agents={agents}
      collapsedStatuses={collapsedStatuses}
      onToggleStatus={onToggleStatus ?? (() => undefined)}
      onOpenTask={onOpenTask}
      onOpenCreateTask={onOpenCreateTask}
      onDropStatus={onDropStatus}
      onReorder={(sourceTaskId, targetTaskId) => void onReorder(sourceTaskId, targetTaskId)}
    />
  )
}
