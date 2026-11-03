import { useEffect, useRef, useState } from 'react'
import type { ImageErrorKind, ImageResult } from '../../shared/api'
import { ScoutIcon } from './Scout'
import Composer, { COMPOSER_MAX_LEN } from './Composer'
import { useImprove } from './useImprove'
import { useVoice } from './useVoice'

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
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  const overPromptLimit = composer.value.length > COMPOSER_MAX_LEN
  const canGenerate =
    composer.value.trim().length > 0 &&
    !overPromptLimit &&
    generating === null &&
    !composer.improving &&
    voice.micPhase === 'idle' &&
    entries.length < MAX_SESSION_IMAGES

  /** Once an image exists, prompts edit it instead of starting fresh. */
  const editing = entries.length > 0

  const dispatch = (prompt: string, reference: string | undefined): boolean => {
    if (generatingRef.current) return false
    if (entries.length >= MAX_SESSION_IMAGES) {
      setGenError(`Session limit reached (${MAX_SESSION_IMAGES} images). Start a New image.`)
      return false
    }
    setGenError(null)
    setSaveStatus(null)
    pendingPromptRef.current = prompt
    generatingRef.current = true
    setGenerating(prompt)
    window.api.imageGenerate({ prompt, reference })
    return true
  }

  const generate = (): boolean => {
    const prompt = composer.value.trim()
    if (
      !prompt ||
      overPromptLimit ||
      generatingRef.current ||
      composer.improving ||
      voice.micPhase !== 'idle'
    ) {
      return false
    }
    const latest = entries[entries.length - 1]
    return dispatch(prompt, latest?.image)
  }

  /** Repeat the last prompt from the same starting point (no reference for a first image). */
  const regenerate = (): void => {
    const last = entries[entries.length - 1]
    if (!last || generatingRef.current) return
    const previous = entries.length > 1 ? entries[entries.length - 2]?.image : undefined
    dispatch(last.prompt, previous)
  }

  const newImage = (): void => {
    generatingRef.current = false
    setGenerating(null)
    setEntries([])
    setGenError(null)
    setSaveStatus(null)
  }

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
                {i === entries.length - 1 && (
                  <>
                    <button
                      type="button"
                      disabled={generating !== null}
                      onClick={() => inputRef.current?.focus()}
                    >
                      Change this image
                    </button>
                    <button
                      type="button"
                      disabled={generating !== null}
                      onClick={regenerate}
                    >
                      Regenerate
                    </button>
                  </>
                )}
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
        {editing && <div className="image-mode">Editing the latest image</div>}
        <Composer
          composer={composer}
          voice={voice}
          layout="stacked"
          primaryLabel={editing ? 'Apply changes' : 'Generate'}
          onPrimary={generate}
          canPrimary={canGenerate}
          inputDisabled={generating !== null || composer.improving}
          expandDisabled={generating !== null}
          micDisabled={generating !== null}
          placeholder={editing ? 'Describe what to change...' : 'Describe an image…'}
          inputRef={inputRef}
        />
        {enlarged !== null && (
          <div className="image-lightbox" onClick={() => setEnlarged(null)}>
            <img src={enlarged} alt="Generated image, enlarged" />
          </div>
        )}
      </div>
    </div>
  )
}
