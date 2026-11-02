import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type Display
} from 'electron'
import { join } from 'node:path'
import type { ChatSnapshot, MarkerPoint, Rect, StepLabel } from '../shared/api'
import {
  askAboutCrop,
  chat as advisorChat,
  recover as advisorRecover,
  researchApp
} from './advisor'
import {
  captureCursorCrop,
  capturePrimaryShot,
  isMissingApiKey,
  locate,
  type CursorCrop,
  type ScreenShot
} from './locate'
import {
  advance,
  currentStep,
  goBack,
  hasPlan,
  resetSession,
  restoreSession,
  session,
  setPlan,
  stepContext
} from './session'
import {
  clearHistory,
  deleteAllHistory,
  getCurrentWorkspace,
  isGodotProject,
  loadChatBounds,
  loadHistory,
  loadLastWorkspace,
  saveChatBounds,
  saveHistory,
  saveLastWorkspace,
  setCurrentWorkspace,
  workspaceName,
  type WorkspaceRef
} from './history'

const HOTKEY = 'CommandOrControl+Shift+Space'
const CHAT_HOTKEY = 'CommandOrControl+Alt+A'
const LOOK_HOTKEY = 'CommandOrControl+Alt+L'
const CAPTURE_SETTLE_MS = 150
const MAX_QUERY_LEN = 500
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
 * panel state. Never activates.
 */
function restoreChatAfterCapture(): void {
  if (chatCollapsed) {
    const tab = tabWin
    if (tab && !tab.isDestroyed() && !tab.isVisible()) tab.showInactive()
  } else {
    const chat = chatWin
    if (chat && !chat.isDestroyed() && !chat.isVisible()) chat.showInactive()
  }
}

/** Hide chat and tab for captures. Restore with restoreChatAfterCapture(). */
function hideChatAndTab(): void {
  const chat = chatWin
  if (chat && !chat.isDestroyed()) chat.hide()
  const tab = tabWin
  if (tab && !tab.isDestroyed()) tab.hide()
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
  if (!chat || chat.isDestroyed() || !chat.isVisible() || chatCollapsed) return
  if (!overlay || overlay.isDestroyed()) return
  const oc = overlay.getContentBounds()
  const sx = oc.x + pt.x
  const sy = oc.y + pt.y
  const b = chat.getBounds()
  if (sx >= b.x && sx < b.x + b.width && sy >= b.y && sy < b.y + b.height) {
    setPanelState(true, 'auto', true)
  }
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
      text: 'MODEL_API_KEY is missing — add it to ~/.secrets/game-agent.env, then restart'
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
  if (!session.goal && !hasPlan() && !session.research) return undefined
  const lines = ['Ongoing session state (use for continuity, do not repeat verbatim):']
  if (session.goal) lines.push(`Goal: ${session.goal}`)
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
      lines.push(`${i + 1}. ${s.instruction} (target: ${s.target}) [${mark}]`)
    })
  }
  return lines.join('\n')
}

