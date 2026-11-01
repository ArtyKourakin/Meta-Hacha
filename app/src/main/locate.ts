import { BrowserWindow, desktopCapturer, screen, type Display, type NativeImage } from 'electron'
import dotenv from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OpenAI } from 'openai'
import { QUALITY, type ModelRequestKind } from './modelConfig'

const MODEL = 'muse-spark-1.3'
const BASE_URL = 'https://api.meta.ai/v1'
const SECRETS_PATH = join(homedir(), '.secrets/game-agent.env')
const MAX_SIDE = 1600
const CROP_SIZE_PT = 700

export interface ScreenShot {
  dataUrl: string
  width: number
  height: number
}

export interface LocateResult {
  found: boolean
  /** Normalized 0-1000 coordinates, (0,0) is the top-left of the image. */
  x: number
  y: number
  confidence: 'high' | 'medium' | 'low'
}

let envLoaded = false

function apiKey(): string | null {
  if (!envLoaded) {
    dotenv.config({ path: SECRETS_PATH })
    envLoaded = true
  }
  const key = process.env['MODEL_API_KEY']
  return key && key.length > 0 ? key : null
}

export function isMissingApiKey(): boolean {
  return apiKey() === null
}

export function getModelApiKey(): string | null {
  return apiKey()
}

/** Strip a single wrapping ``` fence (optionally tagged `json`) from model output. */
export function stripCodeFences(text: string): string {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```/, '').trim()
    if (t.toLowerCase().startsWith('json')) t = t.slice(4).trim()
    if (t.endsWith('```')) t = t.slice(0, -3).trim()
  }
  return t
}

async function captureDisplayNative(display: Display): Promise<NativeImage> {
  const scale = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale)
    }
  })
  const src = sources.find((s) => Number(s.display_id) === display.id) ?? sources[0]
  if (!src) throw new Error('No screen source')
  const img = src.thumbnail
  if (img.isEmpty()) throw new Error('Empty capture')
  return img
}

/** Capture the primary display at native resolution, downscaled to MAX_SIDE JPEG. */
export async function capturePrimaryShot(): Promise<ScreenShot> {
  const display = screen.getPrimaryDisplay()
  let img = await captureDisplayNative(display)
  const size = img.getSize()
  const longest = Math.max(size.width, size.height)
  if (longest > MAX_SIDE) {
    const k = MAX_SIDE / longest
    img = img.resize({
      width: Math.max(1, Math.round(size.width * k)),
      height: Math.max(1, Math.round(size.height * k)),
      quality: 'best'
    })
  }
  const out = img.getSize()
  return {
    dataUrl: `data:image/jpeg;base64,${img.toJPEG(85).toString('base64')}`,
    width: out.width,
    height: out.height
  }
}

export interface CursorCrop {
  dataUrl: string
  width: number
  height: number
}

// Crops the full screenshot around the cursor and stamps a white crosshair.
// Runs in a hidden window: canvas pixel dimensions are exact, while the raw
// bitmap APIs disagree about scale factors on Retina displays.
const CROP_SCRIPT = `async (p) => {
  const bitmap = await createImageBitmap(await (await fetch(p.dataUrl)).blob())
  const W = bitmap.width
  const H = bitmap.height
  const kx = W / p.dispW
  const ky = H / p.dispH
  const wPt = Math.min(p.size, p.dispW)
  const hPt = Math.min(p.size, p.dispH)
  const xPt = Math.min(Math.max(p.cx - wPt / 2, p.bx), p.bx + p.dispW - wPt)
  const yPt = Math.min(Math.max(p.cy - hPt / 2, p.by), p.by + p.dispH - hPt)
  const rx = Math.round((xPt - p.bx) * kx)
  const ry = Math.round((yPt - p.by) * ky)
  const rw = Math.min(Math.round(wPt * kx), W - rx)
  const rh = Math.min(Math.round(hPt * ky), H - ry)
  const canvas = document.createElement('canvas')
  canvas.width = rw
  canvas.height = rh
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, rx, ry, rw, rh, 0, 0, rw, rh)
  const px = (p.cx - xPt) * kx
  const py = (p.cy - yPt) * ky
  const arm = 18 * kx
  const gap = 4 * kx
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = Math.max(3, Math.round(3 * kx))
  ctx.beginPath()
  ctx.moveTo(px - arm, py)
  ctx.lineTo(px - gap, py)
  ctx.moveTo(px + gap, py)
  ctx.lineTo(px + arm, py)
  ctx.moveTo(px, py - arm)
  ctx.lineTo(px, py - gap)
  ctx.moveTo(px, py + gap)
  ctx.lineTo(px, py + arm)
  ctx.stroke()
  bitmap.close()
  return JSON.stringify({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: rw, height: rh })
}`

