import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type Display
} from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import {
  describeStep,
  GLOBAL_SHORTCUTS,
  type ChatIndexEntry,
  type ChatSnapshot,
  type MarkerPoint,
  type Rect,
  type StepLabel
} from '../shared/api'
import {
  askAboutCrop,
  chat as advisorChat,
  recover as advisorRecover,
  researchApp,
  verifyStep,
  type CodeBlock
} from './advisor'
import {
  captureCursorCrop,
  capturePrimaryShot,
  isMissingApiKey,
  locate,
  MISSING_KEY_MESSAGE,
  type CursorCrop,
  type LocateResult,
  type ScreenShot
} from './locate'
import { MODEL } from './modelConfig'
import {
  advance,
  canAdvance,
  currentStep,
  goBack,
  goToStep,
  hasPlan,
  replaceRemainingSteps,
  replaceRemainingStepsAt,
  resetSession,
  restoreSession,
  session,
  setPlan,
  stepContext,
  type PlanStep
} from './session'
import {
  clearHistory,
  clearLastWorkspace,
  deleteAllHistory,
  deleteChat,
  deriveTitle,
  getCurrentWorkspace,
  isGodotProject,
  loadChat,
  loadChatBounds,
  loadChatIndex,
  loadHudBounds,
  loadLastWorkspace,
  loadWorkspaceRegistry,
  migrateLegacyHistory,
  newChatId,
  persistChat,
  persistChatIndex,
  persistWorkspaceRegistry,
  saveChatBounds,
  saveHudBounds,
  saveLastWorkspace,
  setCurrentWorkspace,
  toStoredSession,
  workspaceKey,
  workspaceName,
  type StoredSession,
  type WorkspaceRef,
  type WorkspaceRegistryEntry
} from './history'

const CAPTURE_SETTLE_MS = 150
const MAX_QUERY_LEN = 500
/** Chat messages may be far longer than pointer queries; never truncate, block instead. */
const MAX_CHAT_LEN = 4000
const CHAT_W = 380
const CHAT_H = 560
const CHAT_MIN_W = 320
const CHAT_MIN_H = 420
const CHAT_EDGE_MARGIN = 16
/** Fixed tab window size. */
const TAB_W = 48
const TAB_H = 160
const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
const DEBUG = process.env['SH0_DEBUG'] === '1'

function debug(line: string): void {
  if (DEBUG) console.log(line)
}

let win: BrowserWindow | null = null
let chatWin: BrowserWindow | null = null
let chatCollapsed = false
let chatAutoCollapsed = false
/** Last expanded chat bounds this session (mirrored to userData). */
let chatBounds: Rect | null = null
let tabWin: BrowserWindow | null = null
/**
 * Capture hide state: whether each panel window was on screen when
 * hideChatAndTab ran. Null means no hide is pending (restore behaves
 * as if everything was on screen).
 */
let chatWasOnScreen: boolean | null = null
let tabWasOnScreen: boolean | null = null
let hudWin: BrowserWindow | null = null
/** HUD toggled on by the user (stays true while auto-hidden or capture-hidden). */
let hudOpen = false
/** HUD hidden because a marker target fell inside it; restored with the marker. */
let hudAutoHidden = false
/** Pause from the HUD: pointing stops until Resume. */
let pointingPaused = false
let pendingLook: { crop: CursorCrop; cursor: { x: number; y: number } } | null = null
let busy = false
let inputOpen = false
let chatNotice: string | null = null
let lastCursor: { x: number; y: number } = { x: 0, y: 0 }

interface ResumeGreeting {
  goal: string
  index: number
  total: number
}

let greeting: ResumeGreeting | null = null
/** App the user must open before the advisor can continue (shows the ready card). */
let pendingApp: string | null = null
/** App currently being web-researched, if any. */
let researchingApp: string | null = null
/** Chat being viewed, or null for an unsaved new chat. */
let currentChatId: string | null = null
/** Sidebar index for the current workspace (memory copy; disk converges via the write queue). */
let chatEntries: ChatIndexEntry[] = []
/** Known workspaces (memory copy of the registry; disk converges via the write queue). */
let workspaceEntries: WorkspaceRegistryEntry[] = []
/** Switch generation: only the latest async switch may restore its session. */
let switchSeq = 0

function primaryDisplay(): Display {
  return screen.getPrimaryDisplay()
}

/** Global screen points -> overlay window points, via the window's actual origin. */
export function globalToWindow(p: { x: number; y: number }, content: Rect): { x: number; y: number } {
  return { x: p.x - content.x, y: p.y - content.y }
}

/**
 * Normalized 0-1000 screenshot point -> overlay window points.
 * The screenshot covers the whole display (incl. the menu bar) while macOS
 * may keep the overlay below the menu bar, so subtract the window's actual
 * content origin instead of assuming it equals the display origin.
 */
export function normalizedToWindow(
  nx: number,
  ny: number,
  display: Rect,
  content: Rect
): { x: number; y: number } {
  return {
    x: display.x + (nx / 1000) * display.width - content.x,
    y: display.y + (ny / 1000) * display.height - content.y
  }
}

function toWindowPoint(w: BrowserWindow, p: { x: number; y: number }): { x: number; y: number } {
  return globalToWindow(p, w.getContentBounds())
}

function showInactive(w: BrowserWindow): void {
  if (!w.isVisible()) w.showInactive()
}

