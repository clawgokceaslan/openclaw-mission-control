import type { IconType } from 'react-icons'
import {
  LuBot,
  LuBookOpen,
  LuFolder,
  LuFolderKanban,
  LuLayoutDashboard,
  LuListTodo,
  LuSettings2,
  LuSlidersHorizontal,
  LuSparkles,
  LuTags,
  LuClipboardList,
  LuBookMarked,
  LuLayers,
  LuMessageSquare,
  LuRocket,
  LuWrench,
  LuTv,
  LuWorkflow
} from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'

export type NavGroupKey = 'Overview' | 'Projects' | 'Templates' | 'Capabilities' | 'Administration'

export interface NavItem {
  label: string
  path: string
  group: NavGroupKey
  icon: IconType
}

export const NAV_GROUP_ORDER: NavGroupKey[] = ['Overview', 'Projects', 'Templates', 'Capabilities', 'Administration']

export const NAV_BY_GROUP: Record<NavGroupKey, NavItem[]> = {
  Overview: [
    { label: 'Dashboard', path: APP_ROUTES.DASHBOARD, group: 'Overview', icon: LuLayoutDashboard },
    { label: 'Chats', path: APP_ROUTES.LAST_CHATS, group: 'Overview', icon: LuMessageSquare }
  ],
  Projects: [
    { label: 'Project groups', path: APP_ROUTES.PROJECT_GROUPS, group: 'Projects', icon: LuFolderKanban },
    { label: 'Projects', path: APP_ROUTES.PROJECTS, group: 'Projects', icon: LuFolder },
    { label: 'Plan Pipeline', path: APP_ROUTES.PLAN_PIPELINE, group: 'Projects', icon: LuWorkflow },
    { label: 'Run Pipeline', path: APP_ROUTES.RUN_PIPELINE, group: 'Projects', icon: LuRocket },
    { label: 'Pipeline Status', path: APP_ROUTES.PIPELINE_STATUS, group: 'Projects', icon: LuTv }
  ],
  Templates: [
    { label: 'Statuses', path: APP_ROUTES.STATUSES, group: 'Templates', icon: LuListTodo },
    { label: 'Task Templates', path: APP_ROUTES.TASK_TEMPLATES, group: 'Templates', icon: LuClipboardList },
    { label: 'Project Instructions', path: APP_ROUTES.PROJECT_INSTRUCTION_TEMPLATES, group: 'Templates', icon: LuBookMarked },
    { label: 'Tags', path: APP_ROUTES.TAGS, group: 'Templates', icon: LuTags },
    { label: 'Custom fields', path: APP_ROUTES.CUSTOM_FIELDS, group: 'Templates', icon: LuSettings2 },
    { label: 'Data Formats', path: APP_ROUTES.OUTPUT_FORMATS, group: 'Templates', icon: LuLayers }
  ],
  Capabilities: [
    { label: 'Agents', path: APP_ROUTES.AGENTS, group: 'Capabilities', icon: LuBot },
    { label: 'Tools', path: APP_ROUTES.TOOLS, group: 'Capabilities', icon: LuWrench },
    { label: 'Skills', path: APP_ROUTES.SKILLS, group: 'Capabilities', icon: LuSparkles }
  ],
  Administration: [
    { label: 'Settings', path: APP_ROUTES.SETTINGS, group: 'Administration', icon: LuSlidersHorizontal },
    { label: 'Documentation', path: APP_ROUTES.DOCUMENTATION, group: 'Administration', icon: LuBookOpen }
  ]
}
