import { useEffect, useRef, useState } from 'react'
import {
  GLOBAL_SHORTCUTS,
  stripStepPrefix,
  type ChatIndexEntry,
  type ChatSnapshot,
  type ImproveResult
} from '../../shared/api'
import { ScoutIcon } from './Scout'

const EXAMPLES = [
  'Make a 2D character that moves and jumps',
  'Help me change my ad budget in Meta Ads Manager',
  'Where is the export button?'
]

/** Local-only flag: the shortcuts panel auto-opens once on first launch. */
const SHORTCUTS_SEEN_KEY = 'sh01-shortcuts-seen'

/** Fixed in-chat keys (not global accelerators, so not in GLOBAL_SHORTCUTS). */
const CHAT_KEYS: readonly { keys: readonly string[]; description: string }[] = [
  { keys: ['Enter'], description: 'Send your message' },
  { keys: ['⇧', 'Enter'], description: 'Start a new line' },
  { keys: ['Esc'], description: 'Close this window' }
]

// Mirror of the main-process chat limit; the main process enforces it.
const MAX_CHAT_LEN = 4000
const CHAT_COUNT_AT = 3500
const MAX_INPUT_LINES = 5

interface CodeBlockView {
  filename: string
  language: string
  purpose: string
  content: string
}

type MsgPart = { kind: 'text'; text: string } | { kind: 'code'; block: CodeBlockView }

/**
 * Split assistant text into plain runs and sh01-code blocks. The closing
 * fence must be the same length as the opening one; blocks without a
 * `# purpose:` first line are left as plain text.
 */
function parseMessageParts(text: string): MsgPart[] {
  const parts: MsgPart[] = []
  const re = /(`{3,})sh01-code:([A-Za-z0-9+-]+):([^\n`]+?)\n/g
  let pos = 0
  for (;;) {
    re.lastIndex = pos
    const m = re.exec(text)
    if (!m) break
    const close = text.indexOf(m[1], re.lastIndex)
    if (close === -1) break
    const body = text.slice(re.lastIndex, close)
    const nl = body.indexOf('\n')
    const first = nl === -1 ? body : body.slice(0, nl)
    const purposeMatch = /^# purpose:\s?([\s\S]*)$/.exec(first)
    if (purposeMatch === null) {
      pos = m.index + m[1].length
      continue
    }
    if (m.index > pos) parts.push({ kind: 'text', text: text.slice(pos, m.index) })
    parts.push({
      kind: 'code',
      block: {
        filename: m[3].trim(),
        language: m[2],
        purpose: purposeMatch[1],
        content: (nl === -1 ? '' : body.slice(nl + 1)).replace(/\n$/, '')
      }
    })
    pos = close + m[1].length
  }
  if (pos < text.length) parts.push({ kind: 'text', text: text.slice(pos) })
  return parts
}

function dayGroup(updatedAt: number): 'Today' | 'Yesterday' | 'Earlier' {
  const startOfDay = (t: number): number => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const diff = startOfDay(Date.now()) - startOfDay(updatedAt)
  if (diff <= 0) return 'Today'
  if (diff <= 86400000) return 'Yesterday'
  return 'Earlier'
}

