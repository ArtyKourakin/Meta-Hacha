import { useEffect, useRef, useState, type ReactNode } from 'react'
import { stripStepPrefix, type ChatSnapshot, type PlanStepView } from '../../shared/api'

/** Compact step window (#hud route). Frameless; height fits content up to 420px. */
export default function HudApp() {
  const [snap, setSnap] = useState<ChatSnapshot | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    document.getElementById('root')?.style.setProperty('background', 'transparent')
    window.api.chatReady()
    return window.api.onChatSnapshot(setSnap)
  }, [])

  // Report content height so main can fit the window to it (max 420px).
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = (): void => window.api.hudHeight(el.scrollHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [snap])

  const busy = snap?.busy ?? false
  const paused = snap?.paused ?? false
  const hasPlan = snap?.hasPlan ?? false
  const steps = snap?.plan ?? []
  const current = snap?.currentStepIndex ?? 0
  const canShowMe = hasPlan && !busy
  const canBack = hasPlan && current > 0 && !busy
  const canNext = hasPlan && current < steps.length - 1 && !busy
  const canWrongSpot = hasPlan && !busy && !paused

  return (
    <div className="hud-root">
      <div ref={contentRef} className="hud-panel">
        <div className="hud-header">
          <span className="hud-title" title={snap?.goal ?? undefined}>
            {hasPlan ? (snap?.goal ?? 'Plan') : 'SH-01'}
          </span>
          <button
            type="button"
            className="hud-link"
            onClick={() => window.api.hudOpenChat()}
          >
            Open chat
          </button>
        </div>
        {!hasPlan ? (
          <div className="hud-empty">
            <div className="hud-empty-text">No plan yet. Open the chat to start.</div>
            <button type="button" onClick={() => window.api.hudOpenChat()}>
              Open chat
            </button>
          </div>
        ) : (
          <>
            <ol className="hud-steps">
              {steps.map((s, i) => (
                <li
                  key={i}
                  className={
                    i === current ? 'current' : i < current ? 'done' : 'next'
                  }
                >
                  {i < current ? (
                    <span className="hud-done-label">✓ {stripStepPrefix(s.instruction)}</span>
                  ) : i === current ? (
                    <HudCurrentStep step={s} index={i} total={steps.length} />
                  ) : (
                    <span className="hud-next-label">{stripStepPrefix(s.instruction)}</span>
                  )}
                </li>
              ))}
            </ol>
            <div className="hud-btns">
              <button type="button" disabled={!canShowMe} onClick={() => window.api.chatShowMe()}>
                Show me
              </button>
              <button type="button" disabled={!canNext} onClick={() => window.api.chatNext()}>
                Next
              </button>
              <button type="button" disabled={!canBack} onClick={() => window.api.chatBack()}>
                Back
              </button>
              <button
                type="button"
                disabled={!canWrongSpot}
                onClick={() => window.api.bubbleWrongSpot()}
              >
                Wrong spot
              </button>
              <button type="button" disabled={!hasPlan || busy} onClick={() => window.api.hudPause()}>
                {paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function HudCurrentStep({
  step,
  index,
  total
}: {
  step: PlanStepView
  index: number
  total: number
}): ReactNode {
  return (
    <>
      <div className="hud-current-head">
        Step {index + 1} of {total}
      </div>
      <div className="hud-current-text">{stripStepPrefix(step.instruction)}</div>
      {step.action === 'type' && step.text && (
        <div className="hud-action">
          <span className="hud-type">Type: {step.text}</span>
          <button type="button" onClick={() => window.api.copyText(step.text ?? '')}>
            Copy
          </button>
        </div>
      )}
      {step.action === 'shortcut' && (step.keys ?? []).length > 0 && (
        <div className="hud-action">
          {(step.keys ?? []).map((k, i) => (
            <span key={i} className="key-cap">
              {k}
            </span>
          ))}
        </div>
      )}
      {step.action === 'select' && (step.choose ?? []).length > 0 && (
        <div className="hud-action hud-choose">Choose: {(step.choose ?? []).join(' → ')}</div>
      )}
      {step.caution && <div className="hud-caution">⚠ {step.caution}</div>}
    </>
  )
}
