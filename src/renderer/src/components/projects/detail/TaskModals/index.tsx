import { ReactNode } from 'react'
import type { AppSelectOption } from '@renderer/components/select/AppSelect'
import type { DataFormatRole, TableColumnConfig } from '@renderer/screens/projects/detail/types'
import type { Agent, CustomField, Project, ProjectPromptTab, Tag, TaskEntity, TaskSubtask, TaskTemplate } from '@shared/types/entities'
import { AddSubtaskPopup } from '@renderer/popups/AddSubtask'
import { ChecklistPopup } from '@renderer/popups/Checklist'
import { CreateTaskPopup } from '@renderer/popups/CreateTask'
import { CustomFieldPopup } from '@renderer/popups/CustomField'
import { OutputFormatPopup } from '@renderer/popups/OutputFormat'
import { ProjectPromptSettingsPopup } from '@renderer/popups/ProjectPromptSettings'
import { TaskJsonImportPopup } from '@renderer/popups/TaskJsonImport'
import styles from '@renderer/screens/projects/ProjectDetailPage.module.scss'

export interface TaskModalsProps {
  open: boolean
  selectedTask?: TaskEntity | null
  project?: Project | null

  isCreateTaskOpen?: boolean
  onCreateTaskClose?: () => void
  createTaskProject?: {
    tags: Tag[]
    agents: Agent[]
    templates: TaskTemplate[]
    statusColumns: TableColumnConfig[]
    defaultStatus: TaskSubtask['status']
    initialTitle: string
    initialTemplateId: string | null
    busy: boolean
    onCreate: (input: {
      title: string
      description: string
      status: TaskSubtask['status']
      priority: number
      projectId?: string | null
      templateId?: string | null
      agentId?: string | null
      dueAt?: number | null
      assigneeIds?: string[]
      customFields?: Record<string, unknown>
      skillIds?: string[]
      tagIds?: string[]
      payload?: Record<string, unknown>
    }) => void
  }

  isAddSubtaskOpen?: boolean
  onAddSubtaskClose?: () => void
  onAddSubtaskCreate?: (input: {
    title: string
    description: string
    status: TaskSubtask['status']
    agentId?: string | null
    dueAt?: number
  }) => void
  onAddSubtasksCreate?: (inputs: Array<{
    title: string
    description: string
    status: TaskSubtask['status']
    agentId?: string | null
    dueAt?: number
  }>) => void

  isTableColumnPickerOpen?: boolean
  availableTableColumns?: TableColumnConfig[]
  selectedTableColumns?: TableColumnConfig[]
  onCloseTableColumnPicker?: () => void
  onTableColumnsSave?: (next: TableColumnConfig[]) => void | Promise<void>

  isProjectPromptSettingsOpen?: boolean
  projectPromptTab?: ProjectPromptTab
  projectPromptContext?: string
  projectPromptPrompt?: string
  projectPromptOutput?: string
  projectPromptError?: string | null
  projectPromptSaving?: boolean
  onProjectPromptTabChange?: (tab: ProjectPromptTab) => void
  onProjectPromptContextChange?: (value: string) => void
  onProjectPromptPromptChange?: (value: string) => void
  onProjectPromptOutputChange?: (value: string) => void
  onProjectPromptClose?: () => void
  onProjectPromptSave?: () => void | Promise<void>

  isCustomFieldModalOpen?: boolean
  customFieldRows?: Array<{ id: string; field: AppSelectOption | null; value: string }>
  customFields?: CustomField[]
  assignedFieldIds?: Set<string>
  customFieldError?: string | null
  isCreateCustomFieldOpen?: boolean
  quickFieldName?: string
  quickFieldType?: CustomField['type']
  onCustomFieldRowsChange?: (rows: Array<{ id: string; field: AppSelectOption | null; value: string }>) => void
  onCustomFieldCreateRow?: () => { id: string; field: null; value: string }
  onCreateCustomFieldOpenChange?: (open: boolean) => void
  onQuickFieldNameChange?: (name: string) => void
  onQuickFieldTypeChange?: (value: CustomField['type']) => void
  onCustomFieldModalClose?: () => void
  onCustomFieldSave?: () => void | Promise<void>
  onCustomFieldCreate?: () => void | Promise<void>
  onCustomFieldErrorClear?: () => void

