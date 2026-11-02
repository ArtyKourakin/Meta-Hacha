import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ChatMessage, PlanStep, ResearchNotes, Session } from './session'
import type { Rect } from '../shared/api'

export type WorkspaceRef = { kind: 'godot'; path: string } | { kind: 'named'; name: string }

export interface StoredSession {
  messages: ChatMessage[]
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
  app: string | null
  research: ResearchNotes | null
  updatedAt: number
}

let currentWorkspace: WorkspaceRef | null = null

export function getCurrentWorkspace(): WorkspaceRef | null {
  return currentWorkspace
}

export function setCurrentWorkspace(ref: WorkspaceRef | null): void {
  currentWorkspace = ref
}

export function workspaceName(ref: WorkspaceRef): string {
  return ref.kind === 'godot' ? basename(ref.path) : ref.name
}

/**
 * Storage key. Godot folders hash the raw path (unchanged, so existing
 * histories keep working); named workspaces are keyed by name.
 */
export function workspaceKey(ref: WorkspaceRef): string {
  const raw = ref.kind === 'godot' ? ref.path : `name:${ref.name}`
  return createHash('sha256').update(raw).digest('hex')
}

export function isGodotProject(dir: string): boolean {
  try {
    return statSync(join(dir, 'project.godot')).isFile()
  } catch {
    return false
  }
}

function historyDir(): string {
  return join(app.getPath('userData'), 'history')
}

function historyFile(ref: WorkspaceRef): string {
  return join(historyDir(), `${workspaceKey(ref)}.json.enc`)
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.messages) || !Array.isArray(v.plan)) return false
  if (v.goal !== null && typeof v.goal !== 'string') return false
  if (v.app !== null && v.app !== undefined && typeof v.app !== 'string') return false
  if (v.research !== null && v.research !== undefined) {
    if (typeof v.research !== 'object') return false
    const r = v.research as Record<string, unknown>
    if (typeof r.app !== 'string' || typeof r.summary !== 'string') return false
    if (!Array.isArray(r.urls) || !(r.urls as unknown[]).every((u) => typeof u === 'string')) {
      return false
    }
    if (typeof r.updatedAt !== 'number') return false
  }
  if (!Number.isInteger(v.currentStepIndex) || (v.currentStepIndex as number) < 0) return false
  if (typeof v.updatedAt !== 'number') return false
  for (const m of v.messages as unknown[]) {
    if (typeof m !== 'object' || m === null) return false
    const { role, text } = m as { role: unknown; text: unknown }
    if (role !== 'user' && role !== 'assistant') return false
    if (typeof text !== 'string') return false
  }
  for (const s of v.plan as unknown[]) {
    if (typeof s !== 'object' || s === null) return false
    const { instruction, target } = s as { instruction: unknown; target: unknown }
    if (typeof instruction !== 'string' || typeof target !== 'string') return false
  }
  return true
}

export async function loadHistory(ref: WorkspaceRef): Promise<StoredSession | null> {
  let raw: Buffer
  try {
    raw = readFileSync(historyFile(ref))
  } catch {
    return null
  }
  let json: string
  let usedSyncFallback = false
  try {
    json = (await safeStorage.decryptStringAsync(raw)).result
  } catch {
    // Old file the async API cannot read: one sync decrypt, then re-save async.
    try {
      json = safeStorage.decryptString(raw)
      usedSyncFallback = true
    } catch {
      return null
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isStoredSession(parsed)) return null
  if (parsed.app === undefined) parsed.app = null
  if (parsed.research === undefined) parsed.research = null
  if (parsed.plan.length > 0) {
    parsed.currentStepIndex = Math.min(parsed.currentStepIndex, parsed.plan.length - 1)
  } else {
    parsed.currentStepIndex = 0
  }
  if (usedSyncFallback) await saveHistory(ref, parsed)
  return parsed
}

/** Persist text-only session state. False when encryption is unavailable. */
export async function saveHistory(ref: WorkspaceRef, session: Session): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  try {
    mkdirSync(historyDir(), { recursive: true })
    const data: StoredSession = {
      messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
      goal: session.goal,
      plan: session.plan.map((s) => ({ instruction: s.instruction, target: s.target })),
      currentStepIndex: session.currentStepIndex,
      app: session.app,
      research: session.research
        ? {
            app: session.research.app,
            summary: session.research.summary,
            urls: [...session.research.urls],
            updatedAt: session.research.updatedAt
          }
        : null,
      updatedAt: Date.now()
    }
    writeFileSync(historyFile(ref), await safeStorage.encryptStringAsync(JSON.stringify(data)))
    return true
  } catch {
    return false
  }
}

export function clearHistory(ref: WorkspaceRef): void {
  try {
    rmSync(historyFile(ref), { force: true })
  } catch {
    // Missing file or lock: nothing to clear.
  }
}

export function deleteAllHistory(): void {
  try {
    rmSync(historyDir(), { recursive: true, force: true })
    mkdirSync(historyDir(), { recursive: true })
  } catch {
    // Best effort; a locked file keeps its history until next time.
  }
}

const LAST_WORKSPACE_FILE = 'last-workspace.json'
const LEGACY_LAST_PROJECT_FILE = 'last-project.json'

function asWorkspaceRef(value: unknown): WorkspaceRef | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { kind?: unknown; path?: unknown; name?: unknown }
  if (v.kind === 'godot' && typeof v.path === 'string' && v.path.length > 0) {
    return { kind: 'godot', path: v.path }
  }
  if (v.kind === 'named' && typeof v.name === 'string' && v.name.length > 0) {
    return { kind: 'named', name: v.name }
  }
  return null
}

function readJsonFile(name: string): unknown {
  return JSON.parse(readFileSync(join(app.getPath('userData'), name), 'utf8'))
}

export function loadLastWorkspace(): WorkspaceRef | null {
  try {
    const ref = asWorkspaceRef(readJsonFile(LAST_WORKSPACE_FILE))
    if (ref) return ref
  } catch {
    // Fall through to the legacy file.
  }
  try {
    const legacy: unknown = readJsonFile(LEGACY_LAST_PROJECT_FILE)
    const path =
      typeof legacy === 'object' && legacy !== null
        ? (legacy as { path?: unknown }).path
        : undefined
    if (typeof path === 'string' && path.length > 0) return { kind: 'godot', path }
  } catch {
    // No remembered workspace.
  }
  return null
}

export function saveLastWorkspace(ref: WorkspaceRef): void {
  try {
    writeFileSync(join(app.getPath('userData'), LAST_WORKSPACE_FILE), JSON.stringify(ref))
  } catch {
    // Remembering is a convenience; never break the flow.
  }
}

const CHAT_BOUNDS_FILE = 'chat-bounds.json'

function asBounds(value: unknown): Rect | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  if (
    !Number.isFinite(v.x) ||
    !Number.isFinite(v.y) ||
    !Number.isFinite(v.width) ||
    !Number.isFinite(v.height) ||
    (v.width as number) <= 0 ||
    (v.height as number) <= 0
  ) {
    return null
  }
  return { x: v.x as number, y: v.y as number, width: v.width as number, height: v.height as number }
}

/** Last floating chat window bounds (expanded state only, never the tab). */
export function loadChatBounds(): Rect | null {
  try {
    return asBounds(readJsonFile(CHAT_BOUNDS_FILE))
  } catch {
    return null
  }
}

export function saveChatBounds(bounds: Rect): void {
  try {
    writeFileSync(join(app.getPath('userData'), CHAT_BOUNDS_FILE), JSON.stringify(bounds))
  } catch {
    // Remembering is a convenience; never break the flow.
  }
}
