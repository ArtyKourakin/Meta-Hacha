import type { ReactElement } from 'react'

export type ScoutMood = 'idle' | 'thinking' | 'pointing' | 'happy' | 'confused'

export const SCOUT_SIZE = 56
const PX = 4

const GRID: string[] = [
  '......oo......',
  '......oo......',
  '......kk......',
  '..kkkkkkkkkk..',
  '..kooooooook..',
  '..kossssssok..',
  '..kosessesok..',
  '..kosessesok..',
  '..kossssssok..',
  '..kooooooook..',
  '..kkkkkkkkkk..',
  '....kooook....',
  '.....yooy.....',
  '......yy......'
]

const PALETTE: Record<string, string> = {
  k: '#111216',
  o: '#FF7A3D',
  s: '#2A3140',
  e: '#7CF3FF',
  y: '#FFD25A'
}

/** Happy "^^" eyes, [col, row] per pixel. */
const HAPPY_EYES: Array<[number, number]> = [
  [4, 7],
  [5, 6],
  [6, 7],
  [7, 7],
  [8, 6],
  [9, 7]
]

/** Confused "?" badge, [col, row] per pixel at the same 4px scale. */
const Q_PIXELS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [2, 1],
  [2, 2],
  [1, 3],
  [1, 4]
]

interface ScoutProps {
  mood: ScoutMood
  x: number
  y: number
  /** Lean toward the target while pointing: -1 left, 1 right, 0 none. */
  tilt: -1 | 0 | 1
}

/**
 * Small static Scout for the HUD header. Same GRID and PALETTE, whole
 * pixels only (3px per cell, 42px), no positioning. The antenna blinks
 * while thinking (disabled under prefers-reduced-motion by global CSS).
 */
export function ScoutIcon({ thinking }: { thinking: boolean }) {
  const cells: ReactElement[] = []
  GRID.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      // Antenna tip renders separately so it can blink.
      if (ch === '.' || (r === 0 && (c === 6 || c === 7))) continue
      const fill = PALETTE[ch]
      if (!fill) continue
      cells.push(
        <rect key={`${r}-${c}`} x={c * 3} y={r * 3} width={3} height={3} fill={fill} />
      )
    }
  })
  return (
    <svg
      width={42}
      height={42}
      viewBox="0 0 42 42"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {cells}
      <rect
        x={18}
        y={0}
        width={6}
        height={3}
        fill={PALETTE.o}
        className={thinking ? 'scout-antenna blink' : 'scout-antenna'}
      />
    </svg>
  )
}

/** Scout, the pixel-robot guide. Purely decorative: never clickable. */
export default function Scout({ mood, x, y, tilt }: ScoutProps) {
  const cells: ReactElement[] = []
  const flames: ReactElement[] = []
  GRID.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.') continue
      if (ch === 'y') {
        flames.push(
          <rect
            key={`f${r}-${c}`}
            x={c * PX}
            y={r * PX}
            width={PX}
            height={PX}
            fill={PALETTE.y}
          />
        )
        continue
      }
      // Antenna tip and eyes render separately so they can animate.
      if (r === 0 && (c === 6 || c === 7)) continue
      const fill = ch === 'e' ? PALETTE.s : PALETTE[ch]
      if (!fill) continue
      cells.push(
        <rect key={`${r}-${c}`} x={c * PX} y={r * PX} width={PX} height={PX} fill={fill} />
      )
    }
  })

  const tiltClass = tilt === 1 ? ' tilt-r' : tilt === -1 ? ' tilt-l' : ''
  return (
    <div
      className={`scout${mood === 'idle' ? ' scout-idle' : ''}`}
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      <div className={`scout-body${tiltClass}`}>
        <svg
          width={SCOUT_SIZE}
          height={SCOUT_SIZE}
          viewBox="0 0 56 56"
          shapeRendering="crispEdges"
        >
          {cells}
          {mood === 'happy' ? (
            HAPPY_EYES.map(([c, r]) => (
              <rect
                key={`h${c}-${r}`}
                x={c * PX}
                y={r * PX}
                width={PX}
                height={PX}
                fill={PALETTE.e}
              />
            ))
          ) : (
            <g className={mood === 'thinking' ? 'scout-eyes scan' : 'scout-eyes'}>
              <rect x={5 * PX} y={6 * PX} width={PX} height={2 * PX} fill={PALETTE.e} />
              <rect x={8 * PX} y={6 * PX} width={PX} height={2 * PX} fill={PALETTE.e} />
            </g>
          )}
          <rect
            x={6 * PX}
            y={0}
            width={2 * PX}
            height={PX}
            fill={PALETTE.o}
            className={mood === 'thinking' ? 'scout-antenna blink' : 'scout-antenna'}
          />
          <g className="scout-flame">{flames}</g>
        </svg>
      </div>
      {mood === 'confused' && (
        <svg
          className="scout-q"
          width={12}
          height={20}
          viewBox="0 0 12 20"
          shapeRendering="crispEdges"
        >
          {Q_PIXELS.map(([c, r]) => (
            <rect
              key={`q${c}-${r}`}
              x={c * PX}
              y={r * PX}
              width={PX}
              height={PX}
              fill={PALETTE.y}
            />
          ))}
        </svg>
      )}
    </div>
  )
}
