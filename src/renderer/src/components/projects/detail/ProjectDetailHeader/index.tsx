import { LuLayers, LuListPlus, LuMessageSquare, LuPlus, LuRefreshCw, LuSettings2, LuSignal } from 'react-icons/lu'
import type { Project } from '@shared/types/entities'
import { ProjectViewBar } from '../ProjectViewBar'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectDetailHeaderProps {
  project: Project
  taskTitle: string
  busy: boolean
  onTaskTitleChange: (value: string) => void
  onQuickCreate: () => void
  onOpenCreateTask: () => void
  onOpenCreateTaskGroup: () => void
  onOpenTaskPlanner: () => void
  onOpenProjectPrompts: () => void
  onOpenAnalytics: () => void
  onOpenStatusSettings: () => void
  onSyncProject: () => void
  syncDisabled?: boolean
  onBoardSelect: () => void
  recentChatsActive?: boolean
  recentChatsCount?: number
  onRecentChatsSelect?: () => void
}

export function ProjectDetailHeader({
  project,
  taskTitle,
  busy,
  onTaskTitleChange,
  onQuickCreate,
  onOpenCreateTask,
  onOpenCreateTaskGroup,
  onOpenTaskPlanner,
  onOpenProjectPrompts,
  onOpenAnalytics,
  onOpenStatusSettings,
  onSyncProject,
  syncDisabled,
  onBoardSelect,
  recentChatsActive,
  recentChatsCount,
  onRecentChatsSelect
}: ProjectDetailHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        <div>
          <h1 className={styles.title}>{project.name}</h1>
          <p className={styles.subtitle}>{project.description ?? 'Keep tasks moving through your workflow.'}</p>
        </div>
        <div className={styles.headerActions}>
          <input
            value={taskTitle}
            className={styles.quickInput}
            onChange={(event) => onTaskTitleChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onQuickCreate()
              }
            }}
            placeholder="New task"
          />
          <button type="button" className={styles.plusBtn} onClick={onOpenCreateTask} disabled={busy}>
            <LuPlus size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenCreateTaskGroup}
            aria-label="Task grubu oluştur"
            title="Task grubu oluştur"
          >
            <LuLayers size={16} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenTaskPlanner}
            aria-label="Çoklu task oluşturma merkezi"
            title="Çoklu task oluşturma merkezi"
          >
            <LuListPlus size={16} />
          </button>
          <button type="button" className={styles.iconBtn} onClick={onSyncProject} disabled={syncDisabled} aria-label="Sync project exports"><LuRefreshCw size={16} /></button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenProjectPrompts}
            aria-label="Project prompt settings"
          >
            <LuMessageSquare size={16} />
          </button>
          <button type="button" className={styles.iconBtn} onClick={onOpenAnalytics} aria-label="Open project analytics" title="Analytics"><LuSignal size={16} /></button>
          <button type="button" className={styles.iconBtn} onClick={onOpenStatusSettings} aria-label="Project status settings"><LuSettings2 size={16} /></button>
        </div>
      </div>
      <ProjectViewBar
        onBoardSelect={onBoardSelect}
        recentChatsActive={recentChatsActive}
        recentChatsCount={recentChatsCount}
        onRecentChatsSelect={onRecentChatsSelect}
      />
    </header>
  )
}
