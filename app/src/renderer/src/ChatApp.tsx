import { useEffect, useRef, useState } from 'react'
import { stripStepPrefix, type ChatSnapshot } from '../../shared/api'
import TabFace from './TabFace'

const EXAMPLES = [
  'Make a 2D character that moves and jumps',
  'Help me change my ad budget in Meta Ads Manager',
  'Where is the export button?'
]

export default function ChatApp() {
  const [snap, setSnap] = useState<ChatSnapshot | null>(null)
  const [value, setValue] = useState('')
  const [withShot, setWithShot] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [armed, setArmed] = useState<'clear' | 'all' | null>(null)
  const [wsOpen, setWsOpen] = useState(false)
  const [wsCreating, setWsCreating] = useState(false)
  const [wsName, setWsName] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const tabLabelRef = useRef<HTMLDivElement>(null)
  const armTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    window.api.chatReady()
    const off = window.api.onChatSnapshot(setSnap)
    return () => {
      off()
      window.clearTimeout(armTimer.current)
    }
  }, [])

  const msgCount = snap?.messages.length ?? 0
  const busy = snap?.busy ?? false
  const collapsed = snap?.collapsed ?? false
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgCount, busy])

  // Tab height fits its content: the label is the only variable part (the
  // face is 32px, the flex gap 10px), plus 12px padding top and bottom.
  useEffect(() => {
    if (!collapsed) return
    const el = tabLabelRef.current
    if (!el) return
    const report = (): void => {
      window.api.chatTabHeight(Math.ceil(32 + 10 + el.scrollHeight + 24))
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsed])

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

  const closeMenu = (): void => {
    setMenuOpen(false)
    setArmed(null)
    window.clearTimeout(armTimer.current)
  }

  /** Destructive menu actions need a second click within 3 seconds. */
  const confirmAction = (which: 'clear' | 'all', run: () => void): void => {
    if (armed !== which) {
      window.clearTimeout(armTimer.current)
      setArmed(which)
      armTimer.current = window.setTimeout(() => setArmed(null), 3000)
      return
    }
    closeMenu()
    run()
  }

  const closeWs = (): void => {
    setWsOpen(false)
    setWsCreating(false)
    setWsName('')
  }

  const createWorkspace = (): void => {
    const name = wsName.trim()
    if (!name) return
    window.api.chatCreateWorkspace(name)
    closeWs()
  }

  if (collapsed) {
    return (
      <div
        className="chat-tab"
        role="button"
        tabIndex={0}
        aria-label="Expand SH-01 panel"
        onClick={() => window.api.chatToggleCollapsed('tab')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') window.api.chatToggleCollapsed('tab')
        }}
      >
        <TabFace />
        <div className="chat-tab-label" ref={tabLabelRef}>
          SH-01
        </div>
      </div>
    )
  }

  return (
    <div className="chat-root">
      <div className="chat-header">
        <div className="chat-title-row">
          <span className="chat-title">SH-01</span>
          {snap?.app && <span className="chat-guiding">Guiding: {snap.app}</span>}
        </div>
        <div className="chat-header-btns">
          <button
            type="button"
            className="chat-menu-btn"
            aria-label="Chat menu"
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          >
            ⋯
          </button>
          <button
            type="button"
            className="chat-collapse-btn"
            aria-label="Collapse panel"
            onClick={() => window.api.chatToggleCollapsed('button')}
          >
            ›
          </button>
        </div>
        {menuOpen && (
          <>
            <div className="chat-menu-backdrop" onClick={closeMenu} />
            <div className="chat-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={!snap?.workspaceName}
                onClick={() => confirmAction('clear', () => window.api.chatClearHistory())}
              >
                {armed === 'clear'
                  ? 'Click again to clear this workspace'
                  : 'Clear history for this workspace'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => confirmAction('all', () => window.api.chatDeleteAllHistory())}
              >
                {armed === 'all' ? 'Click again to delete everything' : 'Delete all history'}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="chat-project">
        <button
          type="button"
          className="chat-project-btn"
          onClick={() => (wsOpen ? closeWs() : setWsOpen(true))}
        >
          Workspace
        </button>
        <span className="chat-project-name">{snap?.workspaceName ?? 'No workspace selected'}</span>
        {wsOpen && (
          <>
            <div className="chat-menu-backdrop" onClick={closeWs} />
            <div className="chat-menu chat-ws-pop" role="menu">
              {!wsCreating ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeWs()
                      window.api.chatSelectProject()
                    }}
                  >
                    Godot project folder
                  </button>
                  <button type="button" role="menuitem" onClick={() => setWsCreating(true)}>
                    New workspace
                  </button>
                </>
              ) : (
                <div className="chat-ws-create">
                  <input
                    className="chat-ws-input"
                    value={wsName}
                    placeholder="Name, e.g. Meta Ads"
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setWsName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createWorkspace()
                      else if (e.key === 'Escape') closeWs()
                    }}
                  />
                  <div className="chat-ws-create-btns">
                    <button type="button" disabled={!wsName.trim()} onClick={createWorkspace}>
                      Create
                    </button>
                    <button type="button" onClick={closeWs}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {snap?.notice && <div className="chat-notice">{snap.notice}</div>}
      <div className="chat-list" ref={listRef}>
        {msgCount === 0 && !busy && (
          <div className="chat-empty">
            <div className="chat-greet">
              Hi, I&apos;m SH-01 — your guide for any app. What do you want to do?
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
        {snap?.greeting && !busy && (
          <div className="chat-resume">
            <div className="chat-resume-text">
              Last time: {snap.greeting.goal} You&apos;re on step {snap.greeting.index + 1} of{' '}
              {snap.greeting.total}.
            </div>
            <div className="chat-resume-btns">
              <button
                type="button"
                className="primary"
                disabled={!canShowMe}
                onClick={() => window.api.chatShowMe()}
              >
                Show me
              </button>
              <button type="button" onClick={() => window.api.chatStartNew()}>
                Start something new
              </button>
            </div>
          </div>
        )}
        {snap?.needsApp && (
          <div className="chat-ready">
            <div className="chat-ready-text">
              Open {snap.needsApp} (or its web version), then press:
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => window.api.chatAppReady()}
            >
              I&apos;m ready
            </button>
          </div>
        )}
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
      {(snap?.researching || snap?.research || snap?.app || snap?.needsApp) && (
        <div className="chat-research">
          {snap.researching ? (
            <div className="chat-msg assistant thinking">
              <span className="dots" aria-hidden="true" />
              Researching {snap.researching}…
            </div>
          ) : (
            <>
              {snap.research && snap.research.urls.length > 0 && (
                <div className="chat-sources">
                  <span className="chat-sources-label">Sources:</span>
                  {snap.research.urls.map((u) => (
                    <button
                      key={u}
                      type="button"
                      className="chat-source-link"
                      title={u}
                      onClick={() => window.api.openLink(u)}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
              {(snap.app || snap.needsApp) && (
                <button
                  type="button"
                  className="chat-research-btn"
                  disabled={busy}
                  onClick={() => window.api.chatResearch()}
                >
                  Research this app
                </button>
              )}
            </>
          )}
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
      <div className="chat-footer">History is stored only on this Mac, encrypted.</div>
    </div>
  )
}
