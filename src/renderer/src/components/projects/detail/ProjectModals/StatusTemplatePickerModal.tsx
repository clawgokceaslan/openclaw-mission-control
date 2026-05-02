import type { StatusTemplate } from '@shared/types/entities'
import styles from '../../../screens/projects/ProjectDetailPage.module.scss'

export interface StatusTemplatePickerModalProps {
  open: boolean
  templates: StatusTemplate[]
  onClose: () => void
  onPickTemplate: (template: StatusTemplate) => void | Promise<void>
}

export function StatusTemplatePickerModal({
  open,
  templates,
  onClose,
  onPickTemplate
}: StatusTemplatePickerModalProps) {
  if (!open) return null

  return (
    <>
      <div className={styles.nestedCreateBackdrop} onClick={onClose} />
      <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Apply status template">
        <header>
          <h4>Apply status template</h4>
          <button type="button" onClick={onClose} aria-label="Close status template picker">✕</button>
        </header>
        <div className={styles.workspacePickerList}>
          {templates.map((template) => (
            <button key={template.id} type="button" className={styles.workspacePickerRow} onClick={() => void onPickTemplate(template)}>
              <strong>{template.name}</strong>
              <span>{template.items?.length ?? 0} statuses</span>
            </button>
          ))}
          {templates.length === 0 ? <p className={styles.customFieldEmpty}>No status templates available.</p> : null}
        </div>
      </section>
    </>
  )
}
