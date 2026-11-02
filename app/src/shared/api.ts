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

export type StepAction = 'click' | 'type' | 'drag' | 'shortcut' | 'read' | 'select'

export const STEP_ACTIONS: readonly StepAction[] = [
  'click',
  'type',
  'drag',
  'shortcut',
  'read',
  'select'
]

export function isStepAction(value: unknown): value is StepAction {
  return (
    typeof value === 'string' && (STEP_ACTIONS as readonly string[]).includes(value)
  )
}

export interface StepFields {
  action: StepAction
  instruction: string
  target: string | null
  text?: string
  dropTarget?: string
  keys?: string[]
  choose?: string[]
}

/** One line describing a step for verify/continuity prompts. */
export function describeStep(s: StepFields): string {
  switch (s.action) {
    case 'type':
      return `${s.instruction} (type "${s.text ?? ''}" into: ${s.target ?? '(no field)'})`
    case 'drag':
      return `${s.instruction} (drag ${s.target ?? '(no source)'} onto ${s.dropTarget ?? '(no destination)'})`
    case 'shortcut':
      return `${s.instruction} (press ${(s.keys ?? []).join('+')})${s.target ? ` (in: ${s.target})` : ''}`
    case 'read':
      return s.target ? `${s.instruction} (look at: ${s.target})` : s.instruction
    case 'select':
      return `${s.instruction} (open ${s.target ?? '(no menu)'} and choose ${(s.choose ?? []).join(' → ')})`
    case 'click':
    default:
      return s.target ? `${s.instruction} (target: ${s.target})` : s.instruction
  }
}

export interface StepLabel {
  index: number
  total: number
  instruction: string
  caution: string | null
  action: StepAction
  text?: string
  dropShort?: string
  keys?: string[]
  /** Ordered option labels for a select step; omitted/empty means plain click. */
  choose?: string[]
  /** How many choose labels "Show option" has already pointed at. */
  chooseShown?: number
  /** False for targetless steps (anchored at the cursor, no Wrong-spot button). */
  located: boolean
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

export interface NotDoneLabel {
  explanation: string
}

export interface MarkerPoint extends AnchorPoint {
  step?: StepLabel
  recovery?: RecoveryLabel
  look?: LookLabel
  /** Failed step verification; renders "not done yet" with two buttons. */
  notDone?: NotDoneLabel
  /** Free-query target text; renders a bubble with a Wrong-spot button. */
  query?: string
  /** Drag destination in window points; renders a second ring + arrow. */
  drop?: AnchorPoint
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
  target: string | null
  caution: string | null
  action: StepAction
  text?: string
  keys?: string[]
  choose?: string[]
}

export interface SaveCodeRequest {
  filename: string
  content: string
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

/** Open discovery UI: clarify questions with chips, or a brief to confirm. */
export interface DiscoveryView {
  phase: 'clarify' | 'confirm'
  questions: { text: string; options: string[] }[]
  brief: string[]
}

/** One chat in a workspace's sidebar list (also the on-disk index entry). */
export interface ChatIndexEntry {
  id: string
  title: string
  /** True when the user renamed the chat; auto-titles stop overwriting it. */
  customTitle: boolean
  createdAt: number
  updatedAt: number
  app: string | null
  goal: string | null
  currentStepIndex: number
  planLength: number
}

export interface ChatSnapshot {
  messages: ChatMessageView[]
  /** Chats of the current workspace, newest first. Empty without a workspace. */
  chats: ChatIndexEntry[]
  /** Id of the chat being viewed, or null for an unsaved new chat. */
  currentChatId: string | null
  hasPlan: boolean
  plan: PlanStepView[]
  currentStepIndex: number
  busy: boolean
  notice: string | null
  collapsed: boolean
  workspaceName: string | null
  app: string | null
  greeting: GreetingView | null
  verifySteps: boolean
  /** True when the current workspace is a Godot project folder (code can be saved). */
  canSaveCode: boolean
  /** App the user must open before continuing (shows the "I'm ready" card). */
  needsApp: string | null
  /** Open discovery dialogue (shows questions or the confirm card). */
  discovery: DiscoveryView | null
  /** App currently being web-researched, if any. */
  researching: string | null
  /** Stored web research for this workspace, if any. */
  research: ResearchView | null
  /** One-sentence plan goal, for the HUD title. */
  goal: string | null
  /** Pointing paused from the HUD: markers hidden until Resume. */
  paused: boolean
  /** HUD step window currently open (highlights the chat header button). */
  hudOpen: boolean
}

/** One global hotkey: the Electron accelerator plus its help-panel rendering. */
export interface GlobalShortcutDef {
  accelerator: string
  /** Display keys, one key cap each (e.g. ["⌘", "⇧", "Space"]). */
  keys: string[]
  description: string
}

/**
 * Single source of truth for the global hotkeys. The main process registers
 * from this list and the chat help panel renders it, so the two cannot drift.
 * Order: point, chat, look, HUD.
 */
export const GLOBAL_SHORTCUTS: readonly GlobalShortcutDef[] = [
  {
    accelerator: 'CommandOrControl+Shift+Space',
    keys: ['⌘', '⇧', 'Space'],
    description: 'Ask where something is, and SH-01 points to it'
  },
  {
    accelerator: 'CommandOrControl+Alt+A',
    keys: ['⌘', '⌥', 'A'],
    description: 'Open or hide the chat'
  },
  {
    accelerator: 'CommandOrControl+Alt+L',
    keys: ['⌘', '⌥', 'L'],
    description: "Ask about what's under your cursor"
  },
  {
    accelerator: 'CommandOrControl+Alt+P',
    keys: ['⌘', '⌥', 'P'],
    description: 'Open or hide the step remote'
  }
]

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
  onDismiss: (cb: () => void) => () => void
  onIslandHover: (cb: (inside: boolean) => void) => () => void
  // Overlay: step bubble (clickable island in the click-through overlay)
  reportIslands: (rects: Rect[]) => void
  bubbleNext: () => void
  bubbleRetry: () => void
  bubbleDone: () => void
  bubbleWrongSpot: () => void
  bubbleShowOption: () => void
  bubbleForceNext: () => void
  bubbleClose: () => void
  copyText: (text: string) => void
  openSettings: () => void
  // Advisor chat window
  chatReady: () => void
  chatSend: (text: string, withScreenshot: boolean) => void
  chatShowMe: () => void
  chatNext: () => void
  chatBack: () => void
  chatContinue: () => void
  chatToggleVerify: () => void
  chatToggleCollapsed: (source: 'button' | 'tab') => void
  chatSelectProject: () => void
  chatCreateWorkspace: (name: string) => void
  chatClearHistory: () => void
  chatDeleteAllHistory: () => void
  chatStartNew: () => void
  chatAppReady: () => void
  chatSaveCode: (req: SaveCodeRequest) => void
  chatNewChat: () => void
  chatSwitchChat: (id: string) => void
  chatRenameChat: (id: string, title: string) => void
  chatDeleteChat: (id: string) => void
  // HUD step window (reuses chat:/bubble: handlers; only these are HUD-specific)
  hudToggle: () => void
  hudPause: () => void
  hudOpenChat: () => void
  hudHeight: (height: number) => void
  openLink: (url: string) => void
  onTabCursor: (cb: (offset: AnchorPoint) => void) => () => void
  onChatSnapshot: (cb: (snap: ChatSnapshot) => void) => () => void
}
