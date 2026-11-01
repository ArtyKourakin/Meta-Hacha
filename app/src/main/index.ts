import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  systemPreferences,
  type Display
} from 'electron'
import { join } from 'node:path'
import type { ChatSnapshot, MarkerPoint, StepLabel } from '../shared/api'
import { chat as advisorChat, recover as advisorRecover } from './advisor'
import { capturePrimaryShot, isMissingApiKey, locate } from './locate'
import { advance, currentStep, goBack, hasPlan, session, setPlan, stepContext } from './session'

const HOTKEY = 'CommandOrControl+Shift+Space'
const CHAT_HOTKEY = 'CommandOrControl+Alt+A'
const CAPTURE_SETTLE_MS = 150
const MAX_QUERY_LEN = 500
const CHAT_W = 400
const CHAT_H = 600

let win: BrowserWindow | null = null
let chatWin: BrowserWindow | null = null
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
  const w = new BrowserWindow({
    width: CHAT_W,
    height: CHAT_H,
    minWidth: 320,
    minHeight: 440,
    title: 'Game Agent',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  w.on('closed', () => {
    if (chatWin === w) chatWin = null
  })
  loadRenderer(w, 'chat')
  return w
}

function ensureChatWindow(): BrowserWindow {
  if (!chatWin || chatWin.isDestroyed()) chatWin = createChatWindow()
  return chatWin
}

function toggleChat(): void {
  const w = ensureChatWindow()
  if (w.isVisible()) {
    w.hide()
    return
  }
  if (process.platform === 'darwin') app.show()
  w.show()
  w.focus()
  pushChatSnapshot()
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
  w.webContents.send('overlay:show-input', toWindowPoint(w, lastCursor))
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
        text: 'Allow Screen Recording in System Settings → Privacy & Security, then restart'
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
    await sleep(CAPTURE_SETTLE_MS)
    let shot
    try {
      shot = await capturePrimaryShot()
    } catch {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', { ...req.anchor, text: 'Screen capture failed — try again' })
      return
    }
    showInactive(w)
    w.webContents.send('overlay:looking', req.anchor)

    let result
    try {
      result = await locate(req.target, req.context, shot)
    } catch {
      w.webContents.send('overlay:message', { ...req.anchor, text: 'Lookup failed — try again' })
      return
    }
    console.log(`[point] mode=${req.label ? 'step' : 'query'} found=${result.found}`)
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
  console.log('[recover] called')
  w.hide()
  await sleep(CAPTURE_SETTLE_MS)
  let shot
  try {
    shot = await capturePrimaryShot()
  } catch {
    releaseToPreviousApp(w)
    w.webContents.send('overlay:message', { ...req.anchor, text: "I couldn't find it" })
    return
  }
  showInactive(w)

  let rec
  try {
    rec = await advisorRecover(
      { goal: session.goal, instruction: label.instruction, target: req.target },
      shot
    )
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Unknown'
    console.log(`[recover] result=error:${name}`)
    w.webContents.send('overlay:message', {
      ...req.anchor,
      text: "I couldn't find it, and recovery failed"
    })
    chatNotice = "I couldn't find it, and recovery failed"
    pushChatSnapshot()
    return
  }
  console.log(`[recover] result=${rec.recovery_target ? 'target' : 'null'}`)
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
  w.webContents.send('overlay:marker', pt)
}

async function handleSubmit(rawTarget: string): Promise<void> {
  const w = win
  if (!w || w.isDestroyed() || busy) return
  const target = rawTarget.trim().slice(0, MAX_QUERY_LEN)
  if (!target) return
  await pointAt({ target, anchor: toWindowPoint(w, lastCursor) })
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
    notice: chatNotice
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
    let res
    try {
      res = await advisorChat(history, text, shot)
    } catch {
      chatNotice = "Couldn't reach the advisor — try again"
      return
    }
    session.messages.push({ role: 'user', text })
    session.messages.push({ role: 'assistant', text: res.reply })
    if (res.plan) setPlan(res.goal ?? session.goal ?? '', res.plan)
  } finally {
    busy = false
    pushChatSnapshot()
  }
}

ipcMain.on('input:submit', (_event, target: unknown) => {
  void handleSubmit(typeof target === 'string' ? target : '')
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
  console.log(`[bubble] hover=${wantClicks}`)
  if (wantClicks) w.setIgnoreMouseEvents(false)
  // A stale "leave" must not steal clicks while the query box is open.
  else if (!inputOpen) w.setIgnoreMouseEvents(true, { forward: true })
})

ipcMain.on('bubble:next', () => {
  console.log('[bubble] click=next')
  void handleNext()
})

ipcMain.on('bubble:retry', () => {
  console.log('[bubble] click=retry')
  void showCurrentStep()
})

ipcMain.on('bubble:done', () => {
  console.log('[bubble] click=done')
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
})

app.on('will-quit', () => globalShortcut.unregisterAll())
