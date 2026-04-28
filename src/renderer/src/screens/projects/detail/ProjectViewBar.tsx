import { LuPlus } from 'react-icons/lu'
import type { ProjectViewMode } from './status'
import styles from '../ProjectDetailPage.module.scss'

interface ProjectViewBarProps {
  viewMode: ProjectViewMode
  onViewModeChange: (mode: ProjectViewMode) => void
}

export function ProjectViewBar({ viewMode, onViewModeChange }: ProjectViewBarProps) {
  return (
    <nav className={styles.viewBar} aria-label="Project views">
      <div className={styles.viewSwitch}>
        <button className={viewMode === 'list' ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={() => onViewModeChange('list')}>
          <span className={styles.viewGlyphList} />
          List
        </button>
        <button className={viewMode === 'table' ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={() => onViewModeChange('table')}>
          <span className={styles.viewGlyphTable} />
          Table
        </button>
        <button className={viewMode === 'board' ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={() => onViewModeChange('board')}>
          <span className={styles.viewGlyphBoard} />
          Board
        </button>
        <button className={styles.viewBtn} type="button" disabled>
          <LuPlus size={14} />
          View
        </button>
      </div>
    </nav>
  )
}
