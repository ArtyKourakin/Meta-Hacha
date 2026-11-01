import { useEffect, useRef, useState } from 'react'

/** Cursor within this many screen points of the tab center takes over the eyes. */
const NEAR_PX = 300

type Lids = 'open' | 'blink' | 'happy'

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * SH-0 face for the collapsed chat tab. Pixel style matching the overlay
 * robot: antenna light, blocky cyan eyes, whole-pixel movement only.
 * Random idle behaviours run every 3-8s unless the cursor is near (then
 * the eyes follow it) or reduced motion is on (occasional blinks only).
 */
export default function TabFace() {
  const [gaze, setGaze] = useState({ dx: 0, dy: 0 })
  const [lids, setLids] = useState<Lids>('open')
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const reduced = useReducedMotion()
  const timers = useRef<number[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => window.clearTimeout(t))
  }, [])

  useEffect(() => window.api.onTabCursor(setCursor), [])

  useEffect(() => {
    let alive = true
    const later = (fn: () => void, ms: number): void => {
      timers.current.push(
        window.setTimeout(() => {
          if (alive) fn()
        }, ms)
      )
    }
    setGaze({ dx: 0, dy: 0 })
    setLids('open')

    const blink = (double: boolean): void => {
      setLids('blink')
      later(() => setLids('open'), 120)
      if (double) {
        later(() => setLids('blink'), 270)
        later(() => setLids('open'), 390)
      }
    }
    const lookAround = (): void => {
      setGaze({ dx: -1, dy: 0 })
      later(() => setGaze({ dx: 1, dy: 0 }), 1000)
      later(() => setGaze({ dx: 0, dy: 0 }), 2000)
    }
    const lookUp = (): void => {
      setGaze({ dx: 0, dy: -1 })
      later(() => setGaze({ dx: 0, dy: 0 }), 1500)
    }
    const happy = (): void => {
      setLids('happy')
      later(() => setLids('open'), 1000)
    }
    const runBehavior = (): void => {
      if (reduced) {
        blink(Math.random() < 0.3)
        return
      }
      const r = Math.random()
      if (r < 1 / 6) happy()
      else if (r < 0.44) blink(Math.random() < 0.3)
      else if (r < 0.72) lookAround()
      else lookUp()
    }
    const schedule = (): void => {
      if (!alive) return
      // Random pause of 3-8s between behaviours; nothing runs while hidden.
      later(() => {
        if (document.hidden) schedule()
        else {
          runBehavior()
          schedule()
        }
      }, 3000 + Math.random() * 5000)
    }
    schedule()
    return () => {
      alive = false
    }
  }, [reduced])

  // Cursor follow wins over the random behaviours (except reduced motion).
  let dx = gaze.dx
  let dy = gaze.dy
  let lid = lids
  if (!reduced && cursor && Math.hypot(cursor.x, cursor.y) <= NEAR_PX) {
    dx = cursor.x > 0 ? 1 : cursor.x < 0 ? -1 : 0
    dy = cursor.y > 0 ? 1 : cursor.y < 0 ? -1 : 0
    lid = 'open'
  }

  return (
    <svg
      width={28}
      height={32}
      viewBox="0 -8 28 32"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x={13} y={-4} width={2} height={4} fill="#FF7A3D" />
      <rect x={13} y={-6} width={2} height={2} fill="#FF7A3D" className="tab-antenna-tip" />
      <rect x={0} y={0} width={28} height={24} fill="#FF7A3D" />
      <rect x={3} y={3} width={22} height={18} fill="#2A3140" />
      {lid === 'happy' ? (
        <>
          <rect x={8} y={13} width={1} height={1} fill="#7CF3FF" />
          <rect x={9} y={12} width={2} height={1} fill="#7CF3FF" />
          <rect x={11} y={13} width={1} height={1} fill="#7CF3FF" />
          <rect x={16} y={13} width={1} height={1} fill="#7CF3FF" />
          <rect x={17} y={12} width={2} height={1} fill="#7CF3FF" />
          <rect x={19} y={13} width={1} height={1} fill="#7CF3FF" />
        </>
      ) : lid === 'blink' ? (
        <>
          <rect x={8 + dx} y={12} width={4} height={1} fill="#7CF3FF" />
          <rect x={16 + dx} y={12} width={4} height={1} fill="#7CF3FF" />
        </>
      ) : (
        <>
          <rect x={8 + dx} y={8 + dy} width={4} height={8} fill="#7CF3FF" />
          <rect x={16 + dx} y={8 + dy} width={4} height={8} fill="#7CF3FF" />
        </>
      )}
    </svg>
  )
}