function sameRect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function loadRenderer(w: BrowserWindow, hash?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void w.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function createOverlay(): BrowserWindow {
  const bounds = primaryDisplay().bounds
  const w = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    enableLargerThanScreen: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // Try to cover the menu bar too; the coordinate conversion stays correct
  // either way since it reads the window's actual content origin.
  w.setBounds(bounds)
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.setIgnoreMouseEvents(true, { forward: true })
  w.on('closed', () => {
    if (win === w) win = null
  })
  loadRenderer(w)
  w.once('ready-to-show', () => showInactive(w))
  return w
}

function ensureOverlay(): BrowserWindow {
  if (!win || win.isDestroyed()) win = createOverlay()
  const bounds = primaryDisplay().bounds
  if (!sameRect(win.getBounds(), bounds)) win.setBounds(bounds)
  return win
}

function createChatWindow(): BrowserWindow {
  const start = expandedChatBounds()
  const w = new BrowserWindow({
    x: start.x,
    y: start.y,
    width: start.width,
    height: start.height,
    minWidth: CHAT_MIN_W,
    minHeight: CHAT_MIN_H,
    title: 'SH-01',
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 'floating' stays above apps but below the overlay ('screen-saver').
  w.setAlwaysOnTop(true, 'floating')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.on('moved', () => persistChatBounds(w))
  w.on('resized', () => persistChatBounds(w))
  w.on('closed', () => {
    if (chatWin === w) chatWin = null
  })
  loadRenderer(w, 'chat')
  return w
}

/**
 * Expanded bounds: last position/size, or the default spot near the right
 * edge on first launch. Always pulled inside the nearest work area, so a
 * display change can never strand the window off-screen.
 */
function expandedChatBounds(): Rect {
  const saved = chatBounds ?? loadChatBounds()
  if (!saved) {
    const area = primaryDisplay().workArea
    return {
      x: area.x + area.width - CHAT_W - CHAT_EDGE_MARGIN,
      y: area.y + Math.floor((area.height - CHAT_H) / 2),
      width: Math.min(CHAT_W, area.width),
      height: Math.min(CHAT_H, area.height)
    }
  }
  const area = screen.getDisplayMatching(saved).workArea
  const width = Math.min(Math.max(saved.width, CHAT_MIN_W), area.width)
  const height = Math.min(Math.max(saved.height, CHAT_MIN_H), area.height)
  return {
    x: Math.min(Math.max(saved.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(saved.y, area.y), area.y + area.height - height),
    width,
    height
  }
}

/** Remember expanded bounds in memory and userData; tab bounds are never saved. */
function persistChatBounds(w: BrowserWindow): void {
  if (chatCollapsed || w.isDestroyed()) return
  const b = w.getBounds()
  chatBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
  saveChatBounds(chatBounds)
}

/** Chat window bounds (expanded state only; the tab is a separate window). */
function applyChatBounds(w: BrowserWindow): void {
  if (process.platform === 'darwin') w.setWindowButtonVisibility(true)
  w.setTitle('SH-01')
  w.setMinimumSize(CHAT_MIN_W, CHAT_MIN_H)
  w.setMaximumSize(0, 0) // 0,0 = unbounded (the constructor default)
  w.setResizable(true)
  w.setMovable(true)
  w.setBounds(expandedChatBounds())
}

function createTabWindow(): BrowserWindow {
  const area = primaryDisplay().workArea
  const w = new BrowserWindow({
    x: area.x + area.width - TAB_W,
    y: area.y + Math.floor((area.height - TAB_H) / 2),
    width: TAB_W,
    height: TAB_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 'floating' stays above apps but below the overlay ('screen-saver').
  w.setAlwaysOnTop(true, 'floating')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.on('closed', () => {
    if (tabWin === w) tabWin = null
  })
  loadRenderer(w, 'tab')
  return w
}

function ensureTabWindow(): BrowserWindow {
  if (!tabWin || tabWin.isDestroyed()) tabWin = createTabWindow()
  return tabWin
}

function ensureChatWindow(): BrowserWindow {
  if (!chatWin || chatWin.isDestroyed()) {
    chatWin = createChatWindow()
    applyChatBounds(chatWin)
  }
  return chatWin
}

const HUD_W = 300
const HUD_MIN_H = 120
const HUD_MAX_H = 420

/** Last HUD position: saved bounds, else the top-right of the work area. */
function hudBounds(): { x: number; y: number } {
  const saved = loadHudBounds()
  const area = primaryDisplay().workArea
  if (saved) {
    const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - HUD_W)
    const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - HUD_MIN_H)
    return { x, y }
  }
  return { x: area.x + area.width - HUD_W - 16, y: area.y + 80 }
}

function createHudWindow(): BrowserWindow {
  const pos = hudBounds()
  const w = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: HUD_W,
    height: 200,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // 'floating' stays above apps but below the overlay ('screen-saver').
  w.setAlwaysOnTop(true, 'floating')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.on('moved', () => {
    if (w.isDestroyed()) return
    const b = w.getBounds()
    saveHudBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  })
  w.on('closed', () => {
    if (hudWin === w) hudWin = null
    hudOpen = false
    hudAutoHidden = false
  })
  loadRenderer(w, 'hud')
  return w
}

function ensureHudWindow(): BrowserWindow {
  if (!hudWin || hudWin.isDestroyed()) hudWin = createHudWindow()
  return hudWin
}

/** Pause hides all pointing; Resume re-shows the current step. */
function togglePause(): void {
  if (busy) return
  pointingPaused = !pointingPaused
  if (pointingPaused) {
    const w = win
    if (w && !w.isDestroyed()) w.webContents.send('overlay:dismiss')
    restoreAutoHiddenHud()
  }
  pushChatSnapshot()
  if (!pointingPaused) void showCurrentStep()
}

/** Toggle the HUD step window. Never activates (first click must just work). */
function toggleHud(): void {
  hudOpen = !hudOpen
  hudAutoHidden = false
  const w = ensureHudWindow()
  if (hudOpen) {
    if (!w.isVisible()) w.showInactive()
  } else if (w.isVisible()) {
    w.hide()
  }
  pushChatSnapshot()
}

type PanelSource = 'button' | 'hotkey' | 'tab' | 'auto'

/**
 * The single place that applies the panel state. Reads `chatCollapsed`,
 * never changes it: exactly one of the chat and tab windows is visible.
 */
function applyPanelState(): void {
  const chat = ensureChatWindow()
  const tab = ensureTabWindow()
  if (chatCollapsed) {
    if (chat.isVisible()) chat.hide()
    if (!tab.isVisible()) tab.showInactive()
  } else {
    if (tab.isVisible()) tab.hide()
    if (!chat.isVisible()) chat.showInactive()
    applyChatBounds(chat)
  }
  pushChatSnapshot()
}

/** The single place that CHANGES the panel state. */
function setPanelState(collapsed: boolean, source: PanelSource, auto = false): void {
  const w = ensureChatWindow()
  if (collapsed && !chatCollapsed) persistChatBounds(w)
  chatCollapsed = collapsed
  chatAutoCollapsed = auto && collapsed
  debug(`[panel] state=${collapsed ? 'collapsed' : 'expanded'} source=${source}`)
  applyPanelState()
  syncTabCursorPoll()
}

/**
 * Re-show the chat or tab window after a capture, whichever matches the
 * panel state — but only if it was on screen when hideChatAndTab ran.
 * A minimized chat stays minimized. Never activates.
 */
function restoreChatAfterCapture(): void {
  if (chatCollapsed) {
    const tab = tabWin
    if ((tabWasOnScreen ?? true) && tab && !tab.isDestroyed() && !tab.isVisible()) {
      tab.showInactive()
    }
  } else {
    const chat = chatWin
    if ((chatWasOnScreen ?? true) && chat && !chat.isDestroyed() && !chat.isVisible()) {
      chat.showInactive()
    }
  }
  const hud = hudWin
  if (hudOpen && !hudAutoHidden && hud && !hud.isDestroyed() && !hud.isVisible()) {
    hud.showInactive()
  }
  chatWasOnScreen = null
  tabWasOnScreen = null
}

/**
 * Hide chat, tab, and HUD for captures. Restore with restoreChatAfterCapture().
 * Records whether the chat and tab were actually on screen (a minimized or
 * hidden window is not); a minimized chat is left untouched.
 */
function hideChatAndTab(): void {
  const chat = chatWin
  if (chat && !chat.isDestroyed()) {
    chatWasOnScreen = chat.isVisible() && !chat.isMinimized()
    if (!chat.isMinimized()) chat.hide()
  } else {
    chatWasOnScreen = false
  }
  const tab = tabWin
  if (tab && !tab.isDestroyed()) {
    tabWasOnScreen = tab.isVisible() && !tab.isMinimized()
    if (!tab.isMinimized()) tab.hide()
  } else {
    tabWasOnScreen = false
  }
  const hud = hudWin
  if (hud && !hud.isDestroyed()) hud.hide()
}

function toggleChat(): void {
  if (chatCollapsed) {
    if (process.platform === 'darwin') app.show()
    setPanelState(false, 'hotkey')
    ensureChatWindow().focus()
    return
  }
  const w = ensureChatWindow()
  if (!w.isVisible()) {
    if (process.platform === 'darwin') app.show()
    applyPanelState()
    w.focus()
    return
  }
  setPanelState(true, 'hotkey')
}

/** Collapse the panel when a marker target falls inside it. Overlay coords in. */
function collapseChatForPoint(pt: { x: number; y: number }): void {
  const chat = chatWin
  const overlay = win
  if (chat && !chat.isDestroyed() && chat.isVisible() && !chatCollapsed) {
    if (overlay && !overlay.isDestroyed()) {
      const oc = overlay.getContentBounds()
      const sx = oc.x + pt.x
      const sy = oc.y + pt.y
      const b = chat.getBounds()
      if (sx >= b.x && sx < b.x + b.width && sy >= b.y && sy < b.y + b.height) {
        setPanelState(true, 'auto', true)
      }
    }
  }
  hideHudForPoint(pt)
}

/** Hide the HUD while a marker target (or drop point) falls inside it. Overlay coords in. */
function hideHudForPoint(pt: { x: number; y: number }): void {
  if (!hudOpen) return
  const hud = hudWin
  const overlay = win
  if (!hud || hud.isDestroyed() || !overlay || overlay.isDestroyed()) return
  const oc = overlay.getContentBounds()
  const sx = oc.x + pt.x
  const sy = oc.y + pt.y
  const b = hud.getBounds()
  if (sx >= b.x && sx < b.x + b.width && sy >= b.y && sy < b.y + b.height) {
    hudAutoHidden = true
    if (hud.isVisible()) hud.hide()
  }
}

/** Re-show an auto-hidden HUD once its marker is gone. */
function restoreAutoHiddenHud(): void {
  if (!hudAutoHidden) return
  hudAutoHidden = false
  const hud = hudWin
  if (hudOpen && hud && !hud.isDestroyed() && !hud.isVisible()) hud.showInactive()
}

/** Overlay-coords point inside a window's screen bounds? */
function pointInWindow(
  pt: { x: number; y: number },
  overlayContent: { x: number; y: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  const sx = overlayContent.x + pt.x
  const sy = overlayContent.y + pt.y
  return sx >= b.x && sx < b.x + b.width && sy >= b.y && sy < b.y + b.height
}

/**
 * Expand an auto-collapsed chat once marker point(s) are known — but only when
 * every point is outside the chat bounds (drag passes source and drop).
 */
function expandChatIfOutside(...pts: { x: number; y: number }[]): void {
  if (!chatAutoCollapsed) return
  const chat = chatWin
  const overlay = win
  if (!chat || chat.isDestroyed() || !overlay || overlay.isDestroyed()) return
  const oc = overlay.getContentBounds()
  const b = chat.getBounds()
  if (pts.every((pt) => !pointInWindow(pt, oc, b))) setPanelState(false, 'auto')
}

/**
 * Re-show an auto-hidden HUD once marker point(s) are known — but only when
 * every point is outside the HUD bounds (drag passes source and drop).
 */
function restoreAutoHiddenHudUnlessInside(...pts: { x: number; y: number }[]): void {
  if (!hudAutoHidden) return
  const hud = hudWin
  const overlay = win
  if (!hudOpen || !hud || hud.isDestroyed() || !overlay || overlay.isDestroyed()) {
    hudAutoHidden = false
    return
  }
  const oc = overlay.getContentBounds()
  const b = hud.getBounds()
  if (pts.some((pt) => pointInWindow(pt, oc, b))) return
  hudAutoHidden = false
  if (!hud.isVisible()) hud.showInactive()
}

function onHotkey(): void {
  // With an active plan, Space re-points at the current step instead of
  // opening the free-query box.
  if (hasPlan()) {
    void showCurrentStep()
    return
  }
  const w = ensureOverlay()
  if (process.platform === 'darwin') app.show()
  lastCursor = screen.getCursorScreenPoint()
  if (!w.isVisible()) w.show()
  app.focus({ steal: true })
  w.focus()
  stopIslandPoll()
  setOverlayClickable(true)
  inputOpen = true
  w.webContents.send('overlay:show-input', { ...toWindowPoint(w, lastCursor), mode: 'point' })
}

/** "Look at my cursor": capture a crop around it, then ask what about it. */
function onLookHotkey(): void {
  if (busy) return
  const w = ensureOverlay()
  if (process.platform === 'darwin') app.show()
  const cursor = screen.getCursorScreenPoint()
  const anchor = toWindowPoint(w, cursor)
  if (screenAccessBlocked()) {
    releaseToPreviousApp(w)
    w.webContents.send('overlay:message', {
      ...anchor,
      text: 'Allow Screen Recording in System Settings → Privacy & Security, then restart',
      action: 'open-settings'
    })
    return
  }
  if (isMissingApiKey()) {
    releaseToPreviousApp(w)
    w.webContents.send('overlay:message', {
      ...anchor,
      text: MISSING_KEY_MESSAGE
    })
    return
  }
  busy = true
  w.hide()
  hideChatAndTab()
  void (async () => {
    await sleep(CAPTURE_SETTLE_MS)
    let crop
    try {
      crop = await captureCursorCrop()
    } catch {
      busy = false
      showInactive(w)
      restoreChatAfterCapture()
      w.webContents.send('overlay:message', { ...anchor, text: 'Screen capture failed — try again' })
      return
    }
    pendingLook = { crop, cursor }
    lastCursor = cursor
    busy = false
    showInactive(w)
    restoreChatAfterCapture()
    if (!w.isVisible()) w.show()
    app.focus({ steal: true })
    w.focus()
    stopIslandPoll()
    setOverlayClickable(true)
    inputOpen = true
    w.webContents.send('overlay:show-input', {
      ...toWindowPoint(w, cursor),
      mode: 'look'
    })
  })()
}

/** Session context for a cursor question: goal plus current plan step, if any. */
function lookContext(): string | undefined {
  const parts: string[] = []
  if (session.goal) parts.push(`User's goal: ${session.goal}`)
  const step = currentStep()
  if (step) {
    parts.push(
      `Current plan step ${session.currentStepIndex + 1} of ${session.plan.length}: ${step.instruction} (looking for: ${step.target})`
    )
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/** Goal + plan with the current step marked, for advisor continuity. */
function planContext(): string | undefined {
  if (
    !session.goal &&
    !hasPlan() &&
    !session.research &&
    !session.brief &&
    !session.questions &&
    !session.pendingBrief
  ) {
    return undefined
  }
  const lines = ['Ongoing session state (use for continuity, do not repeat verbatim):']
  if (session.goal) lines.push(`Goal: ${session.goal}`)
  if (session.brief && session.brief.length > 0) {
    lines.push(`User's confirmed brief:\n${session.brief.map((b) => `- ${b}`).join('\n')}`)
  }
  if (session.questions && session.questions.length > 0) {
    lines.push(
      'Open discovery questions ' +
        `(clarify round ${session.clarifyRounds} of max 2 — then summarize a brief):\n` +
        session.questions.map((q) => `- ${q.text} (options: ${q.options.join(' / ')})`).join('\n')
    )
  }
  if (session.pendingBrief && session.pendingBrief.length > 0) {
    // A pending brief plus a pending app means the user already said yes and
    // is past "I'm ready": confirmed, plan directly instead of re-asking.
    lines.push(
      pendingApp
        ? "User's CONFIRMED brief (already confirmed — plan directly, do not ask for confirmation again):\n" +
            session.pendingBrief.map((b) => `- ${b}`).join('\n')
        : 'Brief awaiting user confirmation ' +
            '(plan only after they confirm or press "Skip questions"):\n' +
            session.pendingBrief.map((b) => `- ${b}`).join('\n')
    )
  }
  if (session.research) {
    lines.push(
      `Web research on ${session.research.app} (from official docs, use it for exact steps):\n${session.research.summary}`
    )
  }
  if (hasPlan()) {
    lines.push(`Plan (step ${session.currentStepIndex + 1} of ${session.plan.length} is current):`)
    session.plan.forEach((s, i) => {
      const mark =
        i < session.currentStepIndex ? 'done' : i === session.currentStepIndex ? 'CURRENT' : 'next'
      lines.push(`${i + 1}. ${describeStep(s)} [${mark}]`)
    })
  }
  return lines.join('\n')
}

function sessionIsEmpty(): boolean {
  return session.messages.length === 0 && session.goal === null && session.plan.length === 0
}

/**
 * Capture the current chat id plus a deep copy of the session, synchronously
 * at the trigger moment, updating the in-memory index. The returned payload
 * is safe to persist after any later switch: it can only ever land in its own
 * chat file. Null without a workspace or when the session is still empty.
 */
function captureChatSave(): {
  ref: WorkspaceRef
  id: string
  stored: StoredSession
  entries: ChatIndexEntry[]
} | null {
  const ref = getCurrentWorkspace()
  if (!ref || sessionIsEmpty()) return null
  if (!currentChatId) currentChatId = newChatId()
  const id = currentChatId
  const stored = toStoredSession(session)
  const existing = chatEntries.find((e) => e.id === id)
  if (existing) {
    existing.updatedAt = stored.updatedAt
    existing.app = stored.app
    existing.goal = stored.goal
    existing.currentStepIndex = stored.currentStepIndex
    existing.planLength = stored.plan.length
    if (!existing.customTitle) existing.title = deriveTitle(stored.goal, stored.messages)
  } else {
    chatEntries.push({
      id,
      title: deriveTitle(stored.goal, stored.messages),
      customTitle: false,
      createdAt: stored.updatedAt,
      updatedAt: stored.updatedAt,
      app: stored.app,
      goal: stored.goal,
      currentStepIndex: stored.currentStepIndex,
      planLength: stored.plan.length
    })
  }
  return { ref, id, stored, entries: chatEntries.map((e) => ({ ...e })) }
}

function historyUnavailableNotice(): void {
  const unavailable = 'History is unavailable — encryption is not enabled on this Mac'
  if (chatNotice !== unavailable) {
    chatNotice = unavailable
    pushChatSnapshot()
  }
}

/** Persist the live session into its own chat (async; failure surfaces as a notice). */
function saveCurrentChat(): void {
  const captured = captureChatSave()
  if (!captured) return
  void persistChat(captured.ref, captured.id, captured.stored, captured.entries).then((ok) => {
    if (!ok) historyUnavailableNotice()
  })
}

/**
 * Record an opened workspace in the registry (deduped by storage key) and
 * persist it. Opening an existing name or folder just refreshes its time.
 */
/** Deep copy of the registry for a queued persist (the live array keeps moving). */
function snapshotWorkspaceRegistry(): WorkspaceRegistryEntry[] {
  return workspaceEntries.map((e) => ({
    ref: { ...e.ref } as WorkspaceRef,
    lastOpenedAt: e.lastOpenedAt
  }))
}

function persistRegistryCopy(): void {
  void persistWorkspaceRegistry(snapshotWorkspaceRegistry()).then((ok) => {
    if (!ok) historyUnavailableNotice()
  })
}

/**
 * Record an opened workspace in the registry (deduped by storage key) and
 * persist it. Opening an existing name or folder just refreshes its time.
 */
function touchWorkspaceRegistry(ref: WorkspaceRef): void {
  const key = workspaceKey(ref)
  const existing = workspaceEntries.find((e) => workspaceKey(e.ref) === key)
  if (existing) existing.lastOpenedAt = Date.now()
  else workspaceEntries.push({ ref, lastOpenedAt: Date.now() })
  persistRegistryCopy()
}

/** Switch to a workspace, restoring its newest chat or starting fresh. */
async function openWorkspace(ref: WorkspaceRef): Promise<void> {
  const keepSession =
    getCurrentWorkspace() === null &&
    (session.messages.length > 0 || session.goal !== null || session.plan.length > 0)
  // Park the previous workspace's session before switching stores.
  saveCurrentChat()
  setCurrentWorkspace(ref)
  saveLastWorkspace(ref)
  touchWorkspaceRegistry(ref)
  currentChatId = null
  chatEntries = []
  const migrated = await migrateLegacyHistory(ref)
  if (migrated) {
    chatEntries = migrated.entries
    currentChatId = migrated.firstId
  } else {
    chatEntries = await loadChatIndex(ref)
  }
  const newest = [...chatEntries].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const data = newest ? await loadChat(ref, newest.id) : null
  if (data && newest) {
    currentChatId = newest.id
    restoreSession(data)
    greeting =
      data.goal && data.plan.length > 0
        ? { goal: data.goal, index: data.currentStepIndex, total: data.plan.length }
        : null
  } else {
    if (!keepSession) resetSession()
    greeting = null
  }
  pendingApp = null
  researchingApp = null
  pushChatSnapshot()
}

/** Park the current chat and start an empty session in the same workspace. */
function startNewChat(): void {
  saveCurrentChat()
  resetSession()
  currentChatId = null
  greeting = null
  pendingApp = null
  researchingApp = null
  chatNotice = null
  pushChatSnapshot()
}

/** Clickable islands in screen coords, reported by the overlay renderer. */
let islandRects: Rect[] = []
let islandTimer: NodeJS.Timeout | null = null
let overlayClickable = false
/** Last hover state sent to the overlay (pauses free-query bubble timers). */
let islandHover = false
const ISLAND_POLL_MS = 50

/** Cursor offset sampler for the collapsed tab face: 5Hz, tab-visible only. */
let tabCursorTimer: NodeJS.Timeout | null = null
const TAB_CURSOR_MS = 200

function tabCursorTick(): void {
  const tab = tabWin
  if (!chatCollapsed || !tab || tab.isDestroyed() || !tab.isVisible()) return
  const b = tab.getBounds()
  const c = screen.getCursorScreenPoint()
  tab.webContents.send('chat:cursor', {
    x: Math.round(c.x - (b.x + b.width / 2)),
    y: Math.round(c.y - (b.y + b.height / 2))
  })
}

function syncTabCursorPoll(): void {
  if (chatCollapsed && tabCursorTimer === null) {
    tabCursorTimer = setInterval(tabCursorTick, TAB_CURSOR_MS)
  } else if (!chatCollapsed && tabCursorTimer !== null) {
    clearInterval(tabCursorTimer)
    tabCursorTimer = null
  }
}

/** Single writer for overlay click-through. */
function setOverlayClickable(clickable: boolean): void {
  const w = win
  if (!w || w.isDestroyed()) return
  if (clickable === overlayClickable) return
  overlayClickable = clickable
  if (clickable) w.setIgnoreMouseEvents(false)
  else w.setIgnoreMouseEvents(true, { forward: true })
}

/** Stop island polling and restore click-through (unless the query box is open). */
function stopIslandPoll(): void {
  if (islandTimer !== null) {
    clearInterval(islandTimer)
    islandTimer = null
  }
  islandRects = []
  islandHover = false
  // An empty report racing an opening query box must not steal its clicks.
  if (!inputOpen) setOverlayClickable(false)
}

function pollIslands(): void {
  const w = win
  if (!w || w.isDestroyed() || islandRects.length === 0) {
    stopIslandPoll()
    return
  }
  const c = screen.getCursorScreenPoint()
  const inside = islandRects.some(
    (r) => c.x >= r.x && c.x < r.x + r.width && c.y >= r.y && c.y < r.y + r.height
  )
  setOverlayClickable(inside)
  if (inside !== islandHover) {
    islandHover = inside
    w.webContents.send('overlay:island-hover', inside)
  }
}

/** Primary display work area in overlay-window points, for robot/bubble layout. */
function windowWorkArea(w: BrowserWindow): Rect {
  const c = w.getContentBounds()
  const wa = primaryDisplay().workArea
  return { x: wa.x - c.x, y: wa.y - c.y, width: wa.width, height: wa.height }
}

/**
 * Return focus to the previously active app while keeping the overlay
 * visible: hiding the window defocuses us, re-showing inactive does not
 * steal focus back.
 */
function releaseToPreviousApp(w: BrowserWindow): void {
  w.hide()
  showInactive(w)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function screenAccessBlocked(): boolean {
  if (process.platform !== 'darwin') return false
  const status = systemPreferences.getMediaAccessStatus('screen')
  // 'not-determined' (or 'unknown') falls through: the getSources call in
  // capturePrimaryShot triggers the macOS permission prompt.
  return status === 'denied' || status === 'restricted'
}

interface PointRequest {
  target: string
  context?: string
  label?: StepLabel
  look?: string
  /** Drag destination; when set, both endpoints are located on one screenshot. */
  dropTarget?: string
  anchor: { x: number; y: number }
}

/** Latest shown marker: the request plus its normalized (0-1000) point(s). Powers Wrong-spot retries. */
let lastMarker: {
  req: PointRequest
  x: number
  y: number
  dx?: number
  dy?: number
  /** Next choose index for a select step's "Show option" (how many already shown). */
  optIndex?: number
} | null = null

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 } as const

/** Locate once, retrying once with the retry kind unless confidence is high. */
async function locateWithRetry(
  target: string,
  context: string | undefined,
  shot: ScreenShot,
  tag: string
): Promise<LocateResult> {
  const result = await locate(target, context, shot)
  if (result.confidence === 'high') return result
  try {
    const retry = await locate(target, context, shot, 'locate_retry')
    debug(`[point] auto-retry ${tag}${result.confidence}->${retry.confidence} found=${retry.found}`)
    // Never trade a found result for an unfound one.
    if (
      CONFIDENCE_RANK[retry.confidence] > CONFIDENCE_RANK[result.confidence] &&
      (retry.found || !result.found)
    ) {
      return retry
    }
  } catch {
    // Keep the first result.
  }
  return result
}

/** Same-spot radius on the 0-1000 scale: a retry landing inside it is "unsure". */
const RETRY_SAME_SPOT_UNITS = 20

/** Locate outcome on an existing screenshot. Pure compute, no UI. */
interface StepLocateResult {
  source: LocateResult
  dest?: LocateResult
}

/**
 * Locate a step target (and optional drop target) on an existing screenshot.
 * Pure compute, no UI: returns null when a locate call throws, so callers can
 * show their own failure UI. found=false is a real result, not an error.
 */
async function locateStepTarget(
  target: string,
  dropTarget: string | undefined,
  context: string | undefined,
  shot: ScreenShot
): Promise<StepLocateResult | null> {
  try {
    if (dropTarget) {
      const [source, dest] = await Promise.all([
        locateWithRetry(target, context, shot, 'src '),
        locateWithRetry(dropTarget, context, shot, 'drop ')
      ])
      return { source, dest }
    }
    return { source: await locateWithRetry(target, context, shot, '') }
  } catch {
    return null
  }
}

/** Hide the overlay, capture, locate the target, and show the marker. Shared by
 * free queries ("what/where") and guided plan steps ("show me"). */
async function pointAt(req: PointRequest): Promise<void> {
  const w = win
  if (!w || w.isDestroyed() || busy || pointingPaused) return
  busy = true
  pushChatSnapshot()
  try {
    w.webContents.send('overlay:hide-input')
    inputOpen = false
    setOverlayClickable(false)

    if (screenAccessBlocked()) {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...req.anchor,
        text: 'Allow Screen Recording in System Settings → Privacy & Security, then restart',
        action: 'open-settings'
      })
      return
    }
    if (isMissingApiKey()) {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...req.anchor,
        text: MISSING_KEY_MESSAGE
      })
      return
    }

    w.hide()
    hideChatAndTab()
    await sleep(CAPTURE_SETTLE_MS)
    let shot
    try {
      shot = await capturePrimaryShot()
    } catch {
      restoreChatAfterCapture()
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', { ...req.anchor, text: 'Screen capture failed — try again' })
      return
    }
    restoreChatAfterCapture()
    showInactive(w)
    w.webContents.send('overlay:looking', req.anchor)

    if (req.dropTarget) {
      await pointAtDrag(w, req, shot)
    } else {
      const located = await locateStepTarget(req.target, undefined, req.context, shot)
      if (!located) {
        w.webContents.send('overlay:message', { ...req.anchor, text: 'Lookup failed — try again' })
        return
      }
      const result = located.source
      debug(`[point] mode=${req.label ? 'step' : 'query'} found=${result.found} conf=${result.confidence}`)
      if (!result.found) {
        if (req.label) {
          await attemptRecovery(req, w)
          return
        }
        w.webContents.send('overlay:message', { ...req.anchor, text: "I couldn't find it" })
        return
      }
      showMarker(w, req, result.x, result.y)
      lastMarker = { req, x: result.x, y: result.y }
    }
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

/**
 * Drag step: locate source and destination on the same screenshot in
 * parallel (each with its own auto-retry), then mark both. Recovery names
 * whichever endpoint is missing.
 */
async function pointAtDrag(w: BrowserWindow, req: PointRequest, shot: ScreenShot): Promise<void> {
  const dropTarget = req.dropTarget ?? ''
  const located = await locateStepTarget(req.target, dropTarget, req.context, shot)
  if (!located || !located.dest) {
    w.webContents.send('overlay:message', { ...req.anchor, text: 'Lookup failed — try again' })
    return
  }
  const { source, dest } = located
  debug(
    `[point] mode=drag found=${source.found && dest.found} ` +
      `src=${source.confidence} drop=${dest.confidence}`
  )
  if (!source.found || !dest.found) {
    if (req.label) {
      const missing = !source.found && !dest.found ? `${req.target} and ${dropTarget}` : !source.found ? req.target : dropTarget
      await attemptRecovery(req, w, missing)
      return
    }
    w.webContents.send('overlay:message', { ...req.anchor, text: "I couldn't find it" })
    return
  }
  showMarker(w, req, source.x, source.y, dest.x, dest.y)
  lastMarker = { req, x: source.x, y: source.y, dx: dest.x, dy: dest.y }
}

/** Convert normalized point(s) to window coords and show the marker + bubble. */
function showMarker(
  w: BrowserWindow,
  req: PointRequest,
  x: number,
  y: number,
  dx?: number,
  dy?: number
): void {
  const bounds = primaryDisplay().bounds
  const content = w.getContentBounds()
  const pt: MarkerPoint = {
    ...normalizedToWindow(x, y, bounds, content),
    // Flight start for the robot; the bubble is clickable via island polling.
    cursor: globalToWindow(screen.getCursorScreenPoint(), content),
    workArea: windowWorkArea(w)
  }
  if (req.label) pt.step = req.label
  if (req.look) pt.look = { answer: req.look }
  if (!req.label && !req.look) pt.query = req.target
  if (dx !== undefined && dy !== undefined) {
    pt.drop = normalizedToWindow(dx, dy, bounds, content)
    collapseChatForPoint(pt.drop)
  }
  collapseChatForPoint(pt)
  w.webContents.send('overlay:marker', pt)
}

/**
 * "Wrong spot": recapture and re-locate with the retry quality setting,
 * telling the model its previous guess was wrong. A retry landing on
 * ~the same spot becomes an unsure message instead of a new marker.
 */
async function handleWrongSpot(): Promise<void> {
  const w = win
  const prev = lastMarker
  if (!w || w.isDestroyed() || busy || !prev || pointingPaused) return
  busy = true
  pushChatSnapshot()
  try {
    w.webContents.send('overlay:hide-input')
    inputOpen = false
    setOverlayClickable(false)

    if (screenAccessBlocked()) {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...prev.req.anchor,
        text: 'Allow Screen Recording in System Settings → Privacy & Security, then restart',
        action: 'open-settings'
      })
      return
    }
    if (isMissingApiKey()) {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...prev.req.anchor,
        text: MISSING_KEY_MESSAGE
      })
      return
    }

    w.hide()
    hideChatAndTab()
    await sleep(CAPTURE_SETTLE_MS)
    let shot
    try {
      shot = await capturePrimaryShot()
    } catch {
      restoreChatAfterCapture()
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', { ...prev.req.anchor, text: 'Screen capture failed — try again' })
      return
    }
    restoreChatAfterCapture()
    showInactive(w)
    w.webContents.send('overlay:looking', prev.req.anchor)

    if (prev.req.dropTarget && prev.dx !== undefined && prev.dy !== undefined) {
      await retryDragSpots(w, { req: prev.req, x: prev.x, y: prev.y, dx: prev.dx, dy: prev.dy }, shot)
    } else {
      const note = wrongSpotNote(prev.x, prev.y)
      let result: LocateResult
      try {
        result = await locate(
          prev.req.target,
          prev.req.context ? `${prev.req.context}\n${note}` : note,
          shot,
          'locate_retry'
        )
      } catch {
        lastMarker = null
        w.webContents.send('overlay:message', { ...prev.req.anchor, text: 'Lookup failed — try again' })
        return
      }
      debug(`[point] mode=${prev.req.label ? 'step' : 'query'} retry=true found=${result.found}`)
      if (!result.found) {
        lastMarker = null
        if (prev.req.label) {
          await attemptRecovery(prev.req, w)
          return
        }
        w.webContents.send('overlay:message', { ...prev.req.anchor, text: "I couldn't find it" })
        return
      }
      if (Math.hypot(result.x - prev.x, result.y - prev.y) < RETRY_SAME_SPOT_UNITS) {
        debug('[point] retry=unsure')
        lastMarker = null
        w.webContents.send('overlay:message', {
          ...prev.req.anchor,
          text: "I'm not sure. Can you describe it differently?"
        })
        return
      }
      showMarker(w, prev.req, result.x, result.y)
      lastMarker = { req: prev.req, x: result.x, y: result.y, optIndex: prev.optIndex }
    }
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

/**
 * "Show option": recapture and point at the next label of a select step's
 * choose list (the menu is open now). Each press advances one label; the new
 * request targets that label so Wrong spot retries the option, not the menu.
 */
async function handleShowOption(): Promise<void> {
  const w = win
  const prev = lastMarker
  const choose = prev?.req.label?.action === 'select' ? (prev.req.label.choose ?? []) : []
  const idx = prev?.optIndex ?? 0
  if (!w || w.isDestroyed() || busy || !prev || idx >= choose.length || pointingPaused) return
  const option = choose[idx] as string
  busy = true
  pushChatSnapshot()
  try {
    w.webContents.send('overlay:hide-input')
    inputOpen = false
    setOverlayClickable(false)

    if (screenAccessBlocked()) {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...prev.req.anchor,
        text: 'Allow Screen Recording in System Settings → Privacy & Security, then restart',
        action: 'open-settings'
      })
      return
    }
    if (isMissingApiKey()) {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...prev.req.anchor,
        text: MISSING_KEY_MESSAGE
      })
      return
    }

    w.hide()
    hideChatAndTab()
    await sleep(CAPTURE_SETTLE_MS)
    let shot
    try {
      shot = await capturePrimaryShot()
    } catch {
      restoreChatAfterCapture()
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', { ...prev.req.anchor, text: 'Screen capture failed — try again' })
      return
    }
    restoreChatAfterCapture()
    showInactive(w)
    w.webContents.send('overlay:looking', prev.req.anchor)

    let result: LocateResult
    try {
      result = await locateWithRetry(option, prev.req.context, shot, 'opt ')
    } catch {
      w.webContents.send('overlay:message', { ...prev.req.anchor, text: 'Lookup failed — try again' })
      return
    }
    debug(`[point] mode=select-opt found=${result.found} idx=${idx}`)
    if (!result.found) {
      await attemptRecovery(prev.req, w, option)
      return
    }
    const req: PointRequest = {
      ...prev.req,
      target: option,
      label: prev.req.label ? { ...prev.req.label, chooseShown: idx + 1 } : undefined
    }
    showMarker(w, req, result.x, result.y)
    lastMarker = { req, x: result.x, y: result.y, optIndex: idx + 1 }
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

function wrongSpotNote(x: number, y: number): string {
  return (
    `the previous guess at ${x},${y} on the 0-1000 scale was wrong, ` +
    'find a different element that matches the target'
  )
}

/** Wrong-spot for a drag step: re-locate both endpoints with previous-guess notes. */
async function retryDragSpots(
  w: BrowserWindow,
  prev: { req: PointRequest; x: number; y: number; dx: number; dy: number },
  shot: ScreenShot
): Promise<void> {
  const dropTarget = prev.req.dropTarget ?? ''
  const withNote = (target: string, x: number, y: number): Promise<LocateResult> =>
    locate(
      target,
      prev.req.context ? `${prev.req.context}\n${wrongSpotNote(x, y)}` : wrongSpotNote(x, y),
      shot,
      'locate_retry'
    )
  let source: LocateResult
  let dest: LocateResult
  try {
    ;[source, dest] = await Promise.all([
      withNote(prev.req.target, prev.x, prev.y),
      withNote(dropTarget, prev.dx, prev.dy)
    ])
  } catch {
    lastMarker = null
    w.webContents.send('overlay:message', { ...prev.req.anchor, text: 'Lookup failed — try again' })
    return
  }
  debug(`[point] mode=drag retry=true found=${source.found && dest.found}`)
  if (!source.found || !dest.found) {
    lastMarker = null
    if (prev.req.label) {
      const missing = !source.found && !dest.found ? `${prev.req.target} and ${dropTarget}` : !source.found ? prev.req.target : dropTarget
      await attemptRecovery(prev.req, w, missing)
      return
    }
    w.webContents.send('overlay:message', { ...prev.req.anchor, text: "I couldn't find it" })
    return
  }
  const sameSource = Math.hypot(source.x - prev.x, source.y - prev.y) < RETRY_SAME_SPOT_UNITS
  const sameDest = Math.hypot(dest.x - prev.dx, dest.y - prev.dy) < RETRY_SAME_SPOT_UNITS
  if (sameSource && sameDest) {
    debug('[point] retry=unsure')
    lastMarker = null
    w.webContents.send('overlay:message', {
      ...prev.req.anchor,
      text: "I'm not sure. Can you describe it differently?"
    })
    return
  }
  showMarker(w, prev.req, source.x, source.y, dest.x, dest.y)
  lastMarker = { req: prev.req, x: source.x, y: source.y, dx: dest.x, dy: dest.y }
}

/**
 * A plan step's target was not found: ask the advisor (with a fresh
 * screenshot) why it is not visible and what to click first, then point at
 * that recovery target. The step index is unchanged, so Show me retries the
 * original step afterwards.
 */
async function attemptRecovery(
  req: PointRequest,
  w: BrowserWindow,
  missing?: string
): Promise<{ x: number; y: number } | null> {
  const label = req.label
  if (!label) return null
  debug('[recover] called')
  w.hide()
  hideChatAndTab()
  await sleep(CAPTURE_SETTLE_MS)
  let shot
  try {
    shot = await capturePrimaryShot()
  } catch {
    restoreChatAfterCapture()
    releaseToPreviousApp(w)
    w.webContents.send('overlay:message', { ...req.anchor, text: "I couldn't find it" })
    return null
  }
  restoreChatAfterCapture()
  showInactive(w)
  // Re-anchor the thinking robot to the current cursor for the recovery call.
  w.webContents.send('overlay:looking', toWindowPoint(w, screen.getCursorScreenPoint()))

  let rec
  try {
    rec = await advisorRecover(
      {
        goal: session.goal,
        brief: session.brief,
        instruction: label.instruction,
        target: missing ?? req.target
      },
      shot
    )
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Unknown'
    debug(`[recover] result=error:${name}`)
    w.webContents.send('overlay:message', {
      ...req.anchor,
      text: "I couldn't find it, and recovery failed"
    })
    chatNotice = "I couldn't find it, and recovery failed"
    pushChatSnapshot()
    return null
  }
  debug(`[recover] result=${rec.recovery_target ? 'target' : 'null'}`)
  const showExplanation = (): void => {
    w.webContents.send('overlay:message', { ...req.anchor, text: rec.explanation })
    chatNotice = rec.explanation
    pushChatSnapshot()
  }
  if (!rec.recovery_target) {
    showExplanation()
    return null
  }

  let result
  try {
    result = await locate(rec.recovery_target, stepContext(), shot)
  } catch {
    showExplanation()
    return null
  }
  if (!result.found) {
    showExplanation()
    return null
  }
  const bounds = primaryDisplay().bounds
  const content = w.getContentBounds()
  const pt: MarkerPoint = {
    ...normalizedToWindow(result.x, result.y, bounds, content),
    recovery: { explanation: rec.explanation },
    cursor: globalToWindow(screen.getCursorScreenPoint(), content),
    workArea: windowWorkArea(w)
  }
  collapseChatForPoint(pt)
  w.webContents.send('overlay:marker', pt)
  return { x: pt.x, y: pt.y }
}

async function handleSubmit(rawTarget: string): Promise<void> {
  const w = win
  if (!w || w.isDestroyed() || busy) return
  const target = rawTarget.trim().slice(0, MAX_QUERY_LEN)
  if (!target) return
  await pointAt({ target, anchor: toWindowPoint(w, lastCursor) })
}

/** Answer a "look at my cursor" question from the pending crop. */
async function handleLookAsk(rawText: string): Promise<void> {
  const w = win
  const pending = pendingLook
  pendingLook = null
  if (!w || w.isDestroyed() || busy || !pending) return
  const question = rawText.trim().slice(0, MAX_QUERY_LEN)
  if (!question) return
  busy = true
  pushChatSnapshot()
  const anchor = toWindowPoint(w, pending.cursor)
  let correction: { target: string; context: string | undefined; answer: string } | null = null
  try {
    w.webContents.send('overlay:hide-input')
    inputOpen = false
    setOverlayClickable(false)
    showInactive(w)
    w.webContents.send('overlay:looking', anchor)
    const context = lookContext()
    let res
    try {
      res = await askAboutCrop(question, context, hasPlan(), pending.crop)
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status: unknown }).status
          : undefined
      w.webContents.send('overlay:message', {
        ...anchor,
        text: `Advisor error (${typeof status === 'number' ? status : 'unknown'})`
      })
      return
    }
    session.messages.push({ role: 'user', text: question })
    session.messages.push({ role: 'assistant', text: res.answer })
    pushChatSnapshot()
    if (!res.point_to) {
      const content = w.getContentBounds()
      w.webContents.send('overlay:marker', {
        ...anchor,
        look: { answer: res.answer },
        cursor: globalToWindow(screen.getCursorScreenPoint(), content),
        workArea: windowWorkArea(w)
      })
      return
    }
    correction = {
      target: res.point_to,
      context,
      answer: `Not this one, it's here.\n${res.answer}`
    }
  } finally {
    busy = false
    pushChatSnapshot()
  }
  if (correction) {
    await pointAt({
      target: correction.target,
      context: correction.context,
      anchor,
      look: correction.answer
    })
  }
}

