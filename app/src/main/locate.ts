import { desktopCapturer, screen } from 'electron'
import dotenv from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { OpenAI } from 'openai'

const MODEL = 'muse-spark-1.3'
const BASE_URL = 'https://api.meta.ai/v1'
const SECRETS_PATH = join(homedir(), '.secrets/game-agent.env')
const MAX_SIDE = 1600

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

/** Capture the primary display at native resolution, downscaled to MAX_SIDE JPEG. */
export async function capturePrimaryShot(): Promise<ScreenShot> {
  const display = screen.getPrimaryDisplay()
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
  let img = src.thumbnail
  if (img.isEmpty()) throw new Error('Empty capture')
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
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```/, '').trim()
    if (t.toLowerCase().startsWith('json')) t = t.slice(4).trim()
    if (t.endsWith('```')) t = t.slice(0, -3).trim()
  }
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
  shot?: ScreenShot
): Promise<LocateResult> {
  const key = apiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const image = shot ?? (await capturePrimaryShot())
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: key })
  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_tokens: 2000,
    reasoning_effort: 'minimal',
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
