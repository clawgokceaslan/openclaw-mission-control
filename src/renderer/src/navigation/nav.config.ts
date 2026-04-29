import type { IconType } from 'react-icons'
import {
  LuBot,
  LuBookOpen,
  LuFolder,
  LuFolderKanban,
  LuLayoutDashboard,
  LuListTodo,
  LuSettings2,
  LuSparkles,
  LuTags,
  LuClipboardList,
  LuWaypoints
} from 'react-icons/lu'
import { APP_ROUTES } from '@shared/constants/ui-routes'

export type NavGroupKey = 'Overview' | 'Projects' | 'Skills' | 'Administration'

export interface NavItem {
  label: string
  path: string
  group: NavGroupKey
  icon: IconType
}

export const NAV_GROUP_ORDER: NavGroupKey[] = ['Overview', 'Projects', 'Skills', 'Administration']

export const NAV_BY_GROUP: Record<NavGroupKey, NavItem[]> = {
  Overview: [
    { label: 'Dashboard', path: APP_ROUTES.DASHBOARD, group: 'Overview', icon: LuLayoutDashboard }
  ],
  Projects: [
    { label: 'Project groups', path: APP_ROUTES.PROJECT_GROUPS, group: 'Projects', icon: LuFolderKanban },
    { label: 'Projects', path: APP_ROUTES.PROJECTS, group: 'Projects', icon: LuFolder },
    { label: 'Statuses', path: APP_ROUTES.STATUSES, group: 'Projects', icon: LuListTodo },
    { label: 'Task templates', path: APP_ROUTES.TASK_TEMPLATES, group: 'Projects', icon: LuClipboardList },
    { label: 'Tags', path: APP_ROUTES.TAGS, group: 'Projects', icon: LuTags },
    { label: 'Custom fields', path: APP_ROUTES.CUSTOM_FIELDS, group: 'Projects', icon: LuSettings2 },
    { label: 'Output formats', path: APP_ROUTES.OUTPUT_FORMATS, group: 'Projects', icon: LuSettings2 }
  ],
  Skills: [
    { label: 'Skills', path: APP_ROUTES.SKILLS, group: 'Skills', icon: LuSparkles }
  ],
  Administration: [
    { label: 'Agents', path: APP_ROUTES.AGENTS, group: 'Administration', icon: LuBot },
    { label: 'Gateways', path: APP_ROUTES.GATEWAYS, group: 'Administration', icon: LuWaypoints },
    { label: 'Documentation', path: APP_ROUTES.DOCUMENTATION, group: 'Administration', icon: LuBookOpen }
  ]
}