/** Short bubble label for a drop target: quoted name, else first words. */
function shortDropLabel(dropTarget: string): string {
  const quoted = dropTarget.match(/"([^"]+)"/)
  const base = quoted && quoted[1] ? quoted[1] : dropTarget.split(/\s+/).slice(0, 6).join(' ')
  return base.length > 42 ? `${base.slice(0, 42)}…` : base
}

/** Point at the current plan step, labeled "Step N of M". */
/** Bubble label for a step, built from explicit index/total (not live state). */
function stepLabelFor(step: PlanStep, index: number, total: number): StepLabel {
  return {
    index: index + 1,
    total,
    instruction: step.instruction,
    caution: step.caution,
    action: step.action,
    text: step.text,
    dropShort: step.dropTarget ? shortDropLabel(step.dropTarget) : undefined,
    keys: step.keys,
    choose: step.choose,
    located: step.target !== null
  }
}

async function showCurrentStep(): Promise<void> {
  const step = currentStep()
  if (!step || busy || pointingPaused) return
  greeting = null
  const w = ensureOverlay()
  const anchor = toWindowPoint(w, screen.getCursorScreenPoint())
  const label = stepLabelFor(step, session.currentStepIndex, session.plan.length)
  if (!step.target) {
    showUnlocatedStep(w, anchor, label)
    return
  }
  await pointAt({
    target: step.target,
    context: stepContext(),
    label,
    dropTarget: step.dropTarget,
    anchor
  })
}