  isChecklistModalOpen?: boolean
  checklistRows?: Array<{ id: string; title: string }>
  onChecklistRowsChange?: (rows: Array<{ id: string; title: string }>) => void
  onChecklistCreateRow?: () => { id: string; title: string }
  onChecklistModalClose?: () => void
  onChecklistSave?: () => void | Promise<void>

  isOutputFormatModalOpen?: boolean
  dataFormatRoleDraft?: DataFormatRole
  outputFormatDraftOption?: AppSelectOption | null
  outputFormatOptions?: AppSelectOption[]
  isCreateOutputFormatOpen?: boolean
  quickOutputFormatName?: string
  quickOutputFormatDescription?: string
  onOutputFormatDraftOptionChange?: (option: AppSelectOption | null) => void
  onCreateOutputFormatOpenChange?: (open: boolean) => void
  onQuickOutputFormatNameChange?: (value: string) => void
  onQuickOutputFormatDescriptionChange?: (value: string) => void
  onOutputFormatClose?: () => void
  onOutputFormatSave?: () => void | Promise<void>
  onOutputFormatCreate?: () => void | Promise<void>

  isTaskImportOpen?: boolean
  isTaskImporting?: boolean
  onTaskImportClose?: () => void
  onTaskImport?: (jsonText: string) => void | Promise<void>

  children: ReactNode
}

