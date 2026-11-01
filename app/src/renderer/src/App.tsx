import { useEffect, useRef, useState } from 'react'
import type { AnchorPoint, MarkerPoint, StatusMessage } from '../../shared/api'

const INPUT_W = 280
const INPUT_H = 64
const PAD = 12
const MESSAGE_TTL_MS = 6000
const MARKER_TTL_MS = 6000

function clampBox(pos: AnchorPoint, w: number, h: number): AnchorPoint {
  const maxX = Math.max(PAD, window.innerWidth - w - PAD)
  const maxY = Math.max(PAD, window.innerHeight - h - PAD)
  return {
    x: Math.min(Math.max(pos.x + 16, PAD), maxX),
    y: Math.min(Math.max(pos.y + 16, PAD), maxY)
  }
}

function clampPoint(pos: AnchorPoint, margin: number): AnchorPoint {
  return {
    x: Math.min(Math.max(pos.x, margin), window.innerWidth - margin),
    y: Math.min(Math.max(pos.y, margin), window.innerHeight - margin)
  }
}

export default function App() {
  const [inputPos, setInputPos] = useState<AnchorPoint | null>(null)
  const [lookingAt, setLookingAt] = useState<AnchorPoint | null>(null)
  const [markerAt, setMarkerAt] = useState<MarkerPoint | null>(null)
  const [message, setMessage] = useState<StatusMessage | null>(null)
  const [value, setValue] = useState('')
  const fieldRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const hoveredRef = useRef(false)

  useEffect(() => {
    const clearTransient = (): void => {
      window.clearTimeout(timerRef.current)
      setLookingAt(null)
      setMarkerAt(null)
      setMessage(null)
    }
    const offShow = window.api.onShowInput((pos) => {
      clearTransient()
      setValue('')
      setInputPos(clampBox(pos, INPUT_W, INPUT_H))
    })
    const offHide = window.api.onHideInput(() => setInputPos(null))
    const offLooking = window.api.onLooking((pos) => {
      clearTransient()
      setInputPos(null)
      setLookingAt(clampBox(pos, 200, 48))
    })
    const offMarker = window.api.onMarker((pt) => {
      clearTransient()
      setInputPos(null)
      const c = clampPoint(pt, 32)
      setMarkerAt({ ...c, step: pt.step, recovery: pt.recovery, cursor: pt.cursor })
      timerRef.current = window.setTimeout(() => setMarkerAt(null), MARKER_TTL_MS)
    })
    const offMessage = window.api.onMessage((msg) => {
      clearTransient()
      setInputPos(null)
      setMessage({ ...clampBox({ x: msg.x, y: msg.y }, 340, 64), text: msg.text })
      timerRef.current = window.setTimeout(() => setMessage(null), MESSAGE_TTL_MS)
    })
    return () => {
      offShow()
      offHide()
      offLooking()
      offMarker()
      offMessage()
      window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (inputPos) fieldRef.current?.focus()
  }, [inputPos])

  // Drive overlay click-through from the bubble. A new bubble can render
  // under a stationary cursor (no mouseenter fires), so check containment
  // against the cursor main sampled with the marker. Only hand clicks back
  // through when the bubble is actually gone.
  useEffect(() => {
    const label = markerAt?.step ?? markerAt?.recovery
    if (!markerAt || !label) {
      hoveredRef.current = false
      window.api.hoverBubble(false)
      return
    }
    const rect = bubbleRef.current?.getBoundingClientRect()
    const c = markerAt.cursor
    const inside = rect
      ? c.x >= rect.left && c.x <= rect.right && c.y >= rect.top && c.y <= rect.bottom
      : false
    hoveredRef.current = inside
    window.api.hoverBubble(inside)
  }, [markerAt])

  const submit = (): void => {
    const target = value.trim()
    if (!target) return
    window.api.submit(target)
    setValue('')
    setInputPos(null)
  }

  const cancel = (): void => {
    window.api.cancel()
    setValue('')
    setInputPos(null)
  }

  const dismissMarker = (): void => {
    window.clearTimeout(timerRef.current)
    window.api.bubbleDone()
    hoveredRef.current = false
    window.api.hoverBubble(false)
    setMarkerAt(null)
  }

  const bubbleEnter = (): void => {
    hoveredRef.current = true
    window.api.hoverBubble(true)
  }

  const bubbleMove = (): void => {
    if (!hoveredRef.current) {
      hoveredRef.current = true
      window.api.hoverBubble(true)
    }
  }

  const bubbleLeave = (): void => {
    hoveredRef.current = false
    window.api.hoverBubble(false)
  }

  const bubblePos = markerAt ? clampBox({ x: markerAt.x, y: markerAt.y }, 240, 80) : null

  return (
    <div className="overlay-root">
      {inputPos && (
        <div className="query-box" style={{ left: inputPos.x, top: inputPos.y }}>
          <input
            ref={fieldRef}
            className="query-input"
            value={value}
            placeholder="What are you looking for?"
            maxLength={500}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') cancel()
            }}
          />
          <div className="query-hint">Enter to find · Esc to close</div>
        </div>
      )}
      {lookingAt && !markerAt && !message && (
        <div className="pill looking" style={{ left: lookingAt.x, top: lookingAt.y }}>
          <span className="dots" aria-hidden="true" />
          looking…
        </div>
      )}
      {markerAt && (
        <div className="marker" style={{ left: markerAt.x, top: markerAt.y }} aria-hidden="true">
          <div className="marker-ring" />
          <div className="marker-dot" />
        </div>
      )}
      {(markerAt?.step || markerAt?.recovery) && bubblePos && (
        <div
          className="step-bubble"
          ref={bubbleRef}
          style={{ left: bubblePos.x, top: bubblePos.y }}
          onMouseEnter={bubbleEnter}
          onMouseMove={bubbleMove}
          onMouseLeave={bubbleLeave}
        >
          {markerAt.recovery ? (
            <>
              <div className="step-bubble-text">
                First click here: {markerAt.recovery.explanation}
              </div>
              <button
                type="button"
                className="step-bubble-btn"
                onClick={() => window.api.bubbleRetry()}
              >
                Show me
              </button>
            </>
          ) : (
            markerAt.step && (
              <>
                <div className="step-bubble-text">
                  Step {markerAt.step.index} of {markerAt.step.total}: {markerAt.step.instruction}
                </div>
                {markerAt.step.index >= markerAt.step.total ? (
                  <button type="button" className="step-bubble-btn" onClick={dismissMarker}>
                    Done
                  </button>
                ) : (
                  <button
                    type="button"
                    className="step-bubble-btn"
                    onClick={() => window.api.bubbleNext()}
                  >
                    Next
                  </button>
                )}
              </>
            )
          )}
        </div>
      )}
      {message && (
        <div className="pill message" style={{ left: message.x, top: message.y }}>
          {message.text}
        </div>
      )}
    </div>
  )
}