/** Targetless shortcut/read step: bubble at the cursor, no capture, no model call. */
function showUnlocatedStep(
  w: BrowserWindow,
  anchor: { x: number; y: number },
  label: StepLabel
): void {
  const content = w.getContentBounds()
  const pt: MarkerPoint = {
    ...anchor,
    cursor: globalToWindow(screen.getCursorScreenPoint(), content),
    workArea: windowWorkArea(w),
    step: label
  }
  lastMarker = null
  collapseChatForPoint(pt)
  w.webContents.send('overlay:marker', pt)
}

async function handleNext(): Promise<void> {
  if (!hasPlan() || busy) return
  if (!session.verifySteps) await advanceStep()
  else if (canAdvance()) await advanceWithVerify()
  else await verifyCurrentStep()
}

/**
 * Next with verification in one flow: a single capture, then verify the old
 * step and locate the new step in parallel on that same screenshot. The index
 * advances immediately so chat/HUD highlight the new step while thinking.
 */
async function advanceWithVerify(): Promise<void> {
  const w = win
  if (!w || w.isDestroyed() || busy || !hasPlan() || !canAdvance()) return
  busy = true
  pushChatSnapshot()
  let captures = 0
  try {
    if (screenAccessBlocked() || isMissingApiKey()) {
      // Same silent advance as today: release and take the legacy path.
      busy = false
      pushChatSnapshot()
      await advanceStep()
      return
    }
    // Same overlay setup as pointAt: dismiss input, restore click-through.
    w.webContents.send('overlay:hide-input')
    inputOpen = false
    setOverlayClickable(false)

    const anchor = toWindowPoint(w, screen.getCursorScreenPoint())
    w.hide()
    hideChatAndTab()
    await sleep(CAPTURE_SETTLE_MS)
    const tCapture = Date.now()
    let shot: ScreenShot
    try {
      shot = await capturePrimaryShot()
    } catch {
      restoreChatAfterCapture()
      releaseToPreviousApp(w)
      busy = false
      pushChatSnapshot()
      await advanceStep()
      return
    }
    captures = 1
    restoreChatAfterCapture()
    showInactive(w)
    const captureMs = Date.now() - tCapture

    // Remember the verified step; the live index moves on immediately.
    const fromIndex = session.currentStepIndex
    const planCopy = session.plan.map((s) => ({
      ...s,
      keys: s.keys ? [...s.keys] : undefined,
      choose: s.choose ? [...s.choose] : undefined
    }))
    const goalCopy = session.goal
    const briefCopy = session.brief ? [...session.brief] : null
    if (!advance()) {
      busy = false
      pushChatSnapshot()
      return
    }
    const newStep = currentStep()
    if (!newStep) {
      busy = false
      pushChatSnapshot()
      return
    }
    greeting = null
    pushChatSnapshot()
    w.webContents.send('overlay:looking', lastMarkerAnchor(w))

    // Isolated verify: its response, or null when the call itself fails.
    let verifyMs = 0
    const verifyP = (async () => {
      const t0 = Date.now()
      try {
        const res = await verifyStep(goalCopy, briefCopy, planCopy, fromIndex, shot)
        verifyMs = Date.now() - t0
        return res
      } catch {
        verifyMs = Date.now() - t0
        debug('[verify] result=error')
        return null
      }
    })()
    // Isolated locate: skipped for targetless steps, null when the call fails.
    let locateMs = 0
    const locateP = (async (): Promise<StepLocateResult | 'skipped' | null> => {
      if (!newStep.target) return 'skipped'
      const t0 = Date.now()
      try {
        const loc = await locateStepTarget(newStep.target, newStep.dropTarget, stepContext(), shot)
        locateMs = Date.now() - t0
        return loc
      } catch {
        locateMs = Date.now() - t0
        return null
      }
    })()
    const [ver, loc] = await Promise.all([verifyP, locateP])
    w.webContents.send('overlay:looking-done')
    const logNext = (): void => {
      debug(
        `[next] capture_ms=${captureMs} verify_ms=${verifyMs} ` +
          `locate_ms=${locateMs} captures=${captures}`
      )
    }

    // Verify decides first: not done reverts, whatever locate did.
    if (ver) {
      debug(`[verify] done=${ver.done} replan=${ver.updated_remaining_steps !== null}`)
      if (!ver.done) {
        goToStep(fromIndex)
        pushChatSnapshot()
        showNotDoneBubble(w, lastMarkerAnchor(w), ver.explanation)
        logNext()
        return
      }
    }

    // Apply any replan against fromIndex, then resolve which step to show.
    let showStep = newStep
    let located: StepLocateResult | 'skipped' | null = loc
    if (ver && ver.done && ver.updated_remaining_steps) {
      replaceRemainingStepsAt(fromIndex, ver.updated_remaining_steps)
      const cur = currentStep()
      if (!cur) {
        // Replan ended the plan here: stay on the last step, no marker.
        goToStep(session.plan.length - 1)
        pushChatSnapshot()
        logNext()
        return
      }
      pushChatSnapshot()
      showStep = cur
      if (cur.target !== newStep.target || cur.dropTarget !== newStep.dropTarget) {
        // Target changed: locate the new step on the SAME screenshot.
        const t0 = Date.now()
        try {
          located = cur.target
            ? await locateStepTarget(cur.target, cur.dropTarget, stepContext(), shot)
            : 'skipped'
        } catch {
          located = null
        }
        locateMs += Date.now() - t0
      }
    }
    if (pointingPaused) {
      // Paused: index advanced and snapshot pushed, but point at nothing.
      if (!w.isDestroyed()) w.webContents.send('overlay:happy')
      logNext()
      return
    }

    // Label from the live (possibly replanned) plan, never the pre-verify one.
    const label = stepLabelFor(showStep, session.currentStepIndex, session.plan.length)
    const req: PointRequest = {
      target: showStep.target ?? '',
      context: stepContext(),
      label,
      dropTarget: showStep.dropTarget,
      anchor
    }
    if (!showStep.target) {
      if (!w.isDestroyed()) w.webContents.send('overlay:happy')
      showUnlocatedStep(w, anchor, label)
      expandChatIfOutside(anchor)
      restoreAutoHiddenHudUnlessInside(anchor)
      logNext()
      return
    }
    if (located === null || located === 'skipped') {
      // Locate call failed: existing message, no recovery for network errors.
      // ('skipped' is unreachable here — a targetless showStep took the branch
      // above — but a message beats a crash if that ever changes.)
      w.webContents.send('overlay:message', { ...anchor, text: 'Lookup failed — try again' })
      restoreAutoHiddenHud()
      logNext()
      return
    }
    const result = located.source
    const dest = located.dest
    if (dest) {
      debug(
        `[point] mode=drag found=${result.found && dest.found} ` +
          `src=${result.confidence} drop=${dest.confidence}`
      )
    } else {
      debug(`[point] mode=step found=${result.found} conf=${result.confidence}`)
    }
    if (!result.found || (dest && !dest.found)) {
      const missing =
        dest && !result.found && !dest.found
          ? `${req.target} and ${showStep.dropTarget}`
          : !result.found
            ? req.target
            : (showStep.dropTarget ?? req.target)
      captures += 1
      const recPt = await attemptRecovery(req, w, dest ? missing : undefined)
      if (recPt) {
        expandChatIfOutside(recPt)
        restoreAutoHiddenHudUnlessInside(recPt)
      } else {
        restoreAutoHiddenHud()
      }
      logNext()
      return
    }
    if (!w.isDestroyed()) w.webContents.send('overlay:happy')
    const bounds = primaryDisplay().bounds
    const content = w.getContentBounds()
    const srcPt = normalizedToWindow(result.x, result.y, bounds, content)
    if (dest) {
      showMarker(w, req, result.x, result.y, dest.x, dest.y)
      lastMarker = { req, x: result.x, y: result.y, dx: dest.x, dy: dest.y }
      const dropPt = normalizedToWindow(dest.x, dest.y, bounds, content)
      expandChatIfOutside(srcPt, dropPt)
      restoreAutoHiddenHudUnlessInside(srcPt, dropPt)
    } else {
      showMarker(w, req, result.x, result.y)
      lastMarker = { req, x: result.x, y: result.y }
      expandChatIfOutside(srcPt)
      restoreAutoHiddenHudUnlessInside(srcPt)
    }
    logNext()
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

/** Advance to the next step with no verification ("It's done", toggle off). */
async function advanceStep(): Promise<void> {
  if (!hasPlan() || busy) return
  if (!advance()) return
  if (chatAutoCollapsed) setPanelState(false, 'auto')
  restoreAutoHiddenHud()
  const w = win
  if (w && !w.isDestroyed()) w.webContents.send('overlay:happy')
  pushChatSnapshot()
  await showCurrentStep()
}

/**
 * Verify the current step from a fresh screenshot before advancing.
 * Anything that prevents verification (blocked capture, missing key,
 * failed call) advances anyway, silently.
 */
async function verifyCurrentStep(): Promise<void> {
  const w = win
  if (!w || w.isDestroyed() || busy) return
  busy = true
  pushChatSnapshot()
  let shouldAdvance = false
  try {
    shouldAdvance = await tryVerifyStep(w)
  } finally {
    busy = false
    pushChatSnapshot()
  }
  if (shouldAdvance) await advanceStep()
}

async function tryVerifyStep(w: BrowserWindow): Promise<boolean> {
  if (screenAccessBlocked() || isMissingApiKey() || !hasPlan()) return true
  w.hide()
  hideChatAndTab()
  await sleep(CAPTURE_SETTLE_MS)
  let shot
  try {
    shot = await capturePrimaryShot()
  } catch {
    restoreChatAfterCapture()
    releaseToPreviousApp(w)
    return true
  }
  restoreChatAfterCapture()
  showInactive(w)
  const anchor = lastMarkerAnchor(w)
  w.webContents.send('overlay:looking', anchor)
  let res
  try {
    res = await verifyStep(session.goal, session.brief, session.plan, session.currentStepIndex, shot)
  } catch {
    debug('[verify] result=error')
    w.webContents.send('overlay:looking-done')
    return true
  }
  w.webContents.send('overlay:looking-done')
  debug(`[verify] done=${res.done} replan=${res.updated_remaining_steps !== null}`)
  if (!res.done) {
    showNotDoneBubble(w, anchor, res.explanation)
    return false
  }
  if (res.updated_remaining_steps) {
    replaceRemainingSteps(res.updated_remaining_steps)
    pushChatSnapshot()
  }
  return true
}

/** Anchor verification UI at the last marker, else at the cursor. */
function lastMarkerAnchor(w: BrowserWindow): { x: number; y: number } {
  const prev = lastMarker
  if (prev) {
    return normalizedToWindow(
      prev.x,
      prev.y,
      primaryDisplay().bounds,
      w.getContentBounds()
    )
  }
  return toWindowPoint(w, screen.getCursorScreenPoint())
}

function showNotDoneBubble(
  w: BrowserWindow,
  anchor: { x: number; y: number },
  explanation: string
): void {
  const content = w.getContentBounds()
  const pt: MarkerPoint = {
    ...anchor,
    cursor: globalToWindow(screen.getCursorScreenPoint(), content),
    workArea: windowWorkArea(w),
    notDone: { explanation }
  }
  collapseChatForPoint(pt)
  w.webContents.send('overlay:marker', pt)
}

async function handleBack(): Promise<void> {
  if (!hasPlan() || busy) return
  if (!goBack()) return
  pushChatSnapshot()
  await showCurrentStep()
}

function pushChatSnapshot(): void {
  const chat = chatWin
  const hud = hudWin
  const chatLive = chat && !chat.isDestroyed()
  const hudLive = hud && !hud.isDestroyed()
  if (!chatLive && !hudLive) return
  const workspace = getCurrentWorkspace()
  // Saving is async; a failure surfaces as a notice on the next snapshot.
  // The notice guard keeps the re-push from looping when it keeps failing.
  saveCurrentChat()
  const snap: ChatSnapshot = {
    messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
    chats: [...chatEntries].sort((a, b) => b.updatedAt - a.updatedAt),
    currentChatId,
    workspaces: [...workspaceEntries]
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .map((e) => ({
        id: workspaceKey(e.ref),
        name: workspaceName(e.ref),
        kind: e.ref.kind,
        current: workspace !== null && workspaceKey(workspace) === workspaceKey(e.ref),
        available: e.ref.kind === 'named' || isGodotProject(e.ref.path)
      })),
    hasPlan: hasPlan(),
    plan: session.plan.map((s) => ({
      instruction: s.instruction,
      target: s.target,
      caution: s.caution,
      action: s.action,
      text: s.text,
      keys: s.keys ? [...s.keys] : undefined,
      choose: s.choose ? [...s.choose] : undefined
    })),
    currentStepIndex: session.currentStepIndex,
    busy,
    notice: chatNotice,
    collapsed: chatCollapsed,
    workspaceName: workspace ? workspaceName(workspace) : null,
    canSaveCode: workspace?.kind === 'godot',
    app: session.app,
    greeting,
    verifySteps: session.verifySteps,
    needsApp: pendingApp,
    discovery:
      session.questions && session.questions.length > 0
        ? {
            phase: 'clarify',
            questions: session.questions.map((q) => ({ text: q.text, options: [...q.options] })),
            brief: []
          }
        // The confirm card hides while waiting for the app: the brief is
        // already confirmed and pendingBrief must survive until the plan
        // arrives after "I'm ready", so gate display on pendingApp, not state.
        : session.pendingBrief && session.pendingBrief.length > 0 && !pendingApp
          ? { phase: 'confirm', questions: [], brief: [...session.pendingBrief] }
          : null,
    researching: researchingApp,
    research: session.research
      ? {
          app: session.research.app,
          summary: session.research.summary,
          urls: [...session.research.urls]
        }
      : null,
    goal: session.goal,
    paused: pointingPaused,
    hudOpen
  }
  if (chatLive && chat) chat.webContents.send('chat:snapshot', snap)
  if (hudLive && hud) hud.webContents.send('chat:snapshot', snap)
}

/**
 * Capture the primary display for chat with our own windows hidden.
 * Returns null on failure (chatNotice is set); the caller must stop.
 */
async function captureChatShot(): Promise<ScreenShot | null> {
  const overlay = win
  if (overlay && !overlay.isDestroyed()) overlay.hide()
  hideChatAndTab()
  await sleep(CAPTURE_SETTLE_MS)
  try {
    // Smaller than the pointer's shot (1280px longest side, JPEG q85):
    // the advisor needs context, not pixel precision.
    return await capturePrimaryShot(1280)
  } catch {
    chatNotice = 'Screen capture failed — try again'
    return null
  } finally {
    if (overlay && !overlay.isDestroyed()) showInactive(overlay)
    restoreChatAfterCapture()
  }
}

/** Latest user message text, for research topics. */
function lastUserText(): string | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i]?.role === 'user') return session.messages[i].text
  }
  return null
}

