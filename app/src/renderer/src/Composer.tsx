import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ImproveApi } from './useImprove'
import { formatVoiceElapsed, type VoiceApi } from './useVoice'

/** Shared composer limits: the chat and image windows behave the same. */
export const COMPOSER_MAX_LEN = 4000
export const COMPOSER_COUNT_AT = 3500
const MAX_INPUT_LINES = 5

export interface ComposerProps {
  composer: ImproveApi
  voice: VoiceApi
  /** inline: buttons beside the input (chat); stacked: buttons below it (image). */
  layout: 'inline' | 'stacked'
  primaryLabel: string
  /** Primary action (Send/Generate); true when it dispatched. */
  onPrimary: () => boolean
  canPrimary: boolean
  inputDisabled: boolean
  expandDisabled: boolean
  micDisabled: boolean
  placeholder: string
  /** Extra foot content before the statuses (the chat's screenshot toggle). */
  footerLeading?: ReactNode
  /** External access to the input (the chat focuses it from menu actions). */
  inputRef?: RefObject<HTMLTextAreaElement | null>
}

/**
 * Shared message composer: auto-growing input, expanded editor, voice,
 * Improve, and primary action. Used by the chat and image windows.
 */
export default function Composer({
  composer,
  voice,
  layout,
  primaryLabel,
  onPrimary,
  canPrimary,
  inputDisabled,
  expandDisabled,
  micDisabled,
  placeholder,
  footerLeading,
  inputRef
}: ComposerProps) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const resolvedRef = inputRef ?? innerRef
  const { value } = composer
  const overLimit = value.length > COMPOSER_MAX_LEN
  const showCount = value.length > COMPOSER_COUNT_AT

  /** Grow the input with its content up to MAX_INPUT_LINES, then scroll inside. */
  const fitInput = (): void => {
    const el = resolvedRef.current
    if (!el) return
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const lineH = parseFloat(cs.lineHeight) || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const max = lineH * MAX_INPUT_LINES + pad
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    setOverflows(el.scrollHeight > max + 1)
  }

  useEffect(() => {
    fitInput()
  }, [value])

  const field = (
    <div className="chat-input-wrap">
      <textarea
        ref={resolvedRef}
        className="chat-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        disabled={inputDisabled}
        onChange={(e) => composer.editValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onPrimary()
          }
        }}
      />
      {overflows && !expandDisabled && (
        <button
          type="button"
          className="chat-expand-btn"
          aria-label="Expand editor"
          title="Expand editor"
          onClick={() => setExpanded(true)}
        >
          ⤢
        </button>
      )}
    </div>
  )

  const buttons = (
    <>
      <button
        type="button"
        className={`chat-mic-btn${voice.micPhase === 'recording' ? ' recording' : ''}`}
        disabled={voice.micPhase === 'requesting' || voice.micPhase === 'working' || micDisabled}
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
        disabled={!value.trim() || inputDisabled}
        onClick={composer.improve}
      >
        {composer.improving ? 'Improving…' : 'Improve with Muse'}
      </button>
      <button type="button" className="primary" disabled={!canPrimary} onClick={() => onPrimary()}>
        {primaryLabel}
      </button>
    </>
  )

  return (
    <div className={`chat-compose${layout === 'stacked' ? ' stacked' : ''}`}>
      {expanded && (
        <div className="chat-expand" role="dialog" aria-label="Expanded message editor">
          <textarea
            className="chat-expand-input"
            value={value}
            placeholder={placeholder}
            autoFocus
            disabled={composer.improving}
            onChange={(e) => composer.editValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setExpanded(false)
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                if (onPrimary()) setExpanded(false)
              }
            }}
          />
          <div className="chat-expand-btns">
            {showCount && (
              <span className={`chat-count${overLimit ? ' over' : ''}`}>
                {value.length} / {COMPOSER_MAX_LEN}
              </span>
            )}
            <button type="button" onClick={() => setExpanded(false)}>
              Done
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canPrimary}
              onClick={() => {
                if (onPrimary()) setExpanded(false)
              }}
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      )}
      {layout === 'inline' ? (
        <div className="chat-input-row">
          {field}
          {buttons}
        </div>
      ) : (
        <>
          {field}
          <div className="chat-input-row image-btn-row">{buttons}</div>
        </>
      )}
      <div className="chat-compose-foot">
        {footerLeading}
        {voice.micPhase === 'recording' && (
          <span className="chat-mic-status recording">● {formatVoiceElapsed(voice.micElapsed)}</span>
        )}
        {voice.micPhase === 'working' && <span className="chat-mic-status">Transcribing…</span>}
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
        {showCount && (
          <span className={`chat-count${overLimit ? ' over' : ''}`}>
            {value.length} / {COMPOSER_MAX_LEN}
          </span>
        )}
      </div>
    </div>
  )
}
