/** Single Session store for the assistant (main process only, never persisted). */

import { isStepAction, type StepAction } from '../shared/api'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface PlanStep {
  instruction: string
  target: string | null
  action: StepAction
  text?: string
  dropTarget?: string
  keys?: string[]
  choose?: string[]
  caution: string | null
}

export interface ResearchNotes {
  app: string
  summary: string
  urls: string[]
  updatedAt: number
}

export interface DiscoveryQuestion {
  text: string
  options: string[]
}

export interface Session {
  messages: ChatMessage[]
  /** One-sentence goal supplied by the advisor whenever it creates/changes a plan. */
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
  /** App the user is working in, as detected by the advisor. */
  app: string | null
  /** Web research about the current app, if any was run. */
  research: ResearchNotes | null
  /** When true, Next verifies the step from a screenshot before advancing. */
  verifySteps: boolean
  /** Open clarify questions (transient UI state, not persisted). */
  questions: DiscoveryQuestion[] | null
  /** Unconfirmed brief from the last confirm turn (transient, not persisted). */
  pendingBrief: string[] | null
  /** Confirmed brief, included in plan/verify/recovery prompts. */
  brief: string[] | null
  /** Clarify rounds used in this discovery run (cap enforced via prompt). */
  clarifyRounds: number
}

export const session: Session = {
  messages: [],
  goal: null,
  plan: [],
  currentStepIndex: 0,
  app: null,
  research: null,
  verifySteps: true,
  questions: null,
  pendingBrief: null,
  brief: null,
  clarifyRounds: 0
}

export function resetSession(): void {
  session.messages = []
  session.goal = null
  session.plan = []
  session.currentStepIndex = 0
  session.app = null
  session.research = null
  session.verifySteps = true
  session.questions = null
  session.pendingBrief = null
  session.brief = null
  session.clarifyRounds = 0
}

/** Replace the steps after the current one (verification replan). */
export function replaceRemainingSteps(steps: PlanStep[]): void {
  session.plan = [
    ...session.plan.slice(0, session.currentStepIndex + 1),
    ...steps.map((s) => ({
      instruction: s.instruction,
      target: s.target,
      action: s.action,
      text: s.text,
      dropTarget: s.dropTarget,
      keys: s.keys ? [...s.keys] : undefined,
      choose: s.choose ? [...s.choose] : undefined,
      caution: s.caution
    }))
  ]
}

export function restoreSession(data: {
  messages: ChatMessage[]
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
  app: string | null
  research: ResearchNotes | null
  verifySteps: boolean
  brief?: string[] | null
}): void {
  session.messages = data.messages.map((m) => ({ role: m.role, text: m.text }))
  session.goal = data.goal
  session.plan = data.plan.map((s) => ({
    instruction: s.instruction,
    target: typeof s.target === 'string' ? s.target : null,
    action: isStepAction(s.action) ? s.action : 'click',
    text: typeof s.text === 'string' ? s.text : undefined,
    dropTarget: typeof s.dropTarget === 'string' ? s.dropTarget : undefined,
    keys: Array.isArray(s.keys)
      ? s.keys.filter((k): k is string => typeof k === 'string')
      : undefined,
    choose: Array.isArray(s.choose)
      ? s.choose.filter((c): c is string => typeof c === 'string')
      : undefined,
    caution: s.caution ?? null
  }))
  session.currentStepIndex = data.currentStepIndex
  session.verifySteps = data.verifySteps
  session.app = data.app
  session.brief = Array.isArray(data.brief)
    ? data.brief.filter((b): b is string => typeof b === 'string')
    : null
  if (session.brief && session.brief.length === 0) session.brief = null
  session.questions = null
  session.pendingBrief = null
  session.clarifyRounds = 0
  session.research = data.research
    ? {
        app: data.research.app,
        summary: data.research.summary,
        urls: [...data.research.urls],
        updatedAt: data.research.updatedAt
      }
    : null
}

export function setPlan(goal: string, steps: PlanStep[]): void {
  session.goal = goal
  session.plan = steps
  session.currentStepIndex = 0
}

export function hasPlan(): boolean {
  return session.plan.length > 0
}

export function currentStep(): PlanStep | null {
  return hasPlan() ? (session.plan[session.currentStepIndex] ?? null) : null
}

export function canAdvance(): boolean {
  return hasPlan() && session.currentStepIndex < session.plan.length - 1
}

export function canGoBack(): boolean {
  return hasPlan() && session.currentStepIndex > 0
}

/** Move to the next step; returns false when already on the last step. */
export function advance(): boolean {
  if (!canAdvance()) return false
  session.currentStepIndex += 1
  return true
}

/** Move to the previous step; returns false when already on the first step. */
export function goBack(): boolean {
  if (!canGoBack()) return false
  session.currentStepIndex -= 1
  return true
}

/** Context for locate(): the user's goal plus the current step instruction. */
export function stepContext(): string | undefined {
  const step = currentStep()
  if (!step) return undefined
  return session.goal
    ? `Goal: ${session.goal}\nCurrent step: ${step.instruction}`
    : `Current step: ${step.instruction}`
}