/**
 * One web-research call for an unfamiliar app. Stores the summary + source
 * URLs in the session (persisted per workspace) and shows the robot in
 * thinking mood on the overlay. Never sends screenshots.
 */
async function runResearch(appName: string, topic: string): Promise<boolean> {
  debug(`[research] app=${appName}`)
  researchingApp = appName
  pushChatSnapshot()
  const w = win
  if (w && !w.isDestroyed()) {
    w.webContents.send('overlay:looking', toWindowPoint(w, screen.getCursorScreenPoint()))
  }
  try {
    const result = await researchApp(appName, topic)
    session.research = {
      app: appName,
      summary: result.summary,
      urls: result.urls,
      updatedAt: Date.now()
    }
    debug(`[research] urls=${result.urls.length}`)
    return true
  } catch {
    debug('[research] result=error')
    chatNotice = 'Research failed — try again'
    return false
  } finally {
    researchingApp = null
    if (w && !w.isDestroyed()) w.webContents.send('overlay:looking-done')
    pushChatSnapshot()
  }
}

/**
 * One advisor turn: send the user text (plus an optional screenshot),
 * record both sides, apply plan/app/needs_app, and chain at most one
 * research + re-plan when the advisor asks for it. Caller holds `busy`.
 * With appendPlan, a returned plan extends the current one (Continue flow)
 * instead of replacing it.
 */
