import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ChatMessage, PlanStep, ResearchNotes, Session } from './session'
import type { ChatIndexEntry, Rect } from '../shared/api'

export type WorkspaceRef = { kind: 'godot'; path: string } | { kind: 'named'; name: string }

export interface StoredSession {
  messages: ChatMessage[]
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
  app: string | null
  research: ResearchNotes | null
  verifySteps: boolean
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

/** Per-workspace store: index.json.enc + chats/<id>.json.enc. */
function workspaceDir(ref: WorkspaceRef): string {
  return join(historyDir(), workspaceKey(ref))
}

/** Pre-multi-chat single file; migrated into the first chat, then deleted. */
function legacyHistoryFile(ref: WorkspaceRef): string {
  return join(historyDir(), `${workspaceKey(ref)}.json.enc`)
}

function chatIndexFile(ref: WorkspaceRef): string {
  return join(workspaceDir(ref), 'index.json.enc')
}

/**
 * Chat file path, or null when the id is not a safe bare name.
 * Ids from the renderer must always pass through here before touching disk.
 */
function chatFile(ref: WorkspaceRef, id: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  return join(workspaceDir(ref), 'chats', `${id}.json.enc`)
}

export function newChatId(): string {
  return randomUUID()
}

export function workspaceStoreExists(ref: WorkspaceRef): boolean {
  try {
    return statSync(workspaceDir(ref)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Serialized history writes, one FIFO queue per workspace key. Every mutator
 * runs inside the queue, so a save captured before a switch lands before the
 * switch's own writes and can never overwrite newer data.
 */
const writeQueues = new Map<string, Promise<unknown>>()

function enqueueWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const tail = writeQueues.get(key) ?? Promise.resolve()
  const run = tail.then(task)
  // The chain itself never rejects: a failed task must not stall later writes.
  const settled = run.then(
    () => undefined,
    () => undefined
  )
  writeQueues.set(key, settled)
  void settled.then(() => {
    if (writeQueues.get(key) === settled) writeQueues.delete(key)
  })
  return run
}

/** Let queued writes land before reading, for read-after-write consistency. */
function drainQueue(key: string): Promise<unknown> {
  return writeQueues.get(key) ?? Promise.resolve()
}

/** Crash-safe write: temp file in the same folder, then rename over target. */
async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, data)
  await rename(tmp, path)
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.messages) || !Array.isArray(v.plan)) return false
  if (v.goal !== null && typeof v.goal !== 'string') return false
  if (v.app !== null && v.app !== undefined && typeof v.app !== 'string') return false
  if (v.verifySteps !== undefined && typeof v.verifySteps !== 'boolean') return false
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
    const { instruction, target, action, text, dropTarget, keys, caution } = s as {
      instruction: unknown
      target: unknown
      action: unknown
      text: unknown
      dropTarget: unknown
      keys: unknown
      caution: unknown
    }
    if (typeof instruction !== 'string') return false
    if (target !== null && target !== undefined && typeof target !== 'string') return false
    if (action !== undefined && typeof action !== 'string') return false
    if (text !== undefined && typeof text !== 'string') return false
    if (dropTarget !== undefined && typeof dropTarget !== 'string') return false
    if (keys !== undefined && !Array.isArray(keys)) return false
    if (caution !== undefined && caution !== null && typeof caution !== 'string') return false
  }
  return true
}

/** Null when the file is missing or fails to decrypt. */
async function decryptFile(path: string): Promise<string | null> {
  let raw: Buffer
  try {
    raw = readFileSync(path)
  } catch {
    return null
  }
  try {
    return (await safeStorage.decryptStringAsync(raw)).result
  } catch {
    return null
  }
}

/** Fill newer fields with their defaults and clamp the step index. */
function normalizeStored(parsed: StoredSession): StoredSession {
  if (parsed.app === undefined) parsed.app = null
  if (parsed.research === undefined) parsed.research = null
  if (parsed.verifySteps === undefined) parsed.verifySteps = true
  if (parsed.plan.length > 0) {
    parsed.currentStepIndex = Math.min(parsed.currentStepIndex, parsed.plan.length - 1)
  } else {
    parsed.currentStepIndex = 0
  }
  return parsed
}