/** Switch to a workspace, restoring its history or starting fresh. */
async function openWorkspace(ref: WorkspaceRef): Promise<void> {
  const keepSession =
    getCurrentWorkspace() === null &&
    (session.messages.length > 0 || session.goal !== null || session.plan.length > 0)
  setCurrentWorkspace(ref)
  saveLastWorkspace(ref)
  const data = await loadHistory(ref)
  if (data) {
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

/** Clickable islands in screen coords, reported by the overlay renderer. */
let islandRects: Rect[] = []
let islandTimer: NodeJS.Timeout | null = null
let overlayClickable = false
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
  setOverlayClickable(
    islandRects.some(
      (r) => c.x >= r.x && c.x < r.x + r.width && c.y >= r.y && c.y < r.y + r.height
    )
  )
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
  anchor: { x: number; y: number }
}

/** Latest shown marker: the request plus its normalized (0-1000) point. Powers Wrong-spot retries. */
let lastMarker: { req: PointRequest; x: number; y: number } | null = null

/** Same-spot radius on the 0-1000 scale: a retry landing inside it is "unsure". */
const RETRY_SAME_SPOT_UNITS = 20

/** Hide the overlay, capture, locate the target, and show the marker. Shared by
 * free queries ("what/where") and guided plan steps ("show me"). */
async function pointAt(req: PointRequest): Promise<void> {
  const w = win
  if (!w || w.isDestroyed() || busy) return
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
        text: 'MODEL_API_KEY is missing — add it to ~/.secrets/game-agent.env, then restart'
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

    let result
    try {
      result = await locate(req.target, req.context, shot)
    } catch {
      w.webContents.send('overlay:message', { ...req.anchor, text: 'Lookup failed — try again' })
      return
    }
    debug(`[point] mode=${req.label ? 'step' : 'query'} found=${result.found}`)
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
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

/** Convert a normalized point to window coords and show the marker + bubble. */
function showMarker(w: BrowserWindow, req: PointRequest, x: number, y: number): void {
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
  if (!w || w.isDestroyed() || busy || !prev) return
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
        text: 'MODEL_API_KEY is missing — add it to ~/.secrets/game-agent.env, then restart'
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

    const note =
      `the previous guess at ${prev.x},${prev.y} on the 0-1000 scale was wrong, ` +
      'find a different element that matches the target'
    let result
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
    lastMarker = { req: prev.req, x: result.x, y: result.y }
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

/**
 * A plan step's target was not found: ask the advisor (with a fresh
 * screenshot) why it is not visible and what to click first, then point at
 * that recovery target. The step index is unchanged, so Show me retries the
 * original step afterwards.
 */
async function attemptRecovery(req: PointRequest, w: BrowserWindow): Promise<void> {
  const label = req.label
  if (!label) return
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
    return
  }
  restoreChatAfterCapture()
  showInactive(w)
  // Re-anchor the thinking robot to the current cursor for the recovery call.
  w.webContents.send('overlay:looking', toWindowPoint(w, screen.getCursorScreenPoint()))

  let rec
  try {
    rec = await advisorRecover(
      { goal: session.goal, instruction: label.instruction, target: req.target },
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
    return
  }
  debug(`[recover] result=${rec.recovery_target ? 'target' : 'null'}`)
  const showExplanation = (): void => {
    w.webContents.send('overlay:message', { ...req.anchor, text: rec.explanation })
    chatNotice = rec.explanation
    pushChatSnapshot()
  }
  if (!rec.recovery_target) {
    showExplanation()
    return
  }

  let result
  try {
    result = await locate(rec.recovery_target, stepContext(), shot)
  } catch {
    showExplanation()
    return
  }
  if (!result.found) {
    showExplanation()
    return
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

/** Point at the current plan step's target, labeled "Step N of M". */
async function showCurrentStep(): Promise<void> {
  const step = currentStep()
  if (!step || busy) return
  greeting = null
  const w = ensureOverlay()
  const anchor = toWindowPoint(w, screen.getCursorScreenPoint())
  await pointAt({
    target: step.target,
    context: stepContext(),
    label: {
      index: session.currentStepIndex + 1,
      total: session.plan.length,
      instruction: step.instruction
    },
    anchor
  })
}

async function handleNext(): Promise<void> {
  if (!hasPlan() || busy) return
  if (!advance()) return
  if (chatAutoCollapsed) setPanelState(false, 'auto')
  const w = win
  if (w && !w.isDestroyed()) w.webContents.send('overlay:happy')
  pushChatSnapshot()
  await showCurrentStep()
}

async function handleBack(): Promise<void> {
  if (!hasPlan() || busy) return
  if (!goBack()) return
  pushChatSnapshot()
  await showCurrentStep()
}

function pushChatSnapshot(): void {
  const chat = chatWin
  if (!chat || chat.isDestroyed()) return
  const workspace = getCurrentWorkspace()
  if (workspace) {
    // Saving is async; a failure surfaces as a notice on the next snapshot.
    // The notice guard keeps the re-push from looping when it keeps failing.
    void saveHistory(workspace, session).then((ok) => {
      const unavailable = 'History is unavailable — encryption is not enabled on this Mac'
      if (!ok && chatNotice !== unavailable) {
        chatNotice = unavailable
        pushChatSnapshot()
      }
    })
  }
  const snap: ChatSnapshot = {
    messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
    hasPlan: hasPlan(),
    plan: session.plan.map((s) => ({ instruction: s.instruction, target: s.target })),
    currentStepIndex: session.currentStepIndex,
    busy,
    notice: chatNotice,
    collapsed: chatCollapsed,
    workspaceName: workspace ? workspaceName(workspace) : null,
    app: session.app,
    greeting,
    needsApp: pendingApp,
    researching: researchingApp,
    research: session.research
      ? {
          app: session.research.app,
          summary: session.research.summary,
          urls: [...session.research.urls]
        }
      : null
  }
  chat.webContents.send('chat:snapshot', snap)
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
    // Same capture + downscale as the pointer (1600px longest side, JPEG q85).
    return await capturePrimaryShot()
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
 */
async function advisorTurn(
  userText: string,
  shot: ScreenShot | undefined,
  allowResearch: boolean
): Promise<void> {
  const history = [...session.messages]
  const state = planContext()
  // SH-01 thinks on the overlay next to the cursor while the advisor works.
  const w = win
  if (w && !w.isDestroyed()) {
    w.webContents.send('overlay:looking', toWindowPoint(w, screen.getCursorScreenPoint()))
  }
  let res
  try {
    res = await advisorChat(history, userText, shot, state)
  } catch {
    chatNotice = "Couldn't reach the advisor — try again"
    return
  } finally {
    if (w && !w.isDestroyed()) w.webContents.send('overlay:looking-done')
  }
  session.messages.push({ role: 'user', text: userText })
  session.messages.push({ role: 'assistant', text: res.reply })
  if (res.plan) setPlan(res.goal ?? session.goal ?? '', res.plan)
  if (res.app) session.app = res.app
  pendingApp = res.plan ? null : (res.needs_app ?? null)
  pushChatSnapshot()
  const researchTarget = res.app ?? session.app ?? pendingApp
  if (res.needs_research && allowResearch && !res.needs_app && researchTarget) {
    const ok = await runResearch(researchTarget, userText)
    if (ok) {
      await advisorTurn(`Please continue using the research on ${researchTarget}.`, shot, false)
    }
  }
}

async function handleChatSend(rawText: unknown, rawShot: unknown): Promise<void> {
  const chat = chatWin
  if (!chat || chat.isDestroyed() || busy) return
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, MAX_QUERY_LEN) : ''
  if (!text) return
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
      chatNotice = 'MODEL_API_KEY is missing — add it to ~/.secrets/game-agent.env, then restart'
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
      chatNotice = 'MODEL_API_KEY is missing — add it to ~/.secrets/game-agent.env, then restart'
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
})

ipcMain.on('bubble:wrong-spot', () => {
  debug('[bubble] click=wrong-spot')
  void handleWrongSpot()
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

ipcMain.on('chat:research', () => {
  void (async () => {
    if (busy || researchingApp) return
    const appName = session.app ?? pendingApp
    if (!appName) {
      chatNotice = 'Ask about an app first, then research it'
      pushChatSnapshot()
      return
    }
    if (isMissingApiKey()) {
      chatNotice = 'MODEL_API_KEY is missing — add it to ~/.secrets/game-agent.env, then restart'
      pushChatSnapshot()
      return
    }
    busy = true
    chatNotice = null
    greeting = null
    pushChatSnapshot()
    try {
      const topic = lastUserText() ?? session.goal ?? appName
      const ok = await runResearch(appName, topic)
      if (ok) {
        await advisorTurn(`Please continue using the research on ${appName}.`, undefined, false)
      }
    } finally {
      busy = false
      pushChatSnapshot()
    }
  })()
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
  clearHistory(workspace)
  resetSession()
  greeting = null
  pendingApp = null
  researchingApp = null
  chatNotice = 'History cleared for this workspace'
  pushChatSnapshot()
})

ipcMain.on('chat:delete-all-history', () => {
  deleteAllHistory()
  resetSession()
  greeting = null
  pendingApp = null
  researchingApp = null
  chatNotice = 'All history deleted'
  pushChatSnapshot()
})

ipcMain.on('chat:start-new', () => {
  resetSession()
  greeting = null
  pendingApp = null
  researchingApp = null
  chatNotice = null
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
    if (process.platform === 'darwin' && app.dock) app.dock.hide()
    ensureOverlay()
    const last = loadLastWorkspace()
    if (last && (last.kind === 'named' || isGodotProject(last.path))) await openWorkspace(last)
    const ok = globalShortcut.register(HOTKEY, onHotkey)
    if (!ok) console.error(`Failed to register global shortcut ${HOTKEY}`)
    const chatOk = globalShortcut.register(CHAT_HOTKEY, toggleChat)
    if (!chatOk) console.error(`Failed to register global shortcut ${CHAT_HOTKEY}`)
    const lookOk = globalShortcut.register(LOOK_HOTKEY, onLookHotkey)
    if (!lookOk) console.error(`Failed to register global shortcut ${LOOK_HOTKEY}`)
  })
}

app.on('will-quit', () => globalShortcut.unregisterAll())
