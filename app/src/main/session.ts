/**
 * Single Session store for the assistant (for the next step: advisor chat
 * and a "next step" hotkey). Not yet wired to any UI in this slice.
 */

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
  plan: PlanStep[]
  currentStepIndex: number
}

export const session: Session = {
  messages: [],
  plan: [],
  currentStepIndex: 0
}

export function resetSession(): void {
  session.messages = []
  session.plan = []
  session.currentStepIndex = 0
}
