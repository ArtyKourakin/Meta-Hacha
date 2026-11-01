import { useEffect, useRef, useState } from 'react'
import { stripStepPrefix, type AnchorPoint, type MarkerPoint, type StatusMessage } from '../../shared/api'
import Scout, { SCOUT_SIZE, type ScoutMood } from './Scout'

const INPUT_W = 280
const INPUT_H = 64
const PAD = 12
const MESSAGE_TTL_MS = 6000
const MARKER_TTL_MS = 6000
const HAPPY_MS = 1000
const ROBOT_GAP = 14
const BUBBLE_W = 240
const BUBBLE_H = 88

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

function clampScout(pos: AnchorPoint): AnchorPoint {
  return {
    x: Math.min(Math.max(pos.x, PAD), Math.max(PAD, window.innerWidth - SCOUT_SIZE - PAD)),
    y: Math.min(Math.max(pos.y, PAD), Math.max(PAD, window.innerHeight - SCOUT_SIZE - PAD))
  }
}

/** Landing spot beside the target: above-left/right first, clamped on screen. */
function pointingSpot(t: AnchorPoint): AnchorPoint {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const fits = (x: number, y: number): boolean =>
    x >= PAD && y >= PAD && x + SCOUT_SIZE <= vw - PAD && y + SCOUT_SIZE <= vh - PAD
  const candidates = [
    { x: t.x - SCOUT_SIZE - ROBOT_GAP, y: t.y - SCOUT_SIZE - ROBOT_GAP },
    { x: t.x + ROBOT_GAP, y: t.y - SCOUT_SIZE - ROBOT_GAP },
    { x: t.x - SCOUT_SIZE - ROBOT_GAP, y: t.y + ROBOT_GAP },
    { x: t.x + ROBOT_GAP, y: t.y + ROBOT_GAP }
  ]
  for (const c of candidates) if (fits(c.x, c.y)) return c
  return clampScout(candidates[0])
}

/** Step bubble beside the robot, on the side away from the target. */
function bubbleBesideRobot(rx: number, ry: number, tx: number): AnchorPoint {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const robotLeft = rx + SCOUT_SIZE / 2 < tx
  const by = Math.min(Math.max(ry, PAD), Math.max(PAD, vh - BUBBLE_H - PAD))
  const bx = robotLeft ? rx - BUBBLE_W - 8 : rx + SCOUT_SIZE + 8
  if (bx >= PAD && bx + BUBBLE_W <= vw - PAD) return { x: bx, y: by }
  const fx = robotLeft ? Math.min(rx + SCOUT_SIZE - BUBBLE_W, vw - BUBBLE_W - PAD) : Math.max(rx, PAD)
  const cx = Math.min(Math.max(fx, PAD), Math.max(PAD, vw - BUBBLE_W - PAD))
  let fy = ry + SCOUT_SIZE + 8
  if (fy + BUBBLE_H > vh - PAD) fy = Math.max(PAD, ry - BUBBLE_H - 8)
  return { x: cx, y: fy }
}

