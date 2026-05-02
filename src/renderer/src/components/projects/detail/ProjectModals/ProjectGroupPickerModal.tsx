import type { ProjectGroup } from '@shared/types/entities'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

export interface ProjectGroupPickerModalProps {
  open: boolean
  projectGroupId?: string | null
  projectGroups: ProjectGroup[]
  projectGroupSaving?: boolean
  onClose: () => void
  onClearGroup: () => void | Promise<void>
  onPickGroup: (group: ProjectGroup | null) => void | Promise<void>
}

export function ProjectGroupPickerModal({
  open,
  projectGroupId,
  projectGroups,
  projectGroupSaving,
  onClose,
  onClearGroup,
  onPickGroup
}: ProjectGroupPickerModalProps) {
  if (!open) return null

  return (
    <>
      <div className={styles.nestedCreateBackdrop} onClick={onClose} />
      <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Choose project group">
        <header>
          <h4>Choose project group</h4>
          <button type="button" onClick={onClose} aria-label="Close project group picker">✕</button>
        </header>
        <div className={styles.workspacePickerList}>
          <button
            type="button"
            className={projectGroupId ? styles.workspacePickerRow : `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}`}
            onClick={() => void onClearGroup()}
            disabled={projectGroupSaving}
          >
            <strong>No project group</strong>
            <span>Remove this project from its current group.</span>
          </button>
          {projectGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              className={group.id === projectGroupId ? `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}` : styles.workspacePickerRow}
              onClick={() => void onPickGroup(group)}
              disabled={projectGroupSaving}
            >
              <strong>{group.name}</strong>
              <span>{group.description || `${group.projectIds?.length ?? 0} projects`}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
