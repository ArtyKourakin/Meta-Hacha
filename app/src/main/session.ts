/** Single Session store for the assistant (main process only, never persisted). */

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface PlanStep {
  instruction: string
  target: string
  caution: string | null
}

export interface ResearchNotes {
  app: string
  summary: string
  urls: string[]
  updatedAt: number
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
}

export const session: Session = {
  messages: [],
  goal: null,
  plan: [],
  currentStepIndex: 0,
  app: null,
  research: null,
  verifySteps: true
}

export function resetSession(): void {
  session.messages = []
  session.goal = null
  session.plan = []
  session.currentStepIndex = 0
  session.app = null
  session.research = null
  session.verifySteps = true
}

/** Replace the steps after the current one (verification replan). */
export function replaceRemainingSteps(steps: PlanStep[]): void {
  session.plan = [
    ...session.plan.slice(0, session.currentStepIndex + 1),
    ...steps.map((s) => ({ instruction: s.instruction, target: s.target, caution: s.caution }))
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
}): void {
  session.messages = data.messages.map((m) => ({ role: m.role, text: m.text }))
  session.goal = data.goal
  session.plan = data.plan.map((s) => ({
    instruction: s.instruction,
    target: s.target,
    caution: s.caution ?? null
  }))
  session.currentStepIndex = data.currentStepIndex
  session.verifySteps = data.verifySteps
  session.app = data.app
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
