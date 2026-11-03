import { useEffect, useRef, useState } from 'react'
import { stripStepPrefix, type ChatSnapshot, type PlanStepView } from '../../shared/api'
import { ScoutIcon } from './Scout'

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

  // Report the panel's natural height so main can fit the window to it.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = (): void =>
      window.api.hudHeight(Math.ceil(el.getBoundingClientRect().height))
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [snap])

  const busy = snap?.busy ?? false
  const paused = snap?.paused ?? false
  const hasPlan = snap?.hasPlan ?? false
  /** While discovery is open the old plan stays in main but hides here. */
  const discovering = (snap?.discovery ?? null) !== null
  const showPlan = hasPlan && !discovering
  const steps = snap?.plan ?? []
  const current = snap?.currentStepIndex ?? 0
  const onLastStep = showPlan && current >= steps.length - 1
  const canShowMe = showPlan && !busy
  const canBack = showPlan && current > 0 && !busy
  const canNext = showPlan && current < steps.length - 1 && !busy
  const canContinue = onLastStep && !busy
  const canWrongSpot = showPlan && !busy && !paused
  const step = showPlan ? steps[current] : undefined
  const nextStep = onLastStep ? undefined : steps[current + 1]

  return (
    <div className="hud-root">
      <div ref={contentRef} className="hud-panel">
        <div className="hud-header">
          <ScoutIcon thinking={busy} />
          <div className="hud-head-text">
            {showPlan ? (
              <>
                <div className="hud-step-count">
                  Step {current + 1} of {steps.length}
                </div>
                <div className="hud-goal" title={snap?.goal ?? undefined}>
                  {snap?.goal ?? 'Plan'}
                </div>
              </>
            ) : (
              <div className="hud-step-count">SH-01</div>
            )}
          </div>
          <button
            type="button"
            className="hud-close"
            aria-label="Close HUD"
            onClick={() => window.api.hudToggle()}
          >
            ✕
          </button>
        </div>
        {discovering ? (
          <div className="hud-empty">
            <div className="hud-empty-text">Answer the questions in the chat to continue.</div>
            <button type="button" onClick={() => window.api.hudOpenChat()}>
              Open chat
            </button>
          </div>
        ) : !showPlan || !step ? (
          <div className="hud-empty">
            <div className="hud-empty-text">No plan yet. Open the chat to start.</div>
            <button type="button" onClick={() => window.api.hudOpenChat()}>
              Open chat
            </button>
          </div>
        ) : (
          <>
            <div className="hud-progress" aria-hidden="true">
              {steps.map((_, i) => (
                <span key={i} className={i === current ? 'current' : i < current ? 'done' : ''} />
              ))}
            </div>
            <div className="hud-current-scroll">
              <HudCurrentStep step={step} />
            </div>
            {nextStep && (
              <div className="hud-next" title={stripStepPrefix(nextStep.instruction)}>
                Next: {stripStepPrefix(nextStep.instruction)}
              </div>
            )}
            <div className="hud-main-btns">
              <button
                type="button"
                className="hud-back"
                aria-label="Back"
                disabled={!canBack}
                onClick={() => window.api.chatBack()}
              >
                ←
              </button>
              <button
                type="button"
                className="hud-grow"
                disabled={!canShowMe}
                onClick={() => window.api.chatShowMe()}
              >
                Show me
              </button>
              {onLastStep ? (
                <button
                  type="button"
                  className="hud-grow primary"
                  disabled={!canContinue}
                  onClick={() => window.api.chatContinue()}
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  className="hud-grow primary"
                  disabled={!canNext}
                  onClick={() => window.api.chatNext()}
                >
                  Next
                </button>
              )}
            </div>
            <div className="hud-footer">
              <button
                type="button"
                disabled={!canWrongSpot}
                onClick={() => window.api.bubbleWrongSpot()}
              >
                Wrong spot
              </button>
              <button
                type="button"
                disabled={!hasPlan || busy}
                onClick={() => window.api.hudPause()}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" onClick={() => window.api.hudOpenChat()}>
                Open chat
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function HudCurrentStep({ step }: { step: PlanStepView }) {
  return (
    <>
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
