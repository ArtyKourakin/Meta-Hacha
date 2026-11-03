import { getModelApiKey } from './locate'
import type { TranscribeErrorKind } from '../shared/api'

const TRANSCRIBE_URL = 'https://api.meta.ai/v1/asr/transcribe'
const TRANSCRIBE_MODEL = 'muse-voice-transcribe-1.0'

/** Failure of a transcription request, classified for a clear notice. Never carries audio or text. */
export class TranscribeError extends Error {
  readonly kind: TranscribeErrorKind

  constructor(kind: TranscribeErrorKind) {
    super(`Transcribe failed: ${kind}`)
    this.kind = kind
  }
}

/**
 * Transcribe one WAV clip (mono 16-bit PCM) with Muse Voice Transcribe.
 * Returns the full transcript. Throws TranscribeError on any failure.
 * Never logs audio or transcripts, and never saves audio to disk.
 */
export async function transcribeVoice(wav: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = getModelApiKey()
  if (!key) throw new Error('Missing MODEL_API_KEY')
  const form = new FormData()
  form.append(
    'request',
    new Blob(
      [
        JSON.stringify({
          model: TRANSCRIBE_MODEL,
          audioEncoding: 'WAV',
          mode: 'PUSH_TO_TALK'
        })
      ],
      { type: 'application/json' }
    )
  )
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'audio.wav')
  let res: Response
  try {
    res = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      body: form
    })
  } catch {
    throw new TranscribeError('network')
  }
  if (res.status === 429) throw new TranscribeError('rate-limited')
  if (!res.ok) throw new TranscribeError('api')
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new TranscribeError('api')
  }
  // One-shot response carries the whole transcript in `transcript`
  // (Meta's transcribe_file.py recipe reads the same field).
  const transcript = (json as { transcript?: unknown }).transcript
  if (typeof transcript !== 'string' || transcript.trim().length === 0) {
    throw new TranscribeError('no-speech')
  }
  return transcript.trim()
}