function parseStored(json: string): StoredSession | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isStoredSession(parsed)) return null
  return normalizeStored(parsed)
}

export async function loadChat(ref: WorkspaceRef, id: string): Promise<StoredSession | null> {
  const path = chatFile(ref, id)
  if (!path) return null
  await drainQueue(workspaceKey(ref))
  const json = await decryptFile(path)
  return json ? parseStored(json) : null
}

function isChatIndex(value: unknown): value is ChatIndexEntry[] {
  if (!Array.isArray(value)) return false
  return (value as unknown[]).every((e) => {
    if (typeof e !== 'object' || e === null) return false
    const v = e as Record<string, unknown>
    return (
      typeof v.id === 'string' &&
      typeof v.title === 'string' &&
      typeof v.customTitle === 'boolean' &&
      typeof v.createdAt === 'number' &&
      typeof v.updatedAt === 'number' &&
      (v.app === null || typeof v.app === 'string') &&
      (v.goal === null || typeof v.goal === 'string') &&
      Number.isInteger(v.currentStepIndex) &&
      Number.isInteger(v.planLength)
    )
  })
}

export async function loadChatIndex(ref: WorkspaceRef): Promise<ChatIndexEntry[]> {
  await drainQueue(workspaceKey(ref))
  const json = await decryptFile(chatIndexFile(ref))
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return isChatIndex(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Deep-copy the live session into storable form. Pure and synchronous: call
 * it at the trigger moment so a later switch cannot mutate what gets saved.
 */
export function toStoredSession(session: Session): StoredSession {
  return {
    messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
    goal: session.goal,
    plan: session.plan.map((s) => ({
      instruction: s.instruction,
      target: s.target,
      action: s.action,
      text: s.text,
      dropTarget: s.dropTarget,
      keys: s.keys ? [...s.keys] : undefined,
      caution: s.caution
    })),
    currentStepIndex: session.currentStepIndex,
    app: session.app,
    verifySteps: session.verifySteps,
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
}

/** Sidebar title without a model call: goal, else first user message (40 chars). */
export function deriveTitle(goal: string | null, messages: ChatMessage[]): string {
  if (goal && goal.trim().length > 0) return goal.trim()
  const first = messages.find((m) => m.role === 'user')
  const text = first ? first.text.trim() : ''
  return text.length > 0 ? text.slice(0, 40) : 'New chat'
}

/**
 * Persist one chat file plus the full index in a single queued task.
 * False when the id is unsafe or encryption is unavailable.
 */
export function persistChat(
  ref: WorkspaceRef,
  id: string,
  stored: StoredSession,
  entries: ChatIndexEntry[]
): Promise<boolean> {
  const path = chatFile(ref, id)
  if (!path) return Promise.resolve(false)
  const dir = workspaceDir(ref)
  const indexPath = chatIndexFile(ref)
  return enqueueWrite(workspaceKey(ref), async () => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
    try {
      mkdirSync(join(dir, 'chats'), { recursive: true })
      await writeFileAtomic(path, await safeStorage.encryptStringAsync(JSON.stringify(stored)))
      await writeFileAtomic(indexPath, await safeStorage.encryptStringAsync(JSON.stringify(entries)))
      return true
    } catch {
      return false
    }
  })
}

/** Rewrite the index alone (rename). False when encryption is unavailable. */
export function persistChatIndex(ref: WorkspaceRef, entries: ChatIndexEntry[]): Promise<boolean> {
  const dir = workspaceDir(ref)
  const indexPath = chatIndexFile(ref)
  return enqueueWrite(workspaceKey(ref), async () => {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
    try {
      mkdirSync(dir, { recursive: true })
      await writeFileAtomic(indexPath, await safeStorage.encryptStringAsync(JSON.stringify(entries)))
      return true
    } catch {
      return false
    }
  })
}

/** Remove one chat file and rewrite the index, in queue order. */
export function deleteChat(ref: WorkspaceRef, id: string, entries: ChatIndexEntry[]): Promise<void> {
  const path = chatFile(ref, id)
  const dir = workspaceDir(ref)
  const indexPath = chatIndexFile(ref)
  return enqueueWrite(workspaceKey(ref), async () => {
    try {
      if (path) rmSync(path, { force: true })
    } catch {
      // Missing file or lock: the index entry is gone either way.
    }
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return
    try {
      mkdirSync(dir, { recursive: true })
      await writeFileAtomic(indexPath, await safeStorage.encryptStringAsync(JSON.stringify(entries)))
    } catch {
      // Best effort; the entry is already gone from memory.
    }
  })
}

/** Legacy single file, with the one-shot sync-decrypt fallback for old data. */
async function loadLegacyFile(path: string): Promise<StoredSession | null> {
  let raw: Buffer
  try {
    raw = readFileSync(path)
  } catch {
    return null
  }
  let json: string
  try {
    json = (await safeStorage.decryptStringAsync(raw)).result
  } catch {
    try {
      json = safeStorage.decryptString(raw)
    } catch {
      return null
    }
  }
  return parseStored(json)
}

/**
 * Move the legacy single-file history into the first chat. Returns the new
 * index plus the migrated chat id, or null when there is nothing to migrate.
 * The legacy file is deleted only after both new files are safely written.
 */
export function migrateLegacyHistory(
  ref: WorkspaceRef
): Promise<{ entries: ChatIndexEntry[]; firstId: string } | null> {
  const legacy = legacyHistoryFile(ref)
  let isFile = false
  try {
    isFile = statSync(legacy).isFile()
  } catch {
    return Promise.resolve(null)
  }
  if (!isFile) return Promise.resolve(null)
  if (workspaceStoreExists(ref)) {
    // A previous migration wrote the store but failed to delete the legacy
    // file; the store wins and the stale file goes now.
    try {
      rmSync(legacy, { force: true })
    } catch {
      // Try again next launch.
    }
    return Promise.resolve(null)
  }
  return enqueueWrite(workspaceKey(ref), async () => {
    const stored = await loadLegacyFile(legacy)
    if (!stored) return null
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null
    const id = newChatId()
    const dir = workspaceDir(ref)
    const path = join(dir, 'chats', `${id}.json.enc`)
    const entries: ChatIndexEntry[] = [
      {
        id,
        title: deriveTitle(stored.goal, stored.messages),
        customTitle: false,
        createdAt: stored.updatedAt,
        updatedAt: stored.updatedAt,
        app: stored.app,
        goal: stored.goal,
        currentStepIndex: stored.currentStepIndex,
        planLength: stored.plan.length
      }
    ]
    try {
      mkdirSync(join(dir, 'chats'), { recursive: true })
      await writeFileAtomic(path, await safeStorage.encryptStringAsync(JSON.stringify(stored)))
      await writeFileAtomic(
        chatIndexFile(ref),
        await safeStorage.encryptStringAsync(JSON.stringify(entries))
      )
    } catch {
      return null
    }
    try {
      rmSync(legacy, { force: true })
    } catch {
      // Migrated anyway; the stale file is cleaned up next launch.
    }
    return { entries, firstId: id }
  })
}

/** Delete every chat of one workspace (store dir plus any legacy file). Queued, so no save can land after it. */
export function clearHistory(ref: WorkspaceRef): Promise<void> {
  const dir = workspaceDir(ref)
  const legacy = legacyHistoryFile(ref)
  return enqueueWrite(workspaceKey(ref), async () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Missing dir or lock: nothing to clear.
    }
    try {
      rmSync(legacy, { force: true })
    } catch {
      // Nothing to clear.
    }
  })
}

export async function deleteAllHistory(): Promise<void> {
  // Drain every queue first so no in-flight save recreates files after us.
  const tails = [...writeQueues.values()]
  if (tails.length > 0) await Promise.allSettled(tails)
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