interface PlacedRect {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: PlacedRect, b: PlacedRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Place the measured bubble beside the landed robot: first fitting side in
 * right/left/below/above order, never covering the robot or the target ring.
 */
function placeBubble(
  bw: number,
  bh: number,
  robot: AnchorPoint,
  target: AnchorPoint
): AnchorPoint {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 8
  const bot: PlacedRect = { x: robot.x, y: robot.y, w: SCOUT_SIZE, h: SCOUT_SIZE }
  const ring: PlacedRect = { x: target.x - 30, y: target.y - 30, w: 60, h: 60 }
  const fits = (x: number, y: number): boolean => {
    const box: PlacedRect = { x, y, w: bw, h: bh }
    return (
      x >= PAD &&
      y >= PAD &&
      x + bw <= vw - PAD &&
      y + bh <= vh - PAD &&
      !overlaps(box, bot) &&
      !overlaps(box, ring)
    )
  }
  const candidates = [
    { x: bot.x + bot.w + gap, y: bot.y },
    { x: bot.x - bw - gap, y: bot.y },
    { x: bot.x + (bot.w - bw) / 2, y: bot.y + bot.h + gap },
    { x: bot.x + (bot.w - bw) / 2, y: bot.y - bh - gap }
  ]
  for (const c of candidates) {
    if (fits(c.x, c.y)) return { x: Math.round(c.x), y: Math.round(c.y) }
  }
  return {
    x: Math.round(Math.min(Math.max(bot.x, PAD), Math.max(PAD, vw - bw - PAD))),
    y: Math.round(
      Math.min(bot.y + bot.h + gap, Math.max(PAD, vh - bh - PAD))
    )
  }
}

interface BeamGeom {
  x: number
  y: number
  w: number
  h: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Pixel beam from the robot's antenna to the target point. */
function beamGeom(spot: AnchorPoint, t: AnchorPoint): BeamGeom {
  const ax = spot.x + SCOUT_SIZE / 2
  const ay = spot.y + 2
  const pad = 4
  const x = Math.min(ax, t.x) - pad
  const y = Math.min(ay, t.y) - pad
  return {
    x,
    y,
    w: Math.abs(t.x - ax) + pad * 2,
    h: Math.abs(t.y - ay) + pad * 2,
    x1: ax - x,
    y1: ay - y,
    x2: t.x - x,
    y2: t.y - y
  }
}

export default function App() {
  const [inputPos, setInputPos] = useState<AnchorPoint | null>(null)
  const [lookingAt, setLookingAt] = useState<AnchorPoint | null>(null)
  const [markerAt, setMarkerAt] = useState<MarkerPoint | null>(null)
  const [message, setMessage] = useState<StatusMessage | null>(null)
  const [happy, setHappy] = useState(false)
  const [scoutPos, setScoutPos] = useState<AnchorPoint | null>(null)
  const [landed, setLanded] = useState(false)
  const [measuredPos, setMeasuredPos] = useState<AnchorPoint | null>(null)
  const [value, setValue] = useState('')
  const fieldRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const happyTimerRef = useRef<number | undefined>(undefined)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLDivElement>(null)
  const hoveredRef = useRef(false)
  const lastSpotRef = useRef<AnchorPoint | null>(null)

  const flashHappy = (): void => {
    window.clearTimeout(happyTimerRef.current)
    setHappy(true)
    happyTimerRef.current = window.setTimeout(() => setHappy(false), HAPPY_MS)
  }

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
    const offLookingDone = window.api.onLookingDone(() => setLookingAt(null))
    const offMarker = window.api.onMarker((pt) => {
      clearTransient()
      setInputPos(null)
      const c = clampPoint(pt, 32)
      setMarkerAt({ ...c, step: pt.step, recovery: pt.recovery, cursor: pt.cursor })
      setMeasuredPos(null)
      timerRef.current = window.setTimeout(() => setMarkerAt(null), MARKER_TTL_MS)
    })
    const offMessage = window.api.onMessage((msg) => {
      clearTransient()
      setInputPos(null)
      setMessage({
        ...clampBox({ x: msg.x, y: msg.y }, 340, 64),
        text: msg.text,
        action: msg.action,
        cursor: msg.cursor
      })
      timerRef.current = window.setTimeout(() => setMessage(null), MESSAGE_TTL_MS)
    })
    const offHappy = window.api.onHappy(() => flashHappy())
    return () => {
      offShow()
      offHide()
      offLooking()
      offLookingDone()
      offMarker()
      offMessage()
      offHappy()
      window.clearTimeout(timerRef.current)
      window.clearTimeout(happyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (inputPos) fieldRef.current?.focus()
  }, [inputPos])

  // Flight: a new marker sends Scout from the cursor to its landing spot.
  // The beam appears once it lands (immediately with reduced motion).
  useEffect(() => {
    if (!markerAt) {
      setScoutPos(null)
      setLanded(false)
      return
    }
    const spot = pointingSpot(markerAt)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setScoutPos(spot)
      setLanded(true)
      return
    }
    setScoutPos(clampScout(markerAt.cursor))
    setLanded(false)
    let timer: number | undefined
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setScoutPos(spot)
        timer = window.setTimeout(() => setLanded(true), 480)
      })
    )
    return () => {
      cancelAnimationFrame(id)
      window.clearTimeout(timer)
    }
  }, [markerAt])

  // Drive overlay click-through from the clickable islands (step bubble,
  // actionable message). A new island can render under a stationary cursor
  // (no mouseenter fires), so check containment against the cursor main
  // sampled with it. Only hand clicks back through when nothing clickable
  // is showing.
  useEffect(() => {
    const label = markerAt?.step ?? markerAt?.recovery
    const island =
      markerAt && label
        ? { el: bubbleRef.current, cursor: markerAt.cursor }
        : message?.action && message.cursor
          ? { el: messageRef.current, cursor: message.cursor }
          : null
    if (!island) {
      hoveredRef.current = false
      window.api.hoverBubble(false)
      return
    }
    const rect = island.el?.getBoundingClientRect()
    const c = island.cursor
    const inside = rect
      ? c.x >= rect.left && c.x <= rect.right && c.y >= rect.top && c.y <= rect.bottom
      : false
    hoveredRef.current = inside
    window.api.hoverBubble(inside)
  }, [markerAt, message, measuredPos])

  // Recompute bubble placement from its measured size whenever the marker
  // or the bubble text changes.
  const bubbleTextKey = markerAt?.recovery
    ? `r:${markerAt.recovery.explanation}`
    : markerAt?.step
      ? `s:${markerAt.step.index}/${markerAt.step.total}/${markerAt.step.instruction}`
      : ''
  useEffect(() => {
    const label = markerAt?.step ?? markerAt?.recovery
    const el = bubbleRef.current
    if (!markerAt || !label || !el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const next = placeBubble(rect.width, rect.height, pointingSpot(markerAt), markerAt)
    setMeasuredPos((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next))
  }, [markerAt, bubbleTextKey])

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
    if (markerAt) lastSpotRef.current = pointingSpot(markerAt)
    flashHappy()
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

  const spot = markerAt ? pointingSpot(markerAt) : null
  const bubbleEstimate =
    markerAt && spot ? bubbleBesideRobot(spot.x, spot.y, markerAt.x) : null
  const bubblePos = markerAt ? (measuredPos ?? bubbleEstimate) : null
  const beam = markerAt && spot && landed ? beamGeom(spot, markerAt) : null

  let scout: { mood: ScoutMood; x: number; y: number; tilt: -1 | 0 | 1 } | null = null
  if (happy) {
    const anchor = markerAt
      ? pointingSpot(markerAt)
      : lookingAt
        ? clampScout(lookingAt)
        : lastSpotRef.current
    if (anchor) scout = { mood: 'happy', x: anchor.x, y: anchor.y, tilt: 0 }
  } else if (markerAt && scoutPos) {
    const s = pointingSpot(markerAt)
    scout = {
      mood: 'pointing',
      x: scoutPos.x,
      y: scoutPos.y,
      tilt: s.x + SCOUT_SIZE / 2 <= markerAt.x ? 1 : -1
    }
  } else if (lookingAt) {
    const p = clampScout(lookingAt)
    scout = { mood: 'thinking', x: p.x, y: p.y, tilt: 0 }
  } else if (message) {
    const p = clampScout({ x: message.x, y: message.y - SCOUT_SIZE - 8 })
    scout = { mood: 'confused', x: p.x, y: p.y, tilt: 0 }
  } else if (inputPos) {
    const p = clampScout({ x: inputPos.x + (INPUT_W - SCOUT_SIZE) / 2, y: inputPos.y - SCOUT_SIZE - 8 })
    scout = { mood: 'idle', x: p.x, y: p.y, tilt: 0 }
  }

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
      {scout && <Scout mood={scout.mood} x={scout.x} y={scout.y} tilt={scout.tilt} />}
      {beam && (
        <svg
          className="scout-beam"
          style={{ left: beam.x, top: beam.y }}
          width={beam.w}
          height={beam.h}
          aria-hidden="true"
        >
          <line x1={beam.x1} y1={beam.y1} x2={beam.x2} y2={beam.y2} />
        </svg>
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
                  Step {markerAt.step.index} of {markerAt.step.total}:{' '}
                  {stripStepPrefix(markerAt.step.instruction)}
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
        <div
          className={`pill message${message.action ? ' action' : ''}`}
          ref={messageRef}
          style={{ left: message.x, top: message.y }}
          {...(message.action
            ? {
                onMouseEnter: bubbleEnter,
                onMouseMove: bubbleMove,
                onMouseLeave: bubbleLeave
              }
            : {})}
        >
          <span>{message.text}</span>
          {message.action === 'open-settings' && (
            <button
              type="button"
              className="pill-btn"
              onClick={() => window.api.openSettings()}
            >
              Open Settings
            </button>
          )}
        </div>
      )}
    </div>
  )
}
