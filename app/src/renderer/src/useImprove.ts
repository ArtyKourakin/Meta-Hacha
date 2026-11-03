import { useEffect, useRef, useState } from 'react'
import type { ImproveResult } from '../../shared/api'

export interface ImproveApi {
  value: string
  /** Manual edits retire any pending Undo from an improve. */
  editValue: (text: string) => void
  /** Append text at the end (voice transcripts); retires Undo. */
  appendText: (text: string) => void
  clearValue: () => void
  improving: boolean
  preImprove: string | null
  improveError: string | null
  improve: () => void
  undoImprove: () => void
  /** Drop any in-flight improve (a send in between cancels it). */
  cancelImprove: () => void
}

/**
 * Composer text plus "Improve with Muse", shared by the chat and image
 * windows. Local-only, never the snapshot busy flag.
 */
export function useImprove(opts: { disabled: boolean }): ImproveApi {
  const [value, setValue] = useState('')
  const [improving, setImproving] = useState(false)
  /** Pre-improve text for Undo, or null when no Undo is offered. */
  const [preImprove, setPreImprove] = useState<string | null>(null)
  const [improveError, setImproveError] = useState<string | null>(null)
  /** True while an improve result is still wanted. */
  const improvingRef = useRef(false)
  const disabledRef = useRef(opts.disabled)
  disabledRef.current = opts.disabled

  useEffect(() => {
    /** Late improve results are dropped (a send in between cancels them). */
    const handleImproved = (result: ImproveResult): void => {
      if (!improvingRef.current) return
      improvingRef.current = false
      setImproving(false)
      if (result.ok) {
        setValue(result.text)
      } else {
        setPreImprove(null)
        setImproveError("Couldn't improve — try again")
      }
    }
    return window.api.onChatImproved(handleImproved)
  }, [])

  const editValue = (text: string): void => {
    setValue(text)
    setPreImprove(null)
    setImproveError(null)
  }

  const appendText = (text: string): void => {
    setPreImprove(null)
    setValue((prev) => (prev.length > 0 && !/\s$/.test(prev) ? `${prev} ${text}` : prev + text))
  }

  const clearValue = (): void => {
    setValue('')
  }

  const cancelImprove = (): void => {
    improvingRef.current = false
    setImproving(false)
    setPreImprove(null)
    setImproveError(null)
  }

  const improve = (): void => {
    const text = value.trim()
    if (!text || disabledRef.current || improving) return
    setPreImprove(value)
    setImproveError(null)
    improvingRef.current = true
    setImproving(true)
    window.api.chatImprove(value)
  }

  const undoImprove = (): void => {
    if (preImprove === null) return
    setValue(preImprove)
    setPreImprove(null)
  }

  return {
    value,
    editValue,
    appendText,
    clearValue,
    improving,
    preImprove,
    improveError,
    improve,
    undoImprove,
    cancelImprove
  }
}