async function advisorTurn(
  userText: string,
  shot: ScreenShot | undefined,
  allowResearch: boolean,
  appendPlan = false
): Promise<void> {
  const history = [...session.messages]
  const state = planContext()
  // SH-01 thinks on the overlay next to the cursor while the advisor works.
  const w = win
  if (w && !w.isDestroyed()) {
    w.webContents.send('overlay:looking', toWindowPoint(w, screen.getCursorScreenPoint()))
  }
  let res
  const t0 = Date.now()
  try {
    res = await advisorChat(history, userText, shot, state)
    debug(`[advisor] ms=${Date.now() - t0}`)
  } catch {
    debug(`[advisor] ms=${Date.now() - t0} result=error`)
    chatNotice = "Couldn't reach the advisor — try again"
    return
  } finally {
    if (w && !w.isDestroyed()) w.webContents.send('overlay:looking-done')
  }
  session.messages.push({ role: 'user', text: userText })
  session.messages.push({
    role: 'assistant',
    text: res.code ? res.reply + formatCodeBlock(res.code) : res.reply
  })
  const researchTarget = res.app ?? session.app ?? pendingApp
  const willResearch = res.needs_research && allowResearch && !res.needs_app && researchTarget
  // When a researched re-plan follows, it carries the plan; applying this
  // one first would duplicate steps in the append (Continue) flow.
  if (res.plan && !willResearch) {
    if (appendPlan && hasPlan()) {
      if (res.goal) session.goal = res.goal
      session.plan = [...session.plan, ...res.plan]
    } else {
      setPlan(res.goal ?? session.goal ?? '', res.plan)
    }
  }
  // Discovery dialogue state machine.
  if (res.phase === 'clarify' && res.questions) {
    session.questions = res.questions.map((q) => ({ text: q.text, options: [...q.options] }))
    session.pendingBrief = null
    session.clarifyRounds += 1
  } else if (res.phase === 'confirm' && res.brief) {
    session.questions = null
    session.pendingBrief = [...res.brief]
  } else {
    session.questions = null
    if (res.plan && !willResearch) {
      if (session.pendingBrief) session.brief = session.pendingBrief
      else if (res.brief) session.brief = [...res.brief]
      else session.brief = null
      session.pendingBrief = null
      session.clarifyRounds = 0
    } else if (res.phase === 'answer') {
      // answer + needs_app (e.g. the user confirmed but the app is not open):
      // keep the brief so it survives until the plan arrives after "I'm ready".
      if (!res.needs_app) {
        session.pendingBrief = null
        session.clarifyRounds = 0
      }
    }
    // plan + willResearch: the chained researched turn resolves the brief.
  }
  if (res.app) session.app = res.app
  // No "open the app" requests during discovery; ask only when the plan is due.
  pendingApp =
    res.plan || res.phase === 'clarify' || res.phase === 'confirm'
      ? null
      : (res.needs_app ?? null)
  pushChatSnapshot()
  if (willResearch) {
    const ok = await runResearch(willResearch, userText)
    if (ok) {
      await advisorTurn(
        `Please continue using the research on ${willResearch}.`,
        shot,
        false,
        appendPlan
      )
    }
  }
}

