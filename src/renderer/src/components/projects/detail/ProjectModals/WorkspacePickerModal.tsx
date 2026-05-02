import type { Workspace } from '@shared/types/entities'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

export interface WorkspacePickerModalProps {
  open: boolean
  noWorkspaceLabel?: string
  selectedWorkspaceId?: string | null
  workspaces: Workspace[]
  moving?: boolean
  onClose: () => void
  onPickNoWorkspace: () => void
  onPickWorkspace: (workspace: Workspace) => Promise<void> | void
  onDraftChange?: (draft: { name: string; path: string }) => void
  workspaceDraftName?: string
  workspaceDraftPath?: string
  onChooseFolder?: () => void
  onCreateWorkspace?: () => Promise<void> | void
  createWorkspaceDisabled?: boolean
}

export function WorkspacePickerModal({
  open,
  noWorkspaceLabel = 'No workspace',
  selectedWorkspaceId,
  workspaces,
  moving,
  onClose,
  onPickNoWorkspace,
  onPickWorkspace,
  workspaceDraftName,
  workspaceDraftPath,
  onDraftChange,
  onChooseFolder,
  onCreateWorkspace,
  createWorkspaceDisabled
}: WorkspacePickerModalProps) {
  if (!open) return null

  return (
    <>
      <div className={styles.nestedCreateBackdrop} onClick={onClose} />
      <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Choose workspace">
        <header>
          <h4>Choose workspace</h4>
          <button type="button" onClick={onClose} aria-label="Close workspace picker">✕</button>
        </header>
        <div className={styles.workspacePickerList}>
          <button type="button" className={selectedWorkspaceId ? styles.workspacePickerRow : `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}`} onClick={onPickNoWorkspace}>
            <strong>{noWorkspaceLabel}</strong>
            <span>Use staging until a workspace is selected.</span>
          </button>
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className={
                workspace.id === selectedWorkspaceId
                  ? `${styles.workspacePickerRow} ${styles.workspacePickerRowActive}`
                  : styles.workspacePickerRow
              }
              onClick={() => void onPickWorkspace(workspace)}
              disabled={moving}
            >
              <strong>{workspace.name}</strong>
              <span>{workspace.rootPath}</span>
            </button>
          ))}
        </div>
        <div className={styles.nestedCreateBody}>
          <label>
            <span>Workspace name</span>
            <input
              value={workspaceDraftName ?? ''}
              readOnly={!onDraftChange}
              onChange={(event) => {
                onDraftChange?.({ name: event.target.value, path: workspaceDraftPath ?? '' })
              }}
            />
          </label>
          <label>
            <span>Folder path</span>
            <input
              value={workspaceDraftPath ?? ''}
              readOnly={!onDraftChange}
              onChange={(event) => {
                onDraftChange?.({ name: workspaceDraftName ?? '', path: event.target.value })
              }}
            />
          </label>
        </div>
        {onChooseFolder ? <button type="button" onClick={() => onChooseFolder()}>Choose folder</button> : null}
        {onCreateWorkspace ? (
          <footer>
            <button
              type="button"
              disabled={createWorkspaceDisabled}
              onClick={() => void onCreateWorkspace()}
            >
              Add workspace
            </button>
          </footer>
        ) : null}
      </section>
    </>
  )
}
