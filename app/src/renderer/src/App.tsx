import { useEffect, useRef, useState } from 'react'
import {
  stripStepPrefix,
  type AnchorPoint,
  type InputMode,
  type MarkerPoint,
  type Rect,
  type StatusMessage
} from '../../shared/api'
import Scout, { SCOUT_SIZE, type ScoutMood } from './Scout'

const INPUT_W = 280
const INPUT_H = 64
const PAD = 12
const MESSAGE_TTL_MS = 6000
const MARKER_TTL_MS = 6000
const HAPPY_MS = 1000
// Robot-to-target gap; 18 keeps the 56px robot clear of the 48px ring at corners.
const ROBOT_GAP = 18
const RING_R = 24
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

/** Rect-vs-circle test: the robot against the visual target ring. */
function circleOverlapsRect(
  cx: number,
  cy: number,
  r: number,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const nx = Math.min(Math.max(cx, x), x + w)
  const ny = Math.min(Math.max(cy, y), y + h)
  const dx = cx - nx
  const dy = cy - ny
  return dx * dx + dy * dy < r * r
}

interface MarkerLayout {
  robot: AnchorPoint | null
  bubble: AnchorPoint
}

/**
 * Joint robot+bubble layout inside the work area. Hard rules: the robot and
 * bubble rects never intersect, and neither covers the target ring. Tries
 * each robot side in turn; last resort hides the robot and keeps bubble
 * and ring — text readability wins over the robot.
 */
