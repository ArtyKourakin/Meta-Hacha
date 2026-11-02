/** Shared preload bridge contract (no Electron imports, safe for the renderer). */

export interface AnchorPoint {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface StatusMessage extends AnchorPoint {
  text: string
  action?: 'open-settings'
}

export interface StepLabel {
  index: number
  total: number
  instruction: string
  caution: string | null
}

export type InputMode = 'point' | 'look'

export interface InputPrompt extends AnchorPoint {
  mode: InputMode
}

export interface LookLabel {
  answer: string
}

export interface RecoveryLabel {
  explanation: string
}

export interface MarkerPoint extends AnchorPoint {
  step?: StepLabel
  recovery?: RecoveryLabel
  look?: LookLabel
  /** Free-query target text; renders a bubble with a Wrong-spot button. */
  query?: string
  /** Cursor position in window points, sampled when the marker was sent (flight start). */
  cursor: AnchorPoint
  /** Usable area in window points; robot and bubble are laid out inside it. */
  workArea: Rect
}

export interface ChatMessageView {
  role: 'user' | 'assistant'
  text: string
}

export interface PlanStepView {
  instruction: string
  target: string
  caution: string | null
}

/** Drop a leading "Step N:" / "N." / "N)" from a plan instruction for display. */
export function stripStepPrefix(instruction: string): string {
  const stripped = instruction.replace(/^\s*(?:step\s*\d+|\d+)\s*[:.)-]?\s+/i, '').trim()
  return stripped.length > 0 ? stripped : instruction.trim()
}

export interface GreetingView {
  goal: string
  index: number
  total: number
}

export interface ResearchView {
  app: string
  summary: string
  urls: string[]
}

export interface ChatSnapshot {
  messages: ChatMessageView[]
  hasPlan: boolean
  plan: PlanStepView[]
  currentStepIndex: number
  busy: boolean
  notice: string | null
  collapsed: boolean
  workspaceName: string | null
  app: string | null
  greeting: GreetingView | null
  /** App the user must open before continuing (shows the "I'm ready" card). */
  needsApp: string | null
  /** App currently being web-researched, if any. */
  researching: string | null
  /** Stored web research for this workspace, if any. */
  research: ResearchView | null
}

export interface AppApi {
  // Overlay: query box
  submit: (target: string) => void
  lookAsk: (text: string) => void
  cancel: () => void
  onShowInput: (cb: (prompt: InputPrompt) => void) => () => void
  onHideInput: (cb: () => void) => () => void
  onLooking: (cb: (pos: AnchorPoint) => void) => () => void
  onLookingDone: (cb: () => void) => () => void
  onMarker: (cb: (pt: MarkerPoint) => void) => () => void
  onMessage: (cb: (msg: StatusMessage) => void) => () => void
  onHappy: (cb: () => void) => () => void
  // Overlay: step bubble (clickable island in the click-through overlay)
  reportIslands: (rects: Rect[]) => void
  bubbleNext: () => void
  bubbleRetry: () => void
  bubbleDone: () => void
  bubbleWrongSpot: () => void
  openSettings: () => void
  // Advisor chat window
  chatReady: () => void
  chatSend: (text: string, withScreenshot: boolean) => void
  chatShowMe: () => void
  chatNext: () => void
  chatBack: () => void
  chatToggleCollapsed: (source: 'button' | 'tab') => void
  chatSelectProject: () => void
  chatCreateWorkspace: (name: string) => void
  chatClearHistory: () => void
  chatDeleteAllHistory: () => void
  chatStartNew: () => void
  chatAppReady: () => void
  chatResearch: () => void
  openLink: (url: string) => void
  onTabCursor: (cb: (offset: AnchorPoint) => void) => () => void
  onChatSnapshot: (cb: (snap: ChatSnapshot) => void) => () => void
}