function chatHint(c: ChatIndexEntry): string | null {
  const parts: string[] = []
  if (c.app) parts.push(c.app)
  if (c.planLength > 0) {
    parts.push(`step ${Math.min(c.currentStepIndex + 1, c.planLength)} of ${c.planLength}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function ChatSidebar({
  snap,
  busy,
  open,
  onClose
}: {
  snap: ChatSnapshot | null
  busy: boolean
  open: boolean
  onClose: () => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [delArm, setDelArm] = useState<string | null>(null)
  const delTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(delTimer.current), [])

  const commitRename = (): void => {
    if (renaming && renameValue.trim()) {
      window.api.chatRenameChat(renaming, renameValue.trim())
    }
    setRenaming(null)
  }

  /** Delete needs a second click within 3 seconds. */
  const askDelete = (id: string): void => {
    if (delArm !== id) {
      window.clearTimeout(delTimer.current)
      setDelArm(id)
      delTimer.current = window.setTimeout(() => setDelArm(null), 3000)
      return
    }
    window.clearTimeout(delTimer.current)
    setDelArm(null)
    window.api.chatDeleteChat(id)
  }

  let lastGroup: string | null = null
  return (
    <aside className={`chat-sidebar${open ? ' open' : ''}`} aria-label="Chat history">
      <button
        type="button"
        className="chat-new-btn"
        disabled={busy}
        onClick={() => {
          window.api.chatNewChat()
          onClose()
        }}
      >
        + New chat
      </button>
      <div className="chat-sidebar-list">
        {!snap?.workspaceName ? (
          <div className="chat-sidebar-empty">Choose a workspace to keep chat history</div>
        ) : (snap.chats.length === 0 ? (
          <div className="chat-sidebar-empty">No chats yet</div>
        ) : (
          snap.chats.map((c) => {
            const group = dayGroup(c.updatedAt)
            const header = group !== lastGroup ? group : null
            lastGroup = group
            const hint = chatHint(c)
            return (
              <div key={c.id}>
                {header && <div className="chat-group">{header}</div>}
                <div className={`chat-item${c.id === snap.currentChatId ? ' current' : ''}`}>
                  {renaming === c.id ? (
                    <input
                      className="chat-rename-input"
                      value={renameValue}
                      maxLength={80}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename()
                        else if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <button
                      type="button"
                      className="chat-item-main"
                      title={c.title}
                      disabled={busy}
                      onClick={() => {
                        window.api.chatSwitchChat(c.id)
                        onClose()
                      }}
                    >
                      <span className="chat-item-title">{c.title}</span>
                      {hint && <span className="chat-item-hint">{hint}</span>}
                    </button>
                  )}
                  {renaming !== c.id && (
                    <span className="chat-item-actions">
                      <button
                        type="button"
                        aria-label="Rename chat"
                        onClick={() => {
                          setRenaming(c.id)
                          setRenameValue(c.title)
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        aria-label="Delete chat"
                        className={delArm === c.id ? 'danger' : undefined}
                        disabled={busy}
                        onClick={() => askDelete(c.id)}
                      >
                        {delArm === c.id ? 'Sure?' : 'Delete'}
                      </button>
                    </span>
                  )}
                </div>
              </div>
            )
          })
        ))}
      </div>
    </aside>
  )
}

function ChatMessageBody({ text, canSave }: { text: string; canSave: boolean }) {
  const parts = parseMessageParts(text)
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.text}</span>
        ) : (
          <div key={i} className="chat-code">
            <div className="chat-code-head">
              <span className="chat-code-purpose">{p.block.purpose}</span>
              <span className="chat-code-file">{p.block.filename}</span>
            </div>
            <pre className="chat-code-body">{p.block.content}</pre>
            <div className="chat-code-btns">
              <button type="button" onClick={() => window.api.copyText(p.block.content)}>
                Copy
              </button>
              {canSave && (
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    window.api.chatSaveCode({
                      filename: p.block.filename,
                      content: p.block.content
                    })
                  }
                >
                  Save to project
                </button>
              )}
            </div>
          </div>
        )
      )}
    </>
  )
}

/**
 * Clarify card: one question sends on tap; several collect picks first and
 * send one multi-line message, so the advisor never spends a round per answer.
 */
function ClarifyCard({
  questions,
  picks,
  busy,
  withShot,
  onToggle
}: {
  questions: { text: string; options: string[] }[]
  picks: Record<string, string>
  busy: boolean
  withShot: boolean
  onToggle: (question: string, option: string) => void
}) {
  if (questions.length === 1) {
    const q = questions[0] as { text: string; options: string[] }
    return (
      <div className="chat-question">
        <div className="chat-question-text">{q.text}</div>
        <div className="chat-chips">
          {q.options.map((o, j) => (
            <button
              key={j}
              type="button"
              className="chat-chip"
              disabled={busy}
              onClick={() => window.api.chatSend(`${q.text}: ${o}`, withShot)}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    )
  }
  const answered = questions.filter((q) => picks[q.text]).length
  return (
    <>
      {questions.map((q, i) => (
        <div key={i} className="chat-question">
          <div className="chat-question-text">{q.text}</div>
          <div className="chat-chips">
            {q.options.map((o, j) => {
              const selected = picks[q.text] === o
              return (
                <button
                  key={j}
                  type="button"
                  className={`chat-chip${selected ? ' selected' : ''}`}
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => onToggle(q.text, o)}
                >
                  {o}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="chat-discovery-btns">
        <button
          type="button"
          className="primary"
          disabled={busy || answered < questions.length}
          onClick={() =>
            window.api.chatSend(
              questions.map((q) => `${q.text}: ${picks[q.text] ?? ''}`).join('\n'),
              withShot
            )
          }
        >
          Send answers ({answered}/{questions.length})
        </button>
      </div>
    </>
  )
}

function SkipButton({ busy, withShot }: { busy: boolean; withShot: boolean }) {
  return (
    <button
      type="button"
      className="chat-skip"
      disabled={busy}
      onClick={() =>
        window.api.chatSend(
          'Skip questions — make the plan now with sensible defaults.',
          withShot
        )
      }
    >
      Skip questions
    </button>
  )
}

function ShortcutRows({
  rows
}: {
  rows: readonly { keys: readonly string[]; description: string }[]
}) {
  return (
    <div className="chat-short-rows">
      {rows.map((r, i) => (
        <div className="chat-short-row" key={i}>
          <span className="chat-short-keys">
            {r.keys.map((k, j) => (
              <span className="key-cap" key={j}>
                {k}
              </span>
            ))}
          </span>
          <span className="chat-short-desc">{r.description}</span>
        </div>
      ))}
    </div>
  )
}

function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="chat-shortcuts"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <button
        type="button"
        className="chat-short-close"
        aria-label="Close shortcuts"
        onClick={onClose}
      >
        ✕
      </button>
      <ScoutIcon thinking={false} />
      <h2 className="chat-short-title">Welcome to SH-01</h2>
      <p className="chat-short-sub">Here are the shortcuts that help you work with SH-01.</p>
      <h3 className="chat-short-section">Anywhere on your Mac</h3>
      <ShortcutRows rows={GLOBAL_SHORTCUTS} />
      <h3 className="chat-short-section">In the chat</h3>
      <ShortcutRows rows={CHAT_KEYS} />
      <h3 className="chat-short-section">Useful commands</h3>
      <div className="chat-short-rows">
        <div className="chat-short-cmd-row">
          <span className="chat-short-cmd">Check the documentation for this app</span>
          <button
            type="button"
            className="chat-short-copy"
            onClick={() => window.api.copyText('Check the documentation for this app')}
          >
            Copy
          </button>
        </div>
        <div className="chat-short-desc">SH-01 looks up official docs before making a plan.</div>
      </div>
      <button type="button" className="chat-short-gotit" autoFocus onClick={onClose}>
        Got it
      </button>
    </div>
  )
}

export default function ChatApp() {
  const [snap, setSnap] = useState<ChatSnapshot | null>(null)
  const [value, setValue] = useState('')
  const [withShot, setWithShot] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [armed, setArmed] = useState<'clear' | 'all' | null>(null)
  const [wsOpen, setWsOpen] = useState(false)
  const [wsCreating, setWsCreating] = useState(false)
  const [wsName, setWsName] = useState('')
  const [wsDelArm, setWsDelArm] = useState<string | null>(null)
  const wsDelTimer = useRef<number | undefined>(undefined)
  /** "Improve with Muse": local-only, never the snapshot busy flag. */
  const [improving, setImproving] = useState(false)
  /** Pre-improve text for Undo, or null when no Undo is offered. */
  const [preImprove, setPreImprove] = useState<string | null>(null)
  const [improveError, setImproveError] = useState<string | null>(null)
  /** True while an improve result is still wanted (send() cancels it). */
  const improvingRef = useRef(false)
  const [sideOpen, setSideOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  /** Chip picks keyed by question text; sent together, never one by one. */
  const [picks, setPicks] = useState<Record<string, string>>({})
  /** "Describe it yourself" form inside the clarify card. */
  const [describing, setDescribing] = useState(false)
  const [description, setDescription] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stepsRef = useRef<HTMLOListElement>(null)
  const armTimer = useRef<number | undefined>(undefined)

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

  useEffect(() => {
    window.api.chatReady()
    const off = window.api.onChatSnapshot(setSnap)
    const offImproved = window.api.onChatImproved(handleImproved)
    try {
      if (window.localStorage.getItem(SHORTCUTS_SEEN_KEY) === null) {
        window.localStorage.setItem(SHORTCUTS_SEEN_KEY, '1')
        setShortcutsOpen(true)
      }
    } catch {
      // No persistent storage: never auto-open.
    }
    return () => {
      off()
      offImproved()
      window.clearTimeout(armTimer.current)
      window.clearTimeout(wsDelTimer.current)
    }
  }, [])

  const msgCount = snap?.messages.length ?? 0
  const busy = snap?.busy ?? false
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgCount, busy])

  /** Keep the current plan step visible inside the scrolling step list. */
  const stepIndex = snap?.currentStepIndex ?? 0
  const planLen = snap?.plan.length ?? 0
  useEffect(() => {
    const list = stepsRef.current
    const li = list?.children[stepIndex] as HTMLElement | undefined
    if (!list || !li) return
    if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop
    else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight
    }
  }, [stepIndex, planLen])

  const overLimit = value.length > MAX_CHAT_LEN
  const showCount = value.length > CHAT_COUNT_AT
  const canSend = value.trim().length > 0 && !overLimit && !busy
  const canShowMe = (snap?.hasPlan ?? false) && !busy
  const canBack = (snap?.hasPlan ?? false) && (snap?.currentStepIndex ?? 0) > 0 && !busy
  const canNext =
    (snap?.hasPlan ?? false) &&
    (snap?.currentStepIndex ?? 0) < (snap?.plan.length ?? 0) - 1 &&
    !busy
  const onLastStep =
    (snap?.hasPlan ?? false) &&
    (snap?.currentStepIndex ?? 0) >= (snap?.plan.length ?? 0) - 1
  const canContinue = onLastStep && !busy

  const send = (): boolean => {
    const text = value.trim()
    if (!text || busy || overLimit) return false
    // Free text sent with a clarify card open carries any picks along.
    const picked =
      snap?.discovery?.phase === 'clarify'
        ? snap.discovery.questions
            .filter((q) => picks[q.text])
            .map((q) => `${q.text}: ${picks[q.text]}`)
        : []
    window.api.chatSend(picked.length > 0 ? `${picked.join('\n')}\n${text}` : text, withShot)
    setValue('')
    // A send cancels any in-flight improve: its late result must not reappear.
    improvingRef.current = false
    setImproving(false)
    setPreImprove(null)
    setImproveError(null)
    return true
  }

  /** Manual edits retire any pending Undo from an improve. */
  const editValue = (text: string): void => {
    setValue(text)
    setPreImprove(null)
    setImproveError(null)
  }

  /** "Describe it yourself": the description leads, chip picks ride along as details. */
  const sendDescription = (): void => {
    if (snap?.discovery?.phase !== 'clarify') return
    const text = description.trim()
    if (!text || busy) return
    const picked = snap.discovery.questions
      .filter((q) => picks[q.text])
      .map((q) => `${q.text}: ${picks[q.text]}`)
    window.api.chatSend(
      `My own description: ${text}` + (picked.length > 0 ? `\n${picked.join('\n')}` : ''),
      withShot
    )
    setDescribing(false)
    setDescription('')
  }

  const improve = (): void => {
    const text = value.trim()
    if (!text || busy || improving) return
    setPreImprove(value)
    setImproveError(null)
    improvingRef.current = true
    setImproving(true)
    window.api.chatImprove(value)
  }

  /** Grow the input with its content up to MAX_INPUT_LINES, then scroll inside. */
  const fitInput = (): void => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    const lineH = parseFloat(cs.lineHeight) || 20
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const max = lineH * MAX_INPUT_LINES + pad
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    setOverflows(el.scrollHeight > max + 1)
  }

  useEffect(() => {
    fitInput()
  }, [value])

  // Picks belong to one exact question set in one chat; anything else clears them.
  const clarifyKey =
    (snap?.currentChatId ?? '') +
    '|' +
    (snap?.discovery?.phase === 'clarify'
      ? snap.discovery.questions.map((q) => q.text).join('\n')
      : (snap?.discovery?.phase ?? 'none'))
  useEffect(() => {
    setPicks({})
    setDescribing(false)
    setDescription('')
  }, [clarifyKey])

  const closeShortcuts = (): void => {
    setShortcutsOpen(false)
    inputRef.current?.focus()
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
    setWsDelArm(null)
    window.clearTimeout(wsDelTimer.current)
  }

  /** Workspace delete needs a second click within 3 seconds; the menu stays open. */
  const askWsDelete = (id: string): void => {
    if (wsDelArm !== id) {
      window.clearTimeout(wsDelTimer.current)
      setWsDelArm(id)
      wsDelTimer.current = window.setTimeout(() => setWsDelArm(null), 3000)
      return
    }
    window.clearTimeout(wsDelTimer.current)
    setWsDelArm(null)
    window.api.chatDeleteWorkspace(id)
  }

  const createWorkspace = (): void => {
    const name = wsName.trim()
    if (!name) return
    window.api.chatCreateWorkspace(name)
    closeWs()
  }

  return (
    <div className="chat-root">
      <ChatSidebar snap={snap} busy={busy} open={sideOpen} onClose={() => setSideOpen(false)} />
      {sideOpen && <div className="chat-sidebar-backdrop" onClick={() => setSideOpen(false)} />}
      {expanded && (
        <div className="chat-expand" role="dialog" aria-label="Expanded message editor">
          <textarea
            className="chat-expand-input"
            value={value}
            placeholder="Ask how to do something…"
            autoFocus
            disabled={improving}
            onChange={(e) => editValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setExpanded(false)
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                if (send()) setExpanded(false)
              }
            }}
          />
          <div className="chat-expand-btns">
            {showCount && (
              <span className={`chat-count${overLimit ? ' over' : ''}`}>
                {value.length} / {MAX_CHAT_LEN}
              </span>
            )}
            <button type="button" onClick={() => setExpanded(false)}>
              Done
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canSend}
              onClick={() => {
                if (send()) setExpanded(false)
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
      {shortcutsOpen && <ShortcutsPanel onClose={closeShortcuts} />}
      <div className="chat-main">
      <div className="chat-header">
        <button
          type="button"
          className="chat-menu-btn chat-side-btn"
          aria-label="Chat history"
          onClick={() => setSideOpen(!sideOpen)}
        >
          ☰
        </button>
        <div className="chat-title-row">
          <span className="chat-title-icon">
            <ScoutIcon thinking={busy} cell={2} />
          </span>
          <span className="chat-title">SH-01</span>
          {snap?.app && (
            <span className="chat-guiding" title={`Guiding: ${snap.app}`}>
              Guiding: {snap.app}
            </span>
          )}
        </div>
        <div className="chat-header-btns">
          <button
            type="button"
            className={`chat-menu-btn chat-hud-btn${snap?.hudOpen ? ' active' : ''}`}
            aria-label="Step remote (Cmd+Option+P)"
            title="Step remote (Cmd+Option+P)"
            onClick={() => window.api.hudToggle()}
          >
            <svg width="12" height="14" viewBox="0 0 12 14" shapeRendering="crispEdges" aria-hidden="true">
              <rect x="2" y="0" width="8" height="14" rx="2" fill="#FF7A3D" stroke="#111216" />
              <rect x="5" y="1" width="2" height="1" fill="#7CF3FF" />
              <rect x="4" y="4" width="4" height="1" fill="#111216" />
              <rect x="4" y="6" width="4" height="1" fill="#111216" />
              <rect x="4" y="9" width="1" height="1" fill="#FFD25A" />
              <rect x="6" y="9" width="1" height="1" fill="#111216" />
              <rect x="4" y="11" width="4" height="1" fill="#111216" />
            </svg>
          </button>
          <button
            type="button"
            className={`chat-menu-btn${shortcutsOpen ? ' active' : ''}`}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts"
            onClick={() => (shortcutsOpen ? closeShortcuts() : setShortcutsOpen(true))}
          >
            ?
          </button>
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
                onClick={() => window.api.chatToggleVerify()}
              >
                {snap?.verifySteps === false ? '☐ Check my steps' : '☑ Check my steps'}
              </button>
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
                  {(snap?.workspaces.length ?? 0) > 0 && (
                    <>
                      <div className="chat-ws-list">
                        {snap?.workspaces.map((w) => (
                          <div
                            key={w.id}
                            className={`chat-ws-item${w.current ? ' current' : ''}`}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="chat-ws-main"
                              title={w.available ? w.name : `${w.name} (folder missing)`}
                              disabled={busy || !w.available}
                              onClick={() => {
                                window.api.chatSwitchWorkspace(w.id)
                                closeWs()
                              }}
                            >
                              <span className="chat-ws-check">{w.current ? '✓' : ''}</span>
                              <span className="chat-ws-name">{w.name}</span>
                              {w.kind === 'godot' && (
                                <span className="chat-ws-badge">Godot</span>
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete workspace ${w.name}`}
                              className={`chat-ws-del${wsDelArm === w.id ? ' danger' : ''}`}
                              disabled={busy}
                              onClick={() => askWsDelete(w.id)}
                            >
                              {wsDelArm === w.id ? 'Sure?' : 'Delete'}
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="chat-menu-divider" />
                    </>
                  )}
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
                    <button
                      type="button"
                      className="primary"
                      disabled={!wsName.trim()}
                      onClick={createWorkspace}
                    >
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
            <span className="chat-empty-icon">
              <ScoutIcon thinking={busy} cell={4} />
            </span>
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
            <ChatMessageBody text={m.text} canSave={snap?.canSaveCode ?? false} />
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
        {snap?.discovery && (
          <div className="chat-discovery">
            {snap.discovery.phase === 'clarify' ? (
              <>
                <ClarifyCard
                  questions={snap.discovery.questions}
                  picks={picks}
                  busy={busy}
                  withShot={withShot}
                  onToggle={(question, option) =>
                    setPicks((prev) => {
                      const next = { ...prev }
                      if (next[question] === option) delete next[question]
                      else next[question] = option
                      return next
                    })
                  }
                />
                {describing && (
                  <div className="chat-describe">
                    <textarea
                      className="chat-describe-input"
                      rows={3}
                      value={description}
                      placeholder="Describe what you want to build…"
                      disabled={busy}
                      autoFocus
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <div className="chat-discovery-btns">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || !description.trim()}
                        onClick={sendDescription}
                      >
                        Send description
                      </button>
                      <button
                        type="button"
                        className="chat-skip chat-describe-cancel"
                        onClick={() => {
                          setDescribing(false)
                          setDescription('')
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <ul className="chat-brief">
                  {snap.discovery.brief.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
                <div className="chat-discovery-btns">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => window.api.chatSend('Yes, make the plan', withShot)}
                  >
                    Yes, make the plan
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => inputRef.current?.focus()}
                  >
                    Change something
                  </button>
                </div>
              </>
            )}
            {snap.discovery.phase === 'clarify' ? (
              <div className="chat-discovery-links">
                <SkipButton busy={busy} withShot={withShot} />
                {!describing && (
                  <button
                    type="button"
                    className="chat-skip"
                    disabled={busy}
                    onClick={() => setDescribing(true)}
                  >
                    Describe it yourself
                  </button>
                )}
              </div>
            ) : (
              <SkipButton busy={busy} withShot={withShot} />
            )}
          </div>
        )}
        {busy && (
          <div className="chat-msg assistant thinking">
            <span className="dots" aria-hidden="true" />
            thinking…
          </div>
        )}
      </div>
      {snap?.hasPlan && !snap?.discovery && (
        <div className="chat-plan">
          <ol className="chat-steps" ref={stepsRef}>
            {snap.plan.map((s, i) => (
              <li
                key={i}
                className={
                  i === snap.currentStepIndex ? 'current' : i < snap.currentStepIndex ? 'done' : ''
                }
              >
                {stripStepPrefix(s.instruction)}
                {s.caution && <div className="chat-caution">⚠ {s.caution}</div>}
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
            {onLastStep && (
              <button
                type="button"
                disabled={!canContinue}
                onClick={() => window.api.chatContinue()}
              >
                Continue
              </button>
            )}
          </div>
        </div>
      )}
      {(snap?.researching || (snap?.research && snap.research.urls.length > 0)) && (
        <div className="chat-research">
          {snap.researching ? (
            <div className="chat-msg assistant thinking">
              <span className="dots" aria-hidden="true" />
              Researching {snap.researching}…
            </div>
          ) : (
            snap.research && (
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
            )
          )}
        </div>
      )}
      <div className="chat-compose">
        <div className="chat-input-row">
          <div className="chat-input-wrap">
            <textarea
              ref={inputRef}
              className="chat-input"
              rows={1}
              value={value}
              placeholder="Ask how to do something…"
              disabled={busy || improving}
              onChange={(e) => editValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            {overflows && !busy && (
              <button
                type="button"
                className="chat-expand-btn"
                aria-label="Expand editor"
                title="Expand editor"
                onClick={() => setExpanded(true)}
              >
                ⤢
              </button>
            )}
          </div>
          <button
            type="button"
            className="chat-improve-btn"
            disabled={!value.trim() || busy || improving}
            onClick={improve}
          >
            {improving ? 'Improving…' : 'Improve with Muse'}
          </button>
          <button type="button" className="primary" disabled={!canSend} onClick={() => send()}>
            Send
          </button>
        </div>
        <div className="chat-compose-foot">
          <label className="chat-toggle">
            <input
              type="checkbox"
              checked={withShot}
              disabled={busy}
              onChange={(e) => setWithShot(e.target.checked)}
            />
            Look at my screen
          </label>
          {preImprove !== null && !improving && (
            <button
              type="button"
              className="chat-improve-undo"
              onClick={() => {
                setValue(preImprove)
                setPreImprove(null)
              }}
            >
              Undo
            </button>
          )}
          {improveError && <span className="chat-improve-error">{improveError}</span>}
          {showCount && (
            <span className={`chat-count${overLimit ? ' over' : ''}`}>
              {value.length} / {MAX_CHAT_LEN}
            </span>
          )}
        </div>
      </div>
      <div className="chat-footer">History is stored only on this Mac, encrypted.</div>
      </div>
    </div>
  )
}