/**
 * Capture a 700x700-point region centered on the cursor (clamped to its
 * display), with a crosshair drawn at the cursor position.
 */
export async function captureCursorCrop(): Promise<CursorCrop> {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const img = await captureDisplayNative(display)
  const jpeg = img.toJPEG(90)
  const b = display.bounds
  const params = {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    cx: cursor.x,
    cy: cursor.y,
    bx: b.x,
    by: b.y,
    dispW: b.width,
    dispH: b.height,
    size: CROP_SIZE_PT
  }
  const w = new BrowserWindow({
    show: false,
    width: 10,
    height: 10,
    focusable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  try {
    await w.loadURL('about:blank')
    const raw = (await w.webContents.executeJavaScript(
      `(${CROP_SCRIPT})(${JSON.stringify(params)})`
    )) as string
    const out = JSON.parse(raw) as { dataUrl: string; width: number; height: number }
    if (
      typeof out.dataUrl !== 'string' ||
      !out.dataUrl.startsWith('data:image/jpeg;base64,') ||
      !Number.isInteger(out.width) ||
      !Number.isInteger(out.height) ||
      out.width < 1 ||
      out.height < 1
    ) {
      throw new Error('Bad crop result')
    }
    return out
  } finally {
    if (!w.isDestroyed()) w.close()
  }
}

/** Same normalized 0-1000 prompt shape as spike/accuracy.py. */
function buildPrompt(target: string, w: number, h: number, context?: string): string {
  const size = `Image size: ${w} pixels wide, ${h} pixels tall.`
  const coords =
    '"x","y": integers on a 0-1000 scale for the CENTER of the target, ' +
    'where (0,0) is the top-left corner of the image and (1000,1000) is ' +
    'the bottom-right corner. If not found, use 0,0.'
  return (
    'You are locating a UI element in a screenshot.\n' +
    `${size}\n` +
    `Target: ${target}\n` +
    (context ? `Context: ${context}\n` : '') +
    'Return ONLY a single JSON object, no other text, with this exact shape: ' +
    '{"found": true/false, "x": <int>, "y": <int>, ' +
    '"confidence": "high"|"medium"|"low"}\n' +
    '- "found": true if the target is visible in the image, else false.\n' +
    `- ${coords}\n` +
    '- "confidence": your confidence in the location.\n'
  )
}

function parseResponse(text: string): LocateResult {
  const t = stripCodeFences(text)
  const obj = JSON.parse(t) as {
    found: unknown
    x: unknown
    y: unknown
    confidence: unknown
  }
  const x = Number(obj.x)
  const y = Number(obj.y)
  const { confidence, found } = obj
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Bad coordinates')
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') {
    throw new Error('Bad confidence')
  }
  if (x < 0 || x > 1000 || y < 0 || y > 1000) throw new Error('Out of bounds')
  // Never log the raw response (may echo the prompt); throw sanitized errors only.
  return { found: found === true, x, y, confidence }
}

/**
 * Point at `target` on screen. Pass a pre-captured `shot` when the caller
 * already hid the overlay and captured (keeps our UI out of the screenshot);
 * otherwise captures the primary display directly. The optional `context`
 * carries a short summary of the user's goal (for the chat / next-step flow).
 */
export async function locate(
  target: string,
  context?: string,
  shot?: ScreenShot,
  qualityKind: ModelRequestKind = 'locate'
): Promise<LocateResult> {
  const key = apiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const image = shot ?? (await capturePrimaryShot())
  const q = QUALITY[qualityKind]
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key })
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: q.maxTokens,
    reasoning_effort: q.effort,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(target, image.width, image.height, context) },
          { type: 'image_url', image_url: { url: image.dataUrl } }
        ]
      }
    ]
  })
  const content = (response.choices[0]?.message.content ?? '').trim()
  if (!content) throw new Error('Empty response')
  return parseResponse(content)
}
