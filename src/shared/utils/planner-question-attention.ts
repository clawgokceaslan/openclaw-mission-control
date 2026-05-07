export const PLANNER_QUESTION_ATTENTION_BEHAVIORS = ['off', 'modal', 'focus-and-modal'] as const

export type PlannerQuestionAttentionBehavior = (typeof PLANNER_QUESTION_ATTENTION_BEHAVIORS)[number]

export const DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR: PlannerQuestionAttentionBehavior = 'focus-and-modal'

export function normalizePlannerQuestionAttentionBehavior(value: unknown): PlannerQuestionAttentionBehavior {
  return typeof value === 'string' && PLANNER_QUESTION_ATTENTION_BEHAVIORS.includes(value as PlannerQuestionAttentionBehavior)
    ? value as PlannerQuestionAttentionBehavior
    : DEFAULT_PLANNER_QUESTION_ATTENTION_BEHAVIOR
}
