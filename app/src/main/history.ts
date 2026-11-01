import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ChatMessage, PlanStep, Session } from './session'

export type WorkspaceRef = { kind: 'godot'; path: string } | { kind: 'named'; name: string }

export interface StoredSession {
  messages: ChatMessage[]
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
  app: string | null
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

export function loadHistory(ref: WorkspaceRef): StoredSession | null {
  try {
    const raw = readFileSync(historyFile(ref))
    const json = safeStorage.decryptString(raw)
    const parsed: unknown = JSON.parse(json)
    if (!isStoredSession(parsed)) return null
    if (parsed.app === undefined) parsed.app = null
    if (parsed.plan.length > 0) {
      parsed.currentStepIndex = Math.min(parsed.currentStepIndex, parsed.plan.length - 1)
    } else {
      parsed.currentStepIndex = 0
    }
    return parsed
  } catch {
    return null
  }
}

/** Persist text-only session state. False when encryption is unavailable. */
export function saveHistory(ref: WorkspaceRef, session: Session): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  try {
    mkdirSync(historyDir(), { recursive: true })
    const data: StoredSession = {
      messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
      goal: session.goal,
      plan: session.plan.map((s) => ({ instruction: s.instruction, target: s.target })),
      currentStepIndex: session.currentStepIndex,
      app: session.app,
      updatedAt: Date.now()
    }
    writeFileSync(historyFile(ref), safeStorage.encryptString(JSON.stringify(data)))
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
