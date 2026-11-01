import { useEffect, useRef, useState } from 'react'
import { stripStepPrefix, type ChatSnapshot } from '../../shared/api'

const EXAMPLES = [
  'Make a 2D character that moves and jumps',
  'Where do I add a script?',
  'How do I run my game?'
]

export default function ChatApp() {
  const [snap, setSnap] = useState<ChatSnapshot | null>(null)
  const [value, setValue] = useState('')
  const [withShot, setWithShot] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.chatReady()
    return window.api.onChatSnapshot(setSnap)
  }, [])

  const msgCount = snap?.messages.length ?? 0
  const busy = snap?.busy ?? false
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgCount, busy])

  const canSend = value.trim().length > 0 && !busy
  const canShowMe = (snap?.hasPlan ?? false) && !busy
  const canBack = (snap?.hasPlan ?? false) && (snap?.currentStepIndex ?? 0) > 0 && !busy
  const canNext =
    (snap?.hasPlan ?? false) &&
    (snap?.currentStepIndex ?? 0) < (snap?.plan.length ?? 0) - 1 &&
    !busy

  const send = (): void => {
    const text = value.trim()
    if (!text || busy) return
    window.api.chatSend(text, withShot)
    setValue('')
  }

  if (snap?.collapsed) {
    return (
      <div
        className="chat-tab"
        role="button"
        tabIndex={0}
        aria-label="Expand SH-0 panel"
        onClick={() => window.api.chatToggleCollapsed()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') window.api.chatToggleCollapsed()
        }}
      >
        <svg
          width={28}
          height={24}
          viewBox="0 0 28 24"
          shapeRendering="crispEdges"
          aria-hidden="true"
        >
          <rect x={0} y={0} width={28} height={24} fill="#FF7A3D" />
          <rect x={3} y={3} width={22} height={18} fill="#2A3140" />
          <rect x={8} y={8} width={4} height={8} fill="#7CF3FF" />
          <rect x={16} y={8} width={4} height={8} fill="#7CF3FF" />
        </svg>
        <div className="chat-tab-label">SH-0</div>
      </div>
    )
  }

  return (
    <div className="chat-root">
      <div className="chat-header">
        <span className="chat-title">SH-0</span>
        <button
          type="button"
          className="chat-collapse-btn"
          aria-label="Collapse panel"
          onClick={() => window.api.chatToggleCollapsed()}
        >
          ›
        </button>
      </div>
      {snap?.notice && <div className="chat-notice">{snap.notice}</div>}
      <div className="chat-list" ref={listRef}>
        {msgCount === 0 && !busy && (
          <div className="chat-empty">
            <div className="chat-greet">
              Hi, I&apos;m SH-0 — your Godot guide. What do you want to make?
            </div>
            {EXAMPLES.map((p) => (
              <button
                key={p}
                type="button"
                className="chat-example"
                onClick={() => window.api.chatSend(p, withShot)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {snap?.messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && (
          <div className="chat-msg assistant thinking">
            <span className="dots" aria-hidden="true" />
            thinking…
          </div>
        )}
      </div>
      {snap?.hasPlan && (
        <div className="chat-plan">
          <ol className="chat-steps">
            {snap.plan.map((s, i) => (
              <li
                key={i}
                className={
                  i === snap.currentStepIndex ? 'current' : i < snap.currentStepIndex ? 'done' : ''
                }
              >
                {stripStepPrefix(s.instruction)}
              </li>
            ))}
          </ol>
          <div className="chat-plan-btns">
            <button
              type="button"
              className="primary"
              disabled={!canShowMe}
              onClick={() => window.api.chatShowMe()}
            >
              Show me
            </button>
            <button type="button" disabled={!canBack} onClick={() => window.api.chatBack()}>
              Back
            </button>
            <button type="button" disabled={!canNext} onClick={() => window.api.chatNext()}>
              Next
            </button>
          </div>
        </div>
      )}
      <div className="chat-compose">
        <div className="chat-input-row">
          <input
            className="chat-input"
            value={value}
            placeholder="Ask how to do something…"
            maxLength={500}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
          />
          <button type="button" disabled={!canSend} onClick={send}>
            Send
          </button>
        </div>
        <label className="chat-toggle">
          <input
            type="checkbox"
            checked={withShot}
            disabled={busy}
            onChange={(e) => setWithShot(e.target.checked)}
          />
          Look at my screen
        </label>
      </div>
    </div>
  )
}
