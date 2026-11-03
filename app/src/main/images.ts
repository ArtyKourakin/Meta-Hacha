import { getModelApiKey } from './locate'
import type { ImageErrorKind } from '../shared/api'

const GENERATIONS_URL = 'https://api.meta.ai/v1/images/generations'
const EDITS_URL = 'https://api.meta.ai/v1/images/edits'
const IMAGE_MODEL = 'muse-image-1.0'

/** Failure of an image request, classified for a clear notice. Never carries prompts or image data. */
export class ImageError extends Error {
  readonly kind: ImageErrorKind

  constructor(kind: ImageErrorKind) {
    super(`Image request failed: ${kind}`)
    this.kind = kind
  }
}

/**
 * Generate a PNG with Muse Image, or edit `reference` (a PNG data URL) when
 * given. Returns the result as a PNG data URL. Throws ImageError on any
 * failure. Never logs prompts or image data, and never saves to disk.
 */
export async function createImage(prompt: string, reference?: string): Promise<string> {
  const key = getModelApiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const body: Record<string, unknown> = {
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    output_format: 'png',
    reasoning_strength: 'low'
  }
  let url = GENERATIONS_URL
  if (reference) {
    url = EDITS_URL
    body.images = [{ image_url: reference }]
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  } catch {
    throw new ImageError('network')
  }
  if (res.status === 429) throw new ImageError('rate-limited')
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // A content-safety block is a 400 carrying content_policy_violation.
    if (res.status === 400 && text.includes('content_policy_violation')) {
      throw new ImageError('policy')
    }
    throw new ImageError('api')
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ImageError('api')
  }
  // Images Response: { data: [{ b64_json, ... }] } (default b64_json format).
  const data = (json as { data?: unknown }).data
  const first = Array.isArray(data) ? (data[0] as { b64_json?: unknown }) : undefined
  if (!first || typeof first.b64_json !== 'string' || first.b64_json.length === 0) {
    throw new ImageError('api')
  }
  return `data:image/png;base64,${first.b64_json}`
}
