import { useEffect, useRef, useState } from 'react'
import type { ImageErrorKind, ImageResult } from '../../shared/api'
import { ScoutIcon } from './Scout'
import { useImprove } from './useImprove'
import { formatVoiceElapsed, useVoice } from './useVoice'

/** Session cap so image data URLs stay reasonable in memory. */
const MAX_SESSION_IMAGES = 20

const IMAGE_NOTICES: Record<ImageErrorKind, string> = {
  policy: 'Blocked by content safety — try a different prompt.',
  'rate-limited': 'Too many requests — wait a moment and try again.',
  network: "Couldn't reach image generation — check your connection.",
  api: 'Image generation failed — try again.'
}

interface ImageEntry {
  prompt: string
  /** PNG data URL, memory-only until the user saves it. */
  image: string
}

/** Standalone image creation window (#image route). */
export default function ImageApp() {
  const [entries, setEntries] = useState<ImageEntry[]>([])
  /** Prompt currently generating, or null when idle. */
  const [generating, setGenerating] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const generatingRef = useRef(false)
  const pendingPromptRef = useRef('')
  const saveTimer = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)
  const composer = useImprove({ disabled: generating !== null })
  const voice = useVoice({ onTranscript: (text) => composer.appendText(text) })

  useEffect(() => {
    const handleGenerated = (result: ImageResult): void => {
      if (!generatingRef.current) return
      generatingRef.current = false
      setGenerating(null)
      if (result.ok) {
        const prompt = pendingPromptRef.current
        setEntries((prev) => [...prev, { prompt, image: result.image }])
        composer.clearValue()
      } else {
        setGenError(result.message ?? IMAGE_NOTICES[result.error])
      }
    }
    const offGenerated = window.api.onImageGenerated(handleGenerated)
    const offSaved = window.api.onImageSaved((result: { ok: boolean }) => {
      window.clearTimeout(saveTimer.current)
      setSaveStatus(result.ok ? 'Saved.' : "Couldn't save the image.")
      saveTimer.current = window.setTimeout(() => setSaveStatus(null), 3000)
    })
    return () => {
      offGenerated()
      offSaved()
      window.clearTimeout(saveTimer.current)
    }
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length, generating])

  const canGenerate =
    composer.value.trim().length > 0 &&
    generating === null &&
    !composer.improving &&
    voice.micPhase === 'idle' &&
    entries.length < MAX_SESSION_IMAGES

  const generate = (): void => {
    const prompt = composer.value.trim()
    if (!prompt || generatingRef.current || composer.improving || voice.micPhase !== 'idle') {
      return
    }
    if (entries.length >= MAX_SESSION_IMAGES) {
      setGenError(`Session limit reached (${MAX_SESSION_IMAGES} images). Start a New image.`)
      return
    }
    setGenError(null)
    setSaveStatus(null)
    pendingPromptRef.current = prompt
    generatingRef.current = true
    setGenerating(prompt)
    const latest = entries[entries.length - 1]
    window.api.imageGenerate({ prompt, reference: latest?.image })
  }

  const newImage = (): void => {
    generatingRef.current = false
    setGenerating(null)
    setEntries([])
    setGenError(null)
    setSaveStatus(null)
  }

  const composerDisabled = generating !== null

  return (
    <div className="chat-root">
      <div className="chat-main">
        <div className="image-header">
          <span className="chat-title-icon">
            <ScoutIcon thinking={generating !== null} cell={2} />
          </span>
          <span className="image-title">Create image</span>
          <button type="button" className="chat-project-btn" onClick={newImage}>
            New image
          </button>
        </div>
        <div className="image-list" ref={listRef}>
          {entries.length === 0 && generating === null && (
            <div className="image-empty">
              Describe an image and press Generate. Follow-up prompts edit the latest image —
              try “make it blue”.
            </div>
          )}
          {entries.map((e, i) => (
            <div key={i} className="image-card">
              <div className="image-prompt">{e.prompt}</div>
              <button
                type="button"
                className="image-thumb"
                aria-label="View larger"
                onClick={() => setEnlarged(e.image)}
              >
                <img src={e.image} alt={e.prompt} />
              </button>
              <div className="chat-discovery-btns image-btns">
                <button
                  type="button"
                  onClick={() =>
                    window.api.imageSave({ image: e.image, filename: `sh01-image-${i + 1}.png` })
                  }
                >
                  Save
                </button>
                <button type="button" onClick={() => window.api.copyText(e.prompt)}>
                  Copy prompt
                </button>
              </div>
            </div>
          ))}
          {generating !== null && (
            <div className="chat-msg assistant thinking">
              <span className="dots" aria-hidden="true" />
              creating…
            </div>
          )}
        </div>
        {genError && <div className="chat-notice">{genError}</div>}
        {saveStatus && <div className="chat-notice">{saveStatus}</div>}
        <div className="chat-compose">
          <div className="chat-input-row">
            <div className="chat-input-wrap">
              <textarea
                className="chat-input"
                rows={1}
                value={composer.value}
                placeholder="Describe an image…"
                disabled={composerDisabled || composer.improving}
                onChange={(e) => composer.editValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    generate()
                  }
                }}
              />
            </div>
            <button
              type="button"
              className={`chat-mic-btn${voice.micPhase === 'recording' ? ' recording' : ''}`}
              disabled={
                voice.micPhase === 'requesting' ||
                voice.micPhase === 'working' ||
                composerDisabled
              }
              onClick={voice.pressMic}
              aria-label={voice.micPhase === 'recording' ? 'Stop recording' : 'Voice input'}
              title="Voice input"
            >
              <svg width="11" height="14" viewBox="0 0 11 14" aria-hidden="true">
                <rect x="3.5" y="0.5" width="4" height="7" rx="2" fill="none" stroke="currentColor" />
                <path d="M1.5 6.5 v0.5 a4 4 0 0 0 8 0 v-0.5" fill="none" stroke="currentColor" />
                <path d="M5.5 11 v1.5 M3.5 13.5 h4" stroke="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className="chat-improve-btn"
              disabled={!composer.value.trim() || composerDisabled || composer.improving}
              onClick={composer.improve}
            >
              {composer.improving ? 'Improving…' : 'Improve with Muse'}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canGenerate}
              onClick={generate}
            >
              Generate
            </button>
          </div>
          <div className="chat-compose-foot">
            {voice.micPhase === 'recording' && (
              <span className="chat-mic-status recording">
                ● {formatVoiceElapsed(voice.micElapsed)}
              </span>
            )}
            {voice.micPhase === 'working' && (
              <span className="chat-mic-status">Transcribing…</span>
            )}
            {voice.micError && <span className="chat-mic-error">{voice.micError}</span>}
            {voice.micDenied && (
              <button
                type="button"
                className="chat-improve-undo"
                onClick={() => window.api.openMicSettings()}
              >
                Open Settings
              </button>
            )}
            {composer.preImprove !== null && !composer.improving && (
              <button
                type="button"
                className="chat-improve-undo"
                onClick={() => composer.undoImprove()}
              >
                Undo
              </button>
            )}
            {composer.improveError && (
              <span className="chat-improve-error">{composer.improveError}</span>
            )}
          </div>
        </div>
        {enlarged !== null && (
          <div className="image-lightbox" onClick={() => setEnlarged(null)}>
            <img src={enlarged} alt="Generated image, enlarged" />
          </div>
        )}
      </div>
    </div>
  )
}
