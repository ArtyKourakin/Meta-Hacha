/** Single Session store for the assistant (main process only, never persisted). */

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface PlanStep {
  instruction: string
  target: string
}

export interface Session {
  messages: ChatMessage[]
  /** One-sentence goal supplied by the advisor whenever it creates/changes a plan. */
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
}

export const session: Session = {
  messages: [],
  goal: null,
  plan: [],
  currentStepIndex: 0
}

export function resetSession(): void {
  session.messages = []
  session.goal = null
  session.plan = []
  session.currentStepIndex = 0
}

export function restoreSession(data: {
  messages: ChatMessage[]
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
}): void {
  session.messages = data.messages.map((m) => ({ role: m.role, text: m.text }))
  session.goal = data.goal
  session.plan = data.plan.map((s) => ({ instruction: s.instruction, target: s.target }))
  session.currentStepIndex = data.currentStepIndex
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