async function handleChatSend(rawText: unknown, rawShot: unknown): Promise<void> {
  const chat = chatWin
  if (!chat || chat.isDestroyed() || busy) return
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text) return
  if (text.length > MAX_CHAT_LEN) {
    chatNotice = `Message is too long (${text.length} / ${MAX_CHAT_LEN} characters) — shorten it to send.`
    pushChatSnapshot()
    return
  }
  const withScreenshot = rawShot === true
  busy = true
  chatNotice = null
  greeting = null
  pushChatSnapshot()
  try {
    if (withScreenshot && screenAccessBlocked()) {
      chatNotice = 'Allow Screen Recording in System Settings → Privacy & Security, then restart'
      return
    }
    if (isMissingApiKey()) {
      chatNotice = MISSING_KEY_MESSAGE
      return
    }

    let shot: ScreenShot | undefined
    if (withScreenshot) {
      const captured = await captureChatShot()
      if (!captured) return
      shot = captured
    }
    await advisorTurn(text, shot, true)
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

/**
 * "I'm ready": the user opened the app the advisor asked for. Retake a
 * fresh screenshot and continue the conversation from there.
 */
async function handleAppReady(): Promise<void> {
  const chat = chatWin
  if (!chat || chat.isDestroyed() || busy || !pendingApp) return
  const appName = pendingApp
  busy = true
  chatNotice = null
  greeting = null
  pushChatSnapshot()
  try {
    if (screenAccessBlocked()) {
      chatNotice = 'Allow Screen Recording in System Settings → Privacy & Security, then restart'
      return
    }
    if (isMissingApiKey()) {
      chatNotice = MISSING_KEY_MESSAGE
      return
    }
    const shot = await captureChatShot()
    if (!shot) return
    await advisorTurn(`I've opened ${appName}. Please continue.`, shot, true)
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

/**
 * "Continue": the user finished the last step of a short plan. Ask the
 * advisor for the next steps from a fresh screenshot, append them, and move
 * onto the first new step.
 */
async function handleContinue(): Promise<void> {
  const chat = chatWin
  if (!chat || chat.isDestroyed() || busy || !hasPlan()) return
  if (session.currentStepIndex < session.plan.length - 1) return
  const before = session.plan.length
  busy = true
  chatNotice = null
  greeting = null
  pushChatSnapshot()
  try {
    if (screenAccessBlocked()) {
      chatNotice = 'Allow Screen Recording in System Settings → Privacy & Security, then restart'
      return
    }
    if (isMissingApiKey()) {
      chatNotice = MISSING_KEY_MESSAGE
      return
    }
    const shot = await captureChatShot()
    if (!shot) return
    await advisorTurn(
      "I've finished all the steps so far. Please continue with the next steps toward my goal. Return ONLY the new steps, not the ones already done.",
      shot,
      true,
      true
    )
  } finally {
    busy = false
    pushChatSnapshot()
  }
  if (session.plan.length > before) await advanceStep()
}

ipcMain.on('input:submit', (_event, target: unknown) => {
  void handleSubmit(typeof target === 'string' ? target : '')
})

ipcMain.on('look:ask', (_event, text: unknown) => {
  void handleLookAsk(typeof text === 'string' ? text : '')
})

ipcMain.on('input:cancel', () => {
  const w = win
  if (!w || w.isDestroyed()) return
  w.webContents.send('overlay:hide-input')
  inputOpen = false
  setOverlayClickable(false)
  if (process.platform === 'darwin') app.hide()
  else w.blur()
})

ipcMain.on('islands:update', (_event, raw: unknown) => {
  const w = win
  // Islands never coexist with the query box; a stale report must not fight it.
  if (inputOpen) {
    stopIslandPoll()
    return
  }
  if (!w || w.isDestroyed() || !Array.isArray(raw)) {
    stopIslandPoll()
    return
  }
  const c = w.getContentBounds()
  islandRects = (raw as unknown[]).flatMap((r) => {
    const v = r as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    if (
      typeof v.x !== 'number' ||
      typeof v.y !== 'number' ||
      typeof v.width !== 'number' ||
      typeof v.height !== 'number' ||
      !(v.width > 0) ||
      !(v.height > 0)
    ) {
      return []
    }
    return [{ x: c.x + v.x, y: c.y + v.y, width: v.width, height: v.height }]
  })
  if (islandRects.length === 0) {
    stopIslandPoll()
    return
  }
  pollIslands()
  if (islandTimer === null) islandTimer = setInterval(pollIslands, ISLAND_POLL_MS)
})

ipcMain.on('bubble:next', () => {
  debug('[bubble] click=next')
  void handleNext()
})

ipcMain.on('bubble:retry', () => {
  debug('[bubble] click=retry')
  void showCurrentStep()
})

ipcMain.on('bubble:done', () => {
  debug('[bubble] click=done')
  if (chatAutoCollapsed) setPanelState(false, 'auto')
  restoreAutoHiddenHud()
})

ipcMain.on('bubble:close', () => {
  debug('[bubble] click=close')
  if (chatAutoCollapsed) setPanelState(false, 'auto')
  restoreAutoHiddenHud()
})

ipcMain.on('hud:toggle', () => {
  toggleHud()
})

ipcMain.on('hud:pause', () => {
  togglePause()
})

ipcMain.on('hud:open-chat', () => {
  if (process.platform === 'darwin') app.show()
  setPanelState(false, 'button')
  ensureChatWindow().focus()
})

ipcMain.on('hud:height', (_event, raw: unknown) => {
  const w = hudWin
  if (!w || w.isDestroyed() || typeof raw !== 'number' || !Number.isFinite(raw)) return
  const h = Math.min(HUD_MAX_H, Math.max(HUD_MIN_H, Math.round(raw)))
  const b = w.getBounds()
  if (Math.abs(b.height - h) >= 2) w.setSize(b.width, h)
})

ipcMain.on('bubble:force-next', () => {
  debug('[bubble] click=force-next')
  void advanceStep()
})

ipcMain.on('bubble:wrong-spot', () => {
  debug('[bubble] click=wrong-spot')
  void handleWrongSpot()
})

ipcMain.on('bubble:show-option', () => {
  debug('[bubble] click=show-option')
  void handleShowOption()
})

ipcMain.on('chat:toggle-collapsed', (_event, source: unknown) => {
  setPanelState(!chatCollapsed, source === 'tab' ? 'tab' : 'button')
})

ipcMain.on('settings:open', () => {
  void shell.openExternal(SETTINGS_URL).catch(() => undefined)
})

ipcMain.on('chat:ready', () => {
  pushChatSnapshot()
})

ipcMain.on('chat:send', (_event, payload: unknown) => {
  const p = payload as { text?: unknown; withScreenshot?: unknown } | null
  void handleChatSend(p?.text, p?.withScreenshot)
})

ipcMain.on('chat:app-ready', () => {
  void handleAppReady()
})

ipcMain.on('link:open', (_event, rawUrl: unknown) => {
  if (typeof rawUrl !== 'string') return
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
  void shell.openExternal(parsed.toString()).catch(() => undefined)
})

ipcMain.on('chat:show-me', () => {
  void showCurrentStep()
})

ipcMain.on('chat:next', () => {
  void handleNext()
})

ipcMain.on('chat:back', () => {
  void handleBack()
})

ipcMain.on('chat:continue', () => {
  void handleContinue()
})

ipcMain.on('chat:toggle-verify', () => {
  session.verifySteps = !session.verifySteps
  pushChatSnapshot()
})

/** Max bytes for a Save-to-project write. */
const MAX_SAVE_BYTES = 50 * 1024

/**
 * Clean a model-provided filename into a safe bare name: basename only,
 * letters/digits/_/- in the stem, .gd or .gdshader extension. Always
 * returns a writable name, so saving never fails on the name itself.
 */
function sanitizeCodeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9_-]/g, '_') || 'script'
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  return `${stem}.${ext === 'gd' || ext === 'gdshader' ? ext : 'gd'}`
}

