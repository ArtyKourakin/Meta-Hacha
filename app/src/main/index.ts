import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type Display
} from 'electron'
import { join } from 'node:path'
import type { ChatSnapshot, MarkerPoint, StepLabel } from '../shared/api'
import { askAboutCrop, chat as advisorChat, recover as advisorRecover } from './advisor'
import {
  captureCursorCrop,
  capturePrimaryShot,
  isMissingApiKey,
  locate,
  type CursorCrop
} from './locate'
import { advance, currentStep, goBack, hasPlan, session, setPlan, stepContext } from './session'

const HOTKEY = 'CommandOrControl+Shift+Space'
const CHAT_HOTKEY = 'CommandOrControl+Alt+A'
const LOOK_HOTKEY = 'CommandOrControl+Alt+L'
const CAPTURE_SETTLE_MS = 150
const MAX_QUERY_LEN = 500
const CHAT_W = 380
const CHAT_MIN_W = 280
const TAB_W = 44
const TAB_H = 120
const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
const DEBUG = process.env['SH0_DEBUG'] === '1'

function debug(line: string): void {
  if (DEBUG) console.log(line)
}

let win: BrowserWindow | null = null
let chatWin: BrowserWindow | null = null
let chatCollapsed = false
let chatAutoCollapsed = false
let chatWidth = CHAT_W
let pendingLook: { crop: CursorCrop; cursor: { x: number; y: number } } | null = null
let busy = false
let inputOpen = false
let chatNotice: string | null = null
let lastCursor: { x: number; y: number } = { x: 0, y: 0 }

