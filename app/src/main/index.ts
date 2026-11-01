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
import { capturePrimaryShot, isMissingApiKey, locate } from './locate'

const HOTKEY = 'CommandOrControl+Shift+Space'
const CAPTURE_SETTLE_MS = 150
const MAX_QUERY_LEN = 500

let win: BrowserWindow | null = null
let busy = false
let lastCursor: { x: number; y: number } = { x: 0, y: 0 }

function primaryDisplay(): Display {
  return screen.getPrimaryDisplay()
}

function toWindowPoint(p: { x: number; y: number }): { x: number; y: number } {
  const b = primaryDisplay().bounds
  return { x: p.x - b.x, y: p.y - b.y }
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

function createWindow(): BrowserWindow {
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  w.setIgnoreMouseEvents(true, { forward: true })
  w.on('closed', () => {
    if (win === w) win = null
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void w.loadURL(devUrl)
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  w.once('ready-to-show', () => showInactive(w))
  return w
}

function ensureWindow(): BrowserWindow {
  if (!win || win.isDestroyed()) win = createWindow()
  const bounds = primaryDisplay().bounds
  if (!sameRect(win.getBounds(), bounds)) win.setBounds(bounds)
  return win
}

function onHotkey(): void {
  const w = ensureWindow()
  if (process.platform === 'darwin') app.show()
  lastCursor = screen.getCursorScreenPoint()
  if (!w.isVisible()) w.show()
  app.focus({ steal: true })
  w.focus()
  w.setIgnoreMouseEvents(false)
  w.webContents.send('overlay:show-input', toWindowPoint(lastCursor))
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

async function handleSubmit(rawTarget: string): Promise<void> {
  const w = win
  if (!w || w.isDestroyed() || busy) return
  const target = rawTarget.trim().slice(0, MAX_QUERY_LEN)
  if (!target) return
  busy = true
  try {
    const anchor = toWindowPoint(lastCursor)
    w.webContents.send('overlay:hide-input')
    w.setIgnoreMouseEvents(true, { forward: true })

    // 'not-determined' (or 'unknown') falls through: the getSources call in
    // capturePrimaryShot triggers the macOS permission prompt.
    const screenStatus =
      process.platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('screen')
        : 'granted'
    if (screenStatus === 'denied' || screenStatus === 'restricted') {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', {
        ...anchor,
        text: 'Allow Screen Recording in System Settings → Privacy & Security, then restart'
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

    w.hide()
    await sleep(CAPTURE_SETTLE_MS)
    let shot
    try {
      shot = await capturePrimaryShot()
    } catch {
      releaseToPreviousApp(w)
      w.webContents.send('overlay:message', { ...anchor, text: 'Screen capture failed — try again' })
      return
    }
    showInactive(w)
    w.webContents.send('overlay:looking', anchor)

    let result
    try {
      result = await locate(target, undefined, shot)
    } catch {
      w.webContents.send('overlay:message', { ...anchor, text: 'Lookup failed — try again' })
      return
    }
    if (!result.found) {
      w.webContents.send('overlay:message', { ...anchor, text: "I couldn't find it" })
      return
    }
    const bounds = primaryDisplay().bounds
    w.webContents.send('overlay:marker', {
      x: (result.x / 1000) * bounds.width,
      y: (result.y / 1000) * bounds.height
    })
  } finally {
    busy = false
  }
}

ipcMain.on('input:submit', (_event, target: unknown) => {
  void handleSubmit(typeof target === 'string' ? target : '')
})

ipcMain.on('input:cancel', () => {
  const w = win
  if (!w || w.isDestroyed()) return
  w.webContents.send('overlay:hide-input')
  w.setIgnoreMouseEvents(true, { forward: true })
  if (process.platform === 'darwin') app.hide()
  else w.blur()
})

void app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide()
  ensureWindow()
  const ok = globalShortcut.register(HOTKEY, onHotkey)
  if (!ok) console.error(`Failed to register global shortcut ${HOTKEY}`)
})

app.on('will-quit', () => globalShortcut.unregisterAll())