/**
 * Render advisor code as a fenced block appended to the assistant message.
 * The fence is one backtick longer than the longest backtick run inside,
 * so content can never break out of the block.
 */
function formatCodeBlock(code: CodeBlock): string {
  const runs = code.content.match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)))
  const lang = code.language.replace(/[^A-Za-z0-9+-]/g, '') || 'txt'
  const purpose = code.purpose.replace(/\s+/g, ' ').trim()
  return `\n\n${fence}sh01-code:${lang}:${sanitizeCodeFilename(code.filename)}\n# purpose: ${purpose}\n${code.content}\n${fence}`
}

ipcMain.on('copy:text', (_event, payload: unknown) => {
  if (typeof payload !== 'string' || payload.length === 0) return
  void clipboard.writeText(payload).catch(() => undefined)
})

ipcMain.on('chat:save-code', (_event, payload: unknown) => {
  const p = payload as { filename?: unknown; content?: unknown } | null
  const workspace = getCurrentWorkspace()
  if (!workspace || workspace.kind !== 'godot') {
    chatNotice = 'Open a Godot project workspace to save code'
    pushChatSnapshot()
    return
  }
  const content = typeof p?.content === 'string' ? p.content : ''
  if (content.length === 0 || Buffer.byteLength(content, 'utf8') > MAX_SAVE_BYTES) {
    chatNotice = 'Code is empty or larger than 50 KB — not saved'
    pushChatSnapshot()
    return
  }
  const dir = join(workspace.path, 'ai_assets')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    chatNotice = 'Could not create ai_assets — not saved'
    pushChatSnapshot()
    return
  }
  const filename = sanitizeCodeFilename(typeof p?.filename === 'string' ? p.filename : '')
  const dot = filename.lastIndexOf('.')
  const stem = filename.slice(0, dot)
  const ext = filename.slice(dot)
  let unique = filename
  for (let n = 2; existsSync(join(dir, unique)); n++) unique = `${stem}_${n}${ext}`
  const resolved = join(dir, unique)
  // Paranoia: sanitizeCodeFilename makes escape impossible, verify anyway.
  if (!resolved.startsWith(dir + sep)) {
    chatNotice = 'Refusing to write outside ai_assets'
    pushChatSnapshot()
    return
  }
  try {
    writeFileSync(resolved, content)
  } catch {
    chatNotice = 'Could not write the file — not saved'
    pushChatSnapshot()
    return
  }
  chatNotice = `Saved as res://ai_assets/${unique}`
  pushChatSnapshot()
})

ipcMain.on('chat:select-project', () => {
  void (async () => {
    const chat = chatWin
    const res = chat
      ? await dialog.showOpenDialog(chat, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return
    const dir = res.filePaths[0]
    if (!isGodotProject(dir)) {
      chatNotice = 'That folder is not a Godot project (no project.godot inside)'
      pushChatSnapshot()
      return
    }
    chatNotice = null
    await openWorkspace({ kind: 'godot', path: dir })
  })()
})

ipcMain.on('chat:create-workspace', (_event, name: unknown) => {
  void (async () => {
    const trimmed = typeof name === 'string' ? name.trim().slice(0, 80) : ''
    if (!trimmed) return
    chatNotice = null
    await openWorkspace({ kind: 'named', name: trimmed })
  })()
})

ipcMain.on('chat:clear-history', () => {
  const workspace = getCurrentWorkspace()
  if (!workspace) return
  // Queued behind any in-flight save, so the clear always wins.
  void clearHistory(workspace)
  resetSession()
  currentChatId = null
  chatEntries = []
  greeting = null
  pendingApp = null
  researchingApp = null
  chatNotice = 'History cleared for this workspace'
  pushChatSnapshot()
})

ipcMain.on('chat:delete-all-history', () => {
  resetSession()
  currentChatId = null
  chatEntries = []
  // The registry file lives under history/, so deleteAllHistory wipes it
  // from disk; drop the memory copy here.
  workspaceEntries = []
  greeting = null
  pendingApp = null
  researchingApp = null
  chatNotice = 'All history deleted'
  // Drains queues first, so no in-flight save recreates files after us.
  void deleteAllHistory()
  pushChatSnapshot()
})

ipcMain.on('chat:start-new', () => {
  if (busy) return
  startNewChat()
})

ipcMain.on('chat:new-chat', () => {
  if (busy) return
  startNewChat()
})

ipcMain.on('chat:switch-chat', (_event, payload: unknown) => {
  if (busy) return
  if (typeof payload !== 'string') return
  const workspace = getCurrentWorkspace()
  const entry = chatEntries.find((e) => e.id === payload)
  if (!workspace || !entry || entry.id === currentChatId) return
  saveCurrentChat()
  const seq = ++switchSeq
  void (async () => {
    const data = await loadChat(workspace, entry.id)
    // A newer switch started while we were reading: let it win.
    if (seq !== switchSeq) return
    if (!data) {
      chatNotice = 'Could not open that chat'
      pushChatSnapshot()
      return
    }
    currentChatId = entry.id
    restoreSession(data)
    greeting = null
    pendingApp = null
    researchingApp = null
    chatNotice = null
    pushChatSnapshot()
  })()
})

ipcMain.on('chat:rename-chat', (_event, payload: unknown) => {
  const workspace = getCurrentWorkspace()
  const p = payload as { id?: unknown; title?: unknown } | null
  const entry =
    typeof p?.id === 'string' ? chatEntries.find((e) => e.id === p.id) : undefined
  const title = typeof p?.title === 'string' ? p.title.trim().slice(0, 80) : ''
  if (!workspace || !entry || title.length === 0) return
  entry.title = title
  entry.customTitle = true
  const entries = chatEntries.map((e) => ({ ...e }))
  void persistChatIndex(workspace, entries).then((ok) => {
    if (!ok) historyUnavailableNotice()
  })
  pushChatSnapshot()
})

ipcMain.on('chat:delete-chat', (_event, payload: unknown) => {
  if (busy) return
  if (typeof payload !== 'string') return
  const workspace = getCurrentWorkspace()
  if (!workspace || !chatEntries.some((e) => e.id === payload)) return
  chatEntries = chatEntries.filter((e) => e.id !== payload)
  void deleteChat(
    workspace,
    payload,
    chatEntries.map((e) => ({ ...e }))
  )
  if (payload === currentChatId) {
    resetSession()
    currentChatId = null
    greeting = null
    pendingApp = null
    researchingApp = null
  }
  pushChatSnapshot()
})

ipcMain.on('chat:switch-workspace', (_event, payload: unknown) => {
  if (busy) return
  if (typeof payload !== 'string') return
  const entry = workspaceEntries.find((e) => workspaceKey(e.ref) === payload)
  const current = getCurrentWorkspace()
  if (!entry || (current && workspaceKey(current) === payload)) return
  const ref = entry.ref
  if (ref.kind === 'godot' && !isGodotProject(ref.path)) {
    chatNotice = 'That workspace is unavailable — its folder is missing or has no project.godot'
    pushChatSnapshot()
    return
  }
  // Drop the old workspace's marker and bubble, like closing it by hand.
  // openWorkspace clears the pending-app and research state like a chat switch.
  lastMarker = null
  const w = win
  if (w && !w.isDestroyed()) w.webContents.send('overlay:dismiss')
  if (chatAutoCollapsed) setPanelState(false, 'auto')
  restoreAutoHiddenHud()
  chatNotice = null
  void openWorkspace(ref)
})

ipcMain.on('chat:delete-workspace', (_event, payload: unknown) => {
  if (busy) return
  if (typeof payload !== 'string') return
  const entry = workspaceEntries.find((e) => workspaceKey(e.ref) === payload)
  if (!entry) return
  const ref = entry.ref
  const current = getCurrentWorkspace()
  const wasCurrent = current !== null && workspaceKey(current) === payload
  workspaceEntries = workspaceEntries.filter((e) => e !== entry)
  persistRegistryCopy()
  // Only the history store goes; Godot project files are never touched.
  void clearHistory(ref)
  const last = loadLastWorkspace()
  if (last && workspaceKey(last) === payload) clearLastWorkspace()
  if (!wasCurrent) {
    chatNotice = 'Workspace deleted'
    pushChatSnapshot()
    return
  }
  const fallback = [...workspaceEntries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]
  if (fallback) {
    chatNotice = 'Workspace deleted'
    void openWorkspace(fallback.ref)
    return
  }
  setCurrentWorkspace(null)
  resetSession()
  currentChatId = null
  chatEntries = []
  greeting = null
  pendingApp = null
  researchingApp = null
  chatNotice = 'Workspace deleted'
  pushChatSnapshot()
})

// One instance only: a second launch would create a duplicate overlay +
// chat pair at identical geometry, looking like one panel that won't collapse.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) return
    if (process.platform === 'darwin') app.show()
    applyPanelState()
    const target = chatCollapsed ? ensureTabWindow() : ensureChatWindow()
    if (!target.isDestroyed()) target.focus()
  })
  void app.whenReady().then(async () => {
    debug(`[model] ${MODEL}`)
    if (process.platform === 'darwin' && app.dock) app.dock.hide()
    ensureOverlay()
    workspaceEntries = await loadWorkspaceRegistry()
    const last = loadLastWorkspace()
    if (last && (last.kind === 'named' || isGodotProject(last.path))) await openWorkspace(last)
    /** Handlers aligned with GLOBAL_SHORTCUTS order: point, chat, look, HUD. */
    const shortcutHandlers = [onHotkey, toggleChat, onLookHotkey, toggleHud]
    GLOBAL_SHORTCUTS.forEach((s, i) => {
      const handler = shortcutHandlers[i]
      if (!handler) {
        console.error(`No handler for global shortcut ${s.accelerator}`)
        return
      }
      if (!globalShortcut.register(s.accelerator, handler)) {
        console.error(`Failed to register global shortcut ${s.accelerator}`)
      }
    })
  })
}

app.on('will-quit', () => globalShortcut.unregisterAll())
