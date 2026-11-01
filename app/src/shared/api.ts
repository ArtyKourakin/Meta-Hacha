/** Shared preload bridge contract (no Electron imports, safe for the renderer). */

export interface AnchorPoint {
  x: number
  y: number
}

export interface StatusMessage extends AnchorPoint {
  text: string
  action?: 'open-settings'
  cursor?: AnchorPoint
}

export interface StepLabel {
  index: number
  total: number
  instruction: string
}

export interface RecoveryLabel {
  explanation: string
}

export interface MarkerPoint extends AnchorPoint {
  step?: StepLabel
  recovery?: RecoveryLabel
  /** Cursor position in window points, sampled when the marker was sent. */
  cursor: AnchorPoint
}

export interface ChatMessageView {
  role: 'user' | 'assistant'
  text: string
}

export interface PlanStepView {
  instruction: string
  target: string
}

export interface ChatSnapshot {
  messages: ChatMessageView[]
  hasPlan: boolean
  plan: PlanStepView[]
  currentStepIndex: number
  busy: boolean
  notice: string | null
}

export interface AppApi {
  // Overlay: query box
  submit: (target: string) => void
  cancel: () => void
  onShowInput: (cb: (pos: AnchorPoint) => void) => () => void
  onHideInput: (cb: () => void) => () => void
  onLooking: (cb: (pos: AnchorPoint) => void) => () => void
  onLookingDone: (cb: () => void) => () => void
  onMarker: (cb: (pt: MarkerPoint) => void) => () => void
  onMessage: (cb: (msg: StatusMessage) => void) => () => void
  onHappy: (cb: () => void) => () => void
  // Overlay: step bubble (clickable island in the click-through overlay)
  hoverBubble: (hovering: boolean) => void
  bubbleNext: () => void
  bubbleRetry: () => void
  bubbleDone: () => void
  openSettings: () => void
  // Advisor chat window
  chatReady: () => void
  chatSend: (text: string, withScreenshot: boolean) => void
  chatShowMe: () => void
  chatNext: () => void
  chatBack: () => void
  onChatSnapshot: (cb: (snap: ChatSnapshot) => void) => () => void
}