function layoutMarker(t: AnchorPoint, bw: number, bh: number, area: Rect): MarkerLayout {
  const gap = 8
  const inArea = (x: number, y: number, w: number, h: number): boolean =>
    x >= area.x + PAD &&
    y >= area.y + PAD &&
    x + w <= area.x + area.width - PAD &&
    y + h <= area.y + area.height - PAD
  // Generous box so bubble text keeps clear of the ring.
  const ringBox = { x: t.x - 30, y: t.y - 30, w: 60, h: 60 }
  const robotSpots = [
    { x: t.x - SCOUT_SIZE - ROBOT_GAP, y: t.y - SCOUT_SIZE - ROBOT_GAP },
    { x: t.x + ROBOT_GAP, y: t.y - SCOUT_SIZE - ROBOT_GAP },
    { x: t.x - SCOUT_SIZE - ROBOT_GAP, y: t.y + ROBOT_GAP },
    { x: t.x + ROBOT_GAP, y: t.y + ROBOT_GAP }
  ]
  const bubbleSides = (rx: number, ry: number, rw: number, rh: number): AnchorPoint[] => [
    { x: rx + rw + gap, y: ry },
    { x: rx - bw - gap, y: ry },
    { x: rx + (rw - bw) / 2, y: ry + rh + gap },
    { x: rx + (rw - bw) / 2, y: ry - bh - gap }
  ]
  const round = (p: AnchorPoint): AnchorPoint => ({ x: Math.round(p.x), y: Math.round(p.y) })
  for (const s of robotSpots) {
    if (!inArea(s.x, s.y, SCOUT_SIZE, SCOUT_SIZE)) continue
    if (circleOverlapsRect(t.x, t.y, RING_R, s.x, s.y, SCOUT_SIZE, SCOUT_SIZE)) continue
    const bot = { x: s.x, y: s.y, w: SCOUT_SIZE, h: SCOUT_SIZE }
    for (const c of bubbleSides(s.x, s.y, SCOUT_SIZE, SCOUT_SIZE)) {
      if (!inArea(c.x, c.y, bw, bh)) continue
      const box = { x: c.x, y: c.y, w: bw, h: bh }
      if (overlaps(box, bot) || overlaps(box, ringBox)) continue
      return { robot: round(s), bubble: round(c) }
    }
  }
  for (const c of bubbleSides(ringBox.x, ringBox.y, ringBox.w, ringBox.h)) {
    if (!inArea(c.x, c.y, bw, bh)) continue
    const box = { x: c.x, y: c.y, w: bw, h: bh }
    if (overlaps(box, ringBox)) continue
    return { robot: null, bubble: round(c) }
  }
  // Pathological (bubble larger than the area): clamp it in, robot hidden.
  const x0 = area.x + PAD
  const y0 = area.y + PAD
  return {
    robot: null,
    bubble: {
      x: Math.round(Math.min(Math.max(t.x, x0), Math.max(x0, area.x + area.width - bw - PAD))),
      y: Math.round(Math.min(Math.max(t.y, y0), Math.max(y0, area.y + area.height - bh - PAD)))
    }
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
  const [inputMode, setInputMode] = useState<InputMode>('point')
  const [lookingAt, setLookingAt] = useState<AnchorPoint | null>(null)
  const [markerAt, setMarkerAt] = useState<MarkerPoint | null>(null)
  const [message, setMessage] = useState<StatusMessage | null>(null)
  const [happy, setHappy] = useState(false)
  const [scoutPos, setScoutPos] = useState<AnchorPoint | null>(null)
  const [landed, setLanded] = useState(false)
  const [layout, setLayout] = useState<MarkerLayout | null>(null)
  const [value, setValue] = useState('')
  const fieldRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const happyTimerRef = useRef<number | undefined>(undefined)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLDivElement>(null)
  const lastSpotRef = useRef<AnchorPoint | null>(null)
  const flightMarkerRef = useRef<MarkerPoint | null>(null)

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
    const offShow = window.api.onShowInput((prompt) => {
      clearTransient()
      setValue('')
      setInputPos(clampBox(prompt, INPUT_W, INPUT_H))
      setInputMode(prompt.mode)
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
      setMarkerAt({
        ...c,
        step: pt.step,
        recovery: pt.recovery,
        look: pt.look,
        query: pt.query,
        cursor: pt.cursor,
        workArea: pt.workArea
      })
      timerRef.current = window.setTimeout(() => setMarkerAt(null), MARKER_TTL_MS)
    })
    const offMessage = window.api.onMessage((msg) => {
      clearTransient()
      setInputPos(null)
      setMessage({
        ...clampBox({ x: msg.x, y: msg.y }, 340, 64),
        text: msg.text,
        action: msg.action
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

  // Flight: a new marker sends Scout from the cursor toward its spot; the
  // joint layout can correct the destination once the bubble is measured.
  // The beam appears once it lands (immediately with reduced motion).
  useEffect(() => {
    if (!markerAt) {
      flightMarkerRef.current = null
      setScoutPos(null)
      setLanded(false)
      return
    }
    const dest = layout ? layout.robot : pointingSpot(markerAt)
    if (!dest) {
      flightMarkerRef.current = markerAt
      setScoutPos(null)
      setLanded(false)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      flightMarkerRef.current = markerAt
      setScoutPos({ ...dest })
      setLanded(true)
      return
    }
    const fresh = flightMarkerRef.current !== markerAt
    flightMarkerRef.current = markerAt
    if (fresh) setScoutPos(clampScout(markerAt.cursor))
    setLanded(false)
    let timer: number | undefined
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setScoutPos({ ...dest })
        timer = window.setTimeout(() => setLanded(true), 480)
      })
    )
    return () => {
      cancelAnimationFrame(id)
      window.clearTimeout(timer)
    }
  }, [markerAt, layout])

  // Recompute the joint robot+bubble layout from the measured bubble size
  // whenever the marker or the bubble text changes.
  const bubbleTextKey = [
    markerAt?.step ? `s${markerAt.step.index}/${markerAt.step.total}/${markerAt.step.instruction}` : '',
    markerAt?.recovery ? `r${markerAt.recovery.explanation}` : '',
    markerAt?.look ? `l${markerAt.look.answer}` : '',
    markerAt?.query ? `q${markerAt.query}` : ''
  ].join('|')
  useEffect(() => {
    const label = markerAt?.step ?? markerAt?.recovery ?? markerAt?.look ?? markerAt?.query
    const el = bubbleRef.current
    if (!markerAt || !label || !el) {
      if (!markerAt) setLayout(null)
      return
    }
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const next = layoutMarker(markerAt, rect.width, rect.height, markerAt.workArea)
    setLayout((prev) =>
      prev &&
      prev.bubble.x === next.bubble.x &&
      prev.bubble.y === next.bubble.y &&
      prev.robot?.x === next.robot?.x &&
      prev.robot?.y === next.robot?.y
        ? prev
        : next
    )
  }, [markerAt, bubbleTextKey])

  const submit = (): void => {
    const target = value.trim()
    if (!target) return
    if (inputMode === 'look') window.api.lookAsk(target)
    else window.api.submit(target)
    setValue('')
    setInputPos(null)
  }

  const askPreset = (preset: string): void => {
    window.api.lookAsk(preset)
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
    if (markerAt) lastSpotRef.current = pointingSpot(markerAt)
    flashHappy()
    setMarkerAt(null)
  }

  const spot = markerAt ? pointingSpot(markerAt) : null
  const dest = markerAt ? (layout ? layout.robot : spot) : null
  const bubbleEstimate =
    markerAt && spot ? bubbleBesideRobot(spot.x, spot.y, markerAt.x) : null
  const bubblePos = markerAt ? (layout?.bubble ?? bubbleEstimate) : null
  const beam = markerAt && dest && landed ? beamGeom(dest, markerAt) : null

  let scout: { mood: ScoutMood; x: number; y: number; tilt: -1 | 0 | 1 } | null = null
  if (happy) {
    const anchor = markerAt
      ? pointingSpot(markerAt)
      : lookingAt
        ? clampScout(lookingAt)
        : lastSpotRef.current
    if (anchor) scout = { mood: 'happy', x: anchor.x, y: anchor.y, tilt: 0 }
  } else if (markerAt && scoutPos) {
    const d = dest ?? pointingSpot(markerAt)
    scout = {
      mood: 'pointing',
      x: scoutPos.x,
      y: scoutPos.y,
      tilt: d.x + SCOUT_SIZE / 2 <= markerAt.x ? 1 : -1
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

  // Clickable islands: report bubble/pill rects to main, which polls the
  // cursor and toggles click-through. Re-report on mount, move, or resize.
  useEffect(() => {
    const report = (): void => {
      const rects: Rect[] = []
      const pushRect = (el: HTMLElement | null): void => {
        if (!el) return
        const r = el.getBoundingClientRect()
        if (r.width <= 0 || r.height <= 0) return
        rects.push({
          x: Math.floor(r.x),
          y: Math.floor(r.y),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height)
        })
      }
      const bubbleOpen =
        markerAt && bubblePos && (markerAt.step || markerAt.recovery || markerAt.query)
      if (bubbleOpen) pushRect(bubbleRef.current)
      if (message?.action) pushRect(messageRef.current)
      window.api.reportIslands(rects)
    }
    report()
    const ro = new ResizeObserver(report)
    if (bubbleRef.current) ro.observe(bubbleRef.current)
    if (messageRef.current) ro.observe(messageRef.current)
    return () => ro.disconnect()
  }, [markerAt, message, bubblePos])

  return (
    <div className="overlay-root">
      {inputPos && (
        <div className="query-box" style={{ left: inputPos.x, top: inputPos.y }}>
          <input
            ref={fieldRef}
            className="query-input"
            value={value}
            placeholder={
              inputMode === 'look'
                ? "Ask about what's under your cursor..."
                : 'What are you looking for?'
            }
            maxLength={500}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') cancel()
            }}
          />
          {inputMode === 'look' && (
            <div className="query-presets">
              <button type="button" onClick={() => askPreset('What is this?')}>
                What is this?
              </button>
              <button type="button" onClick={() => askPreset('Is this what I need?')}>
                Is this what I need?
              </button>
            </div>
          )}
          <div className="query-hint">
            {inputMode === 'look' ? 'Enter to ask · Esc to close' : 'Enter to find · Esc to close'}
          </div>
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
      {(markerAt?.step || markerAt?.recovery || markerAt?.look || markerAt?.query) && bubblePos && (
        <div
          className={`step-bubble${markerAt.look ? ' look' : ''}`}
          ref={bubbleRef}
          style={{ left: bubblePos.x, top: bubblePos.y }}
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
          ) : markerAt.step ? (
              <>
                <div className="step-bubble-text">
                  Step {markerAt.step.index} of {markerAt.step.total}:{' '}
                  {stripStepPrefix(markerAt.step.instruction)}
                </div>
                <div className="step-bubble-btns">
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
                  <button
                    type="button"
                    className="step-bubble-btn secondary"
                    onClick={() => window.api.bubbleWrongSpot()}
                  >
                    Wrong spot
                  </button>
                </div>
              </>
            ) : markerAt.look ? (
              <div className="step-bubble-text">{markerAt.look.answer}</div>
            ) : markerAt.query ? (
              <>
                <div className="step-bubble-text">{markerAt.query}</div>
                <div className="step-bubble-btns">
                  <button
                    type="button"
                    className="step-bubble-btn secondary"
                    onClick={() => window.api.bubbleWrongSpot()}
                  >
                    Wrong spot
                  </button>
                </div>
              </>
            ) : null}
        </div>
      )}
      {message && (
        <div
          className={`pill message${message.action ? ' action' : ''}`}
          ref={messageRef}
          style={{ left: message.x, top: message.y }}
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
