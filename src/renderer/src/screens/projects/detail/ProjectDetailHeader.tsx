import { LuColumns3, LuMessageSquare, LuPlus, LuSettings2, LuSignal } from 'react-icons/lu'
import type { Project } from '@shared/types/entities'
import type { ProjectViewMode } from './status'
import { ProjectViewBar } from './ProjectViewBar'
import styles from '../ProjectDetailPage.module.scss'

interface ProjectDetailHeaderProps {
  project: Project
  taskTitle: string
  busy: boolean
  viewMode: ProjectViewMode
  onTaskTitleChange: (value: string) => void
  onQuickCreate: () => void
  onOpenCreateTask: () => void
  onViewModeChange: (mode: ProjectViewMode) => void
}

export function ProjectDetailHeader({
  project,
  taskTitle,
  busy,
  viewMode,
  onTaskTitleChange,
  onQuickCreate,
  onOpenCreateTask,
  onViewModeChange
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
            placeholder="New task title..."
          />
          <button type="button" className={styles.plusBtn} onClick={onOpenCreateTask} disabled={busy}>
            <LuPlus size={18} />
          </button>
          <button type="button" className={styles.iconBtn}><LuColumns3 size={16} /></button>
          <button type="button" className={styles.iconBtn}><LuMessageSquare size={16} /></button>
          <button type="button" className={styles.iconBtn}><LuSignal size={16} /></button>
          <button type="button" className={styles.iconBtn}><LuSettings2 size={16} /></button>
        </div>
      </div>
      <ProjectViewBar viewMode={viewMode} onViewModeChange={onViewModeChange} />
    </header>
  )
}
