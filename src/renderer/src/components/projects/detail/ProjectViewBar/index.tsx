import { LuMessageSquare } from 'react-icons/lu'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectViewBarProps {
  onBoardSelect: () => void
  recentChatsActive?: boolean
  recentChatsCount?: number
  onRecentChatsSelect?: () => void
}

export function ProjectViewBar({ onBoardSelect, recentChatsActive = false, recentChatsCount = 0, onRecentChatsSelect }: ProjectViewBarProps) {
  return (
    <nav className={styles.viewBar} aria-label="Project views">
      <div className={styles.viewSwitch}>
        <button className={!recentChatsActive ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={onBoardSelect}>
          <span className={styles.viewGlyphBoard} />
          Board
        </button>
        <button className={recentChatsActive ? styles.viewBtnActive : styles.viewBtn} type="button" onClick={onRecentChatsSelect}>
          <LuMessageSquare size={14} />
          Chats
          {recentChatsCount > 0 ? <b className={styles.viewCountBadge}>{recentChatsCount}</b> : null}
        </button>
      </div>
    </nav>
  )
}