function primaryDisplay(): Display {
  return screen.getPrimaryDisplay()
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
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
  const area = primaryDisplay().workArea
  const w = new BrowserWindow({
    x: area.x + area.width - CHAT_W,
    y: area.y,
    width: CHAT_W,
    height: area.height,
    minWidth: CHAT_MIN_W,
    maxWidth: area.width,
    minHeight: area.height,
    maxHeight: area.height,
    movable: false,
    title: 'SH-0',
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
  w.on('closed', () => {
    if (chatWin === w) chatWin = null
  })
  loadRenderer(w, 'chat')
  return w
}

/** Expanded: docked right, full work-area height, width resizable. Collapsed: slim tab. */
function applyChatBounds(w: BrowserWindow): void {
  const area = primaryDisplay().workArea
  if (process.platform === 'darwin') w.setWindowButtonVisibility(!chatCollapsed)
  w.setTitle(chatCollapsed ? '' : 'SH-0')
  if (chatCollapsed) {
    w.setMinimumSize(TAB_W, TAB_H)
    w.setMaximumSize(TAB_W, TAB_H)
    w.setResizable(false)
    w.setBounds({
      x: area.x + area.width - TAB_W,
      y: area.y + Math.floor((area.height - TAB_H) / 2),
      width: TAB_W,
      height: TAB_H
    })
  } else {
    const width = Math.min(Math.max(chatWidth, CHAT_MIN_W), area.width)
    w.setMinimumSize(CHAT_MIN_W, area.height)
    w.setMaximumSize(area.width, area.height)
    w.setResizable(true)
    w.setBounds({ x: area.x + area.width - width, y: area.y, width, height: area.height })
  }
}

function ensureChatWindow(): BrowserWindow {
  if (!chatWin || chatWin.isDestroyed()) {
    chatWin = createChatWindow()
    applyChatBounds(chatWin)
  }
  return chatWin
}

function setChatCollapsed(collapsed: boolean, auto = false): void {
  const w = ensureChatWindow()
  if (collapsed && !chatCollapsed) chatWidth = w.getBounds().width
  chatCollapsed = collapsed
  chatAutoCollapsed = auto && collapsed
  if (!w.isVisible()) w.showInactive()
  applyChatBounds(w)
  pushChatSnapshot()
}

function toggleChat(): void {
  const w = ensureChatWindow()
  if (!w.isVisible()) {
    if (process.platform === 'darwin') app.show()
    w.show()
    w.focus()
    pushChatSnapshot()
    return
  }
  setChatCollapsed(!chatCollapsed)
  if (!chatCollapsed) w.focus()
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
    setChatCollapsed(true, true)
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
  w.setIgnoreMouseEvents(false)
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
      action: 'open-settings',
      cursor: anchor
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
  const chat = chatWin
  w.hide()
  if (chat && !chat.isDestroyed()) chat.hide()
  void (async () => {
    await sleep(CAPTURE_SETTLE_MS)
    let crop
    try {
      crop = await captureCursorCrop()
    } catch {
      busy = false
      showInactive(w)
      if (chat && !chat.isDestroyed()) chat.showInactive()
      w.webContents.send('overlay:message', { ...anchor, text: 'Screen capture failed — try again' })
      return
    }
    pendingLook = { crop, cursor }
    lastCursor = cursor
    busy = false
    showInactive(w)
    if (chat && !chat.isDestroyed()) chat.showInactive()
    if (!w.isVisible()) w.show()
    app.focus({ steal: true })
    w.focus()
    w.setIgnoreMouseEvents(false)
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
    w.setIgnoreMouseEvents(true, { forward: true })

    if (screenAccessBlocked()) {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...req.anchor,
        text: 'Allow Screen Recording in System Settings → Privacy & Security, then restart',
        action: 'open-settings',
        cursor: globalToWindow(screen.getCursorScreenPoint(), w.getContentBounds())
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
    const chat = chatWin
    if (chat && !chat.isDestroyed()) chat.hide()
    await sleep(CAPTURE_SETTLE_MS)
    let shot
    try {
      shot = await capturePrimaryShot()
    } catch {
      if (chat && !chat.isDestroyed()) chat.showInactive()
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', { ...req.anchor, text: 'Screen capture failed — try again' })
      return
    }
    if (chat && !chat.isDestroyed()) chat.showInactive()
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
    const bounds = primaryDisplay().bounds
    const content = w.getContentBounds()
    const pt: MarkerPoint = {
      ...normalizedToWindow(result.x, result.y, bounds, content),
      // Sampled so the renderer can tell whether the cursor is already
      // inside the bubble when it renders (no mouseenter fires then).
      cursor: globalToWindow(screen.getCursorScreenPoint(), content)
    }
    if (req.label) pt.step = req.label
    if (req.look) pt.look = { answer: req.look }
    collapseChatForPoint(pt)
    w.webContents.send('overlay:marker', pt)
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
  const chat = chatWin
  if (chat && !chat.isDestroyed()) chat.hide()
  await sleep(CAPTURE_SETTLE_MS)
  let shot
  try {
    shot = await capturePrimaryShot()
  } catch {
    if (chat && !chat.isDestroyed()) chat.showInactive()
    releaseToPreviousApp(w)
    w.webContents.send('overlay:message', { ...req.anchor, text: "I couldn't find it" })
    return
  }
  if (chat && !chat.isDestroyed()) chat.showInactive()
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
    cursor: globalToWindow(screen.getCursorScreenPoint(), content)
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
    w.setIgnoreMouseEvents(true, { forward: true })
    showInactive(w)
    w.webContents.send('overlay:looking', anchor)
    const context = lookContext()
    let res
    try {
      res = await askAboutCrop(question, context, hasPlan(), pending.crop)
    } catch {
      w.webContents.send('overlay:message', {
        ...anchor,
        text: "Couldn't reach the advisor — try again"
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
        cursor: globalToWindow(screen.getCursorScreenPoint(), content)
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
  if (chatAutoCollapsed) setChatCollapsed(false)
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
  const snap: ChatSnapshot = {
    messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
    hasPlan: hasPlan(),
    plan: session.plan.map((s) => ({ instruction: s.instruction, target: s.target })),
    currentStepIndex: session.currentStepIndex,
    busy,
    notice: chatNotice,
    collapsed: chatCollapsed
  }
  chat.webContents.send('chat:snapshot', snap)
}

async function handleChatSend(rawText: unknown, rawShot: unknown): Promise<void> {
  const chat = chatWin
  if (!chat || chat.isDestroyed() || busy) return
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, MAX_QUERY_LEN) : ''
  if (!text) return
  const withScreenshot = rawShot === true
  busy = true
  chatNotice = null
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

    let shot
    if (withScreenshot) {
      const overlay = win
      if (overlay && !overlay.isDestroyed()) overlay.hide()
      chat.hide()
      await sleep(CAPTURE_SETTLE_MS)
      try {
        // Same capture + downscale as the pointer (1600px longest side, JPEG q85).
        shot = await capturePrimaryShot()
      } catch {
        chatNotice = 'Screen capture failed — try again'
        return
      } finally {
        if (overlay && !overlay.isDestroyed()) showInactive(overlay)
        if (!chat.isDestroyed()) chat.show()
      }
    }

    const history = [...session.messages]
    // Scout thinks on the overlay next to the cursor while the advisor works.
    const w = win
    if (w && !w.isDestroyed()) {
      w.webContents.send('overlay:looking', toWindowPoint(w, screen.getCursorScreenPoint()))
    }
    try {
      const res = await advisorChat(history, text, shot)
      session.messages.push({ role: 'user', text })
      session.messages.push({ role: 'assistant', text: res.reply })
      if (res.plan) setPlan(res.goal ?? session.goal ?? '', res.plan)
    } catch {
      chatNotice = "Couldn't reach the advisor — try again"
    } finally {
      if (w && !w.isDestroyed()) w.webContents.send('overlay:looking-done')
    }
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
  w.setIgnoreMouseEvents(true, { forward: true })
  if (process.platform === 'darwin') app.hide()
  else w.blur()
})

ipcMain.on('bubble:hover', (_event, hovering: unknown) => {
  const w = win
  if (!w || w.isDestroyed()) return
  const wantClicks = hovering === true
  debug(`[bubble] hover=${wantClicks}`)
  if (wantClicks) w.setIgnoreMouseEvents(false)
  // A stale "leave" must not steal clicks while the query box is open.
  else if (!inputOpen) w.setIgnoreMouseEvents(true, { forward: true })
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
  if (chatAutoCollapsed) setChatCollapsed(false)
})

ipcMain.on('chat:toggle-collapsed', () => {
  setChatCollapsed(!chatCollapsed)
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

ipcMain.on('chat:show-me', () => {
  void showCurrentStep()
})

ipcMain.on('chat:next', () => {
  void handleNext()
})

ipcMain.on('chat:back', () => {
  void handleBack()
})

void app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide()
  ensureOverlay()
  const ok = globalShortcut.register(HOTKEY, onHotkey)
  if (!ok) console.error(`Failed to register global shortcut ${HOTKEY}`)
  const chatOk = globalShortcut.register(CHAT_HOTKEY, toggleChat)
  if (!chatOk) console.error(`Failed to register global shortcut ${CHAT_HOTKEY}`)
  const lookOk = globalShortcut.register(LOOK_HOTKEY, onLookHotkey)
  if (!lookOk) console.error(`Failed to register global shortcut ${LOOK_HOTKEY}`)
})

app.on('will-quit', () => globalShortcut.unregisterAll())
