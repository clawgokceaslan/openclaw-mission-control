import { Form } from 'react-bootstrap'
import { LuX } from 'react-icons/lu'
import type { ProjectPromptTab } from '@renderer/screens/projects/detail/types'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

interface ProjectPromptSettingsPopupProps {
  tab: ProjectPromptTab
  context: string
  prompt: string
  output: string
  error?: string | null
  saving: boolean
  onTabChange: (tab: ProjectPromptTab) => void
  onContextChange: (value: string) => void
  onPromptChange: (value: string) => void
  onOutputChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}

export function ProjectPromptSettingsPopup({
  tab,
  context,
  prompt,
  output,
  error,
  saving,
  onTabChange,
  onContextChange,
  onPromptChange,
  onOutputChange,
  onClose,
  onSave
}: ProjectPromptSettingsPopupProps) {
  return (
    <>
      <div className={styles.createTaskBackdrop} onClick={onClose} />
      <section className={`${styles.createTaskModal} ${styles.projectPromptModal}`} role="dialog" aria-modal="true" aria-label="Project prompt settings">
        <header className={styles.createTaskHeader}>
          <div className={styles.projectPromptTabs}>
            <button type="button" className={`${styles.projectPromptTab} ${tab === 'context' ? styles.projectPromptTabActive : ''}`} onClick={() => onTabChange('context')}>Context</button>
            <button type="button" className={`${styles.projectPromptTab} ${tab === 'prompt' ? styles.projectPromptTabActive : ''}`} onClick={() => onTabChange('prompt')}>Prompt</button>
            <button type="button" className={`${styles.projectPromptTab} ${tab === 'output' ? styles.projectPromptTabActive : ''}`} onClick={() => onTabChange('output')}>Output</button>
          </div>
          <button type="button" onClick={onClose} aria-label="Close prompt settings"><LuX size={17} /></button>
        </header>
        <div className={styles.projectPromptBody}>
          {tab === 'context' ? (
            <label className={styles.projectPromptField}>
              <div className={styles.projectPromptFieldHeader}>
                <span>General context</span>
                <span className={styles.projectPromptCounter}>{context.length}/4000</span>
              </div>
              <Form.Control as="textarea" rows={10} className={styles.projectPromptTextarea} value={context} onChange={(event) => onContextChange(event.target.value)} placeholder="Add common project context..." maxLength={4000} />
              <small className={styles.projectPromptHint}>Shared across all project tasks to keep task generation consistent.</small>
            </label>
          ) : null}
          {tab === 'prompt' ? (
            <label className={styles.projectPromptField}>
              <div className={styles.projectPromptFieldHeader}>
                <span>General prompt</span>
                <span className={styles.projectPromptCounter}>{prompt.length}/4000</span>
              </div>
              <Form.Control as="textarea" rows={10} className={styles.projectPromptTextarea} value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Set shared instructions for this project..." maxLength={4000} />
              <small className={styles.projectPromptHint}>Guides how agent should act while planning or drafting in this project.</small>
            </label>
          ) : null}
          {tab === 'output' ? (
            <label className={styles.projectPromptField}>
              <div className={styles.projectPromptFieldHeader}>
                <span>Default output</span>
                <span className={styles.projectPromptCounter}>{output.length}/3000</span>
              </div>
              <Form.Control as="textarea" rows={10} className={styles.projectPromptTextarea} value={output} onChange={(event) => onOutputChange(event.target.value)} placeholder="Set default output format..." maxLength={3000} />
              <small className={styles.projectPromptHint}>Default response format that will be suggested for all generated outputs.</small>
            </label>
          ) : null}
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
        <footer className={styles.projectPromptFooter}>
          <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </footer>
      </section>
    </>
  )
}