export function TaskModals(props: TaskModalsProps) {
  const {
    open,
    selectedTask,
    project
  } = props

  if (!open) return null

  return (
    <>
      {props.children}

      {props.isCreateTaskOpen && project ? (
        <CreateTaskPopup
          open
          project={project}
          tags={props.createTaskProject?.tags ?? []}
          agents={props.createTaskProject?.agents ?? []}
          templates={props.createTaskProject?.templates ?? []}
          statusColumns={props.createTaskProject?.statusColumns ?? []}
          defaultStatus={props.createTaskProject?.defaultStatus ?? 'pending'}
          initialTitle={props.createTaskProject?.initialTitle ?? ''}
          initialTemplateId={props.createTaskProject?.initialTemplateId ?? null}
          busy={props.createTaskProject?.busy ?? false}
          onClose={props.onCreateTaskClose ?? (() => undefined)}
          onCreate={(input) => {
            props.createTaskProject?.onCreate?.({
              ...input,
              projectId: input.projectId ?? project.id
            })
          }}
        />
      ) : null}

      {props.isAddSubtaskOpen && selectedTask ? (
        <AddSubtaskPopup
          open
          projectName={project?.name ?? 'Project task'}
          taskTitle={selectedTask.title}
          agents={props.createTaskProject?.agents ?? []}
          statusColumns={props.createTaskProject?.statusColumns ?? []}
          defaultStatus={props.createTaskProject?.defaultStatus ?? 'pending'}
          busy={props.createTaskProject?.busy ?? false}
          onClose={props.onAddSubtaskClose ?? (() => undefined)}
          onCreate={(input) => props.onAddSubtaskCreate?.(input)}
          onCreateMany={(inputs) => props.onAddSubtasksCreate?.(inputs)}
        />
      ) : null}

      {props.isTableColumnPickerOpen ? (
        <>
          <div className={styles.nestedCreateBackdrop} onClick={props.onCloseTableColumnPicker} />
          <section className={styles.nestedCreateDialog} role="dialog" aria-modal="true" aria-label="Choose table columns">
            <header>
              <h4>Table columns</h4>
              <button type="button" onClick={props.onCloseTableColumnPicker} aria-label="Close column picker">×</button>
            </header>
            <div className={styles.columnPickerBody}>
              <p className={styles.columnPickerHint}>Choose up to 12 columns. Name and Status stay visible.</p>
              {(props.availableTableColumns ?? []).map((column) => {
                const selected = (props.selectedTableColumns ?? []).some((item) => item.id === column.id)
                const disabled = column.required || (!selected && (props.selectedTableColumns ?? []).length >= 12)
                return (
                  <label key={column.id} className={`${styles.columnPickerRow} ${selected ? styles.columnPickerRowActive : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={(event) => {
                        if (column.required) return
                        if (!props.onTableColumnsSave) return
                        const next = event.target.checked
                          ? [...(props.selectedTableColumns ?? []), column].slice(0, 12)
                          : (props.selectedTableColumns ?? []).filter((item) => item.id !== column.id || item.required)
                        void props.onTableColumnsSave(next)
                      }}
                    />
                    <span>{column.label}</span>
                    {column.kind === 'custom' ? <small>Custom field</small> : <small>Built-in</small>}
                  </label>
                )
              })}
            </div>
          </section>
        </>
      ) : null}

      {props.isProjectPromptSettingsOpen ? (
        <ProjectPromptSettingsPopup
          tab={props.projectPromptTab ?? 'context'}
          context={props.projectPromptContext ?? ''}
          prompt={props.projectPromptPrompt ?? ''}
          output={props.projectPromptOutput ?? ''}
          error={props.projectPromptError ?? null}
          saving={props.projectPromptSaving ?? false}
          onTabChange={props.onProjectPromptTabChange ?? (() => undefined)}
          onContextChange={props.onProjectPromptContextChange ?? (() => undefined)}
          onPromptChange={props.onProjectPromptPromptChange ?? (() => undefined)}
          onOutputChange={props.onProjectPromptOutputChange ?? (() => undefined)}
          onClose={props.onProjectPromptClose ?? (() => undefined)}
          onSave={props.onProjectPromptSave ?? (() => undefined)}
        />
      ) : null}

      {props.isCustomFieldModalOpen ? (
        <CustomFieldPopup
          rows={props.customFieldRows ?? []}
          customFields={props.customFields ?? []}
          assignedFieldIds={props.assignedFieldIds ?? new Set<string>()}
          error={props.customFieldError ?? null}
          createOpen={props.isCreateCustomFieldOpen ?? false}
          quickFieldName={props.quickFieldName ?? ''}
          quickFieldType={props.quickFieldType ?? 'text'}
          onRowsChange={props.onCustomFieldRowsChange ?? (() => undefined)}
          onCreateRow={props.onCustomFieldCreateRow ?? (() => ({ id: String(Date.now()), field: null, value: '' }))}
          onCreateOpenChange={props.onCreateCustomFieldOpenChange ?? (() => undefined)}
          onQuickFieldNameChange={props.onQuickFieldNameChange ?? (() => undefined)}
          onQuickFieldTypeChange={props.onQuickFieldTypeChange ?? (() => undefined)}
          onClose={props.onCustomFieldModalClose ?? (() => undefined)}
          onSave={props.onCustomFieldSave ?? (() => undefined)}
          onCreateField={props.onCustomFieldCreate ?? (() => undefined)}
          onErrorClear={props.onCustomFieldErrorClear ?? (() => undefined)}
        />
      ) : null}

      {props.isChecklistModalOpen ? (
        <ChecklistPopup
          rows={props.checklistRows ?? []}
          onRowsChange={props.onChecklistRowsChange ?? (() => undefined)}
          onCreateRow={props.onChecklistCreateRow ?? (() => ({ id: String(Date.now()), title: '' }))}
          onClose={props.onChecklistModalClose ?? (() => undefined)}
          onSave={props.onChecklistSave ?? (() => undefined)}
        />
      ) : null}

      {props.isOutputFormatModalOpen ? (
        <OutputFormatPopup
          role={props.dataFormatRoleDraft ?? 'output'}
          draftOption={props.outputFormatDraftOption ?? null}
          options={props.outputFormatOptions ?? []}
          createOpen={props.isCreateOutputFormatOpen ?? false}
          quickName={props.quickOutputFormatName ?? ''}
          quickDescription={props.quickOutputFormatDescription ?? ''}
          onDraftOptionChange={props.onOutputFormatDraftOptionChange ?? (() => undefined)}
          onCreateOpenChange={props.onCreateOutputFormatOpenChange ?? (() => undefined)}
          onQuickNameChange={props.onQuickOutputFormatNameChange ?? (() => undefined)}
          onQuickDescriptionChange={props.onQuickOutputFormatDescriptionChange ?? (() => undefined)}
          onClose={props.onOutputFormatClose ?? (() => undefined)}
          onSave={props.onOutputFormatSave ?? (() => undefined)}
          onCreate={props.onOutputFormatCreate ?? (() => undefined)}
        />
      ) : null}

      {props.isTaskImportOpen ? (
        <TaskJsonImportPopup
          open
          title="Import task JSON"
          busy={props.isTaskImporting ?? false}
          onClose={props.onTaskImportClose ?? (() => undefined)}
          onImport={(jsonText) => props.onTaskImport?.(jsonText)}
        />
      ) : null}
    </>
  )
}
