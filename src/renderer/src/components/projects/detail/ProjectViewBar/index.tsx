import { LuMessageSquare, LuPlus } from 'react-icons/lu'
import type { ProjectViewMode } from '@renderer/screens/projects/detail/status'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectViewBarProps {
  viewMode: ProjectViewMode
  onViewModeChange: (mode: ProjectViewMode) => void
  recentChatsActive?: boolean
  recentChatsCount?: number
  onRecentChatsSelect?: () => void
}

export function ProjectViewBar({ viewMode, onViewModeChange, recentChatsActive = false, recentChatsCount = 0, onRecentChatsSelect }: ProjectViewBarProps) {
  return (
    <nav className={styles.viewBar} aria-label="Project views">
      <div className={styles.viewSwitch}>
        <button className={!recentChatsActive && viewMode === 'list' ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={() => onViewModeChange('list')}>
          <span className={styles.viewGlyphList} />
          List
        </button>
        <button className={!recentChatsActive && viewMode === 'table' ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={() => onViewModeChange('table')}>
          <span className={styles.viewGlyphTable} />
          Table
        </button>
        <button className={!recentChatsActive && viewMode === 'board' ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={() => onViewModeChange('board')}>
          <span className={styles.viewGlyphBoard} />
          Board
        </button>
        <button className={recentChatsActive ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={onRecentChatsSelect}>
          <LuMessageSquare size={14} />
          Chats
          {recentChatsCount > 0 ? <b className={styles.viewCountBadge}>{recentChatsCount}</b> : null}
        </button>
        <button className={styles.viewBtn} type="button" disabled>
          <LuPlus size={14} />
          View
        </button>
      </div>
    </nav>
  )
}
