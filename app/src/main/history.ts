import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ChatMessage, PlanStep, Session } from './session'

export interface StoredSession {
  messages: ChatMessage[]
  goal: string | null
  plan: PlanStep[]
  currentStepIndex: number
  updatedAt: number
}

let currentProjectPath: string | null = null

export function getCurrentProject(): string | null {
  return currentProjectPath
}

export function setCurrentProject(projectPath: string | null): void {
  currentProjectPath = projectPath
}

export function projectName(projectPath: string): string {
  return basename(projectPath)
}

export function projectId(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex')
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

function historyFile(projectPath: string): string {
  return join(historyDir(), `${projectId(projectPath)}.json.enc`)
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.messages) || !Array.isArray(v.plan)) return false
  if (v.goal !== null && typeof v.goal !== 'string') return false
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

export function loadHistory(projectPath: string): StoredSession | null {
  try {
    const raw = readFileSync(historyFile(projectPath))
    const json = safeStorage.decryptString(raw)
    const parsed: unknown = JSON.parse(json)
    if (!isStoredSession(parsed)) return null
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
export function saveHistory(projectPath: string, session: Session): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  try {
    mkdirSync(historyDir(), { recursive: true })
    const data: StoredSession = {
      messages: session.messages.map((m) => ({ role: m.role, text: m.text })),
      goal: session.goal,
      plan: session.plan.map((s) => ({ instruction: s.instruction, target: s.target })),
      currentStepIndex: session.currentStepIndex,
      updatedAt: Date.now()
    }
    writeFileSync(historyFile(projectPath), safeStorage.encryptString(JSON.stringify(data)))
    return true
  } catch {
    return false
  }
}

export function clearHistory(projectPath: string): void {
  try {
    rmSync(historyFile(projectPath), { force: true })
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

const LAST_PROJECT_FILE = 'last-project.json'

export function loadLastProject(): string | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(app.getPath('userData'), LAST_PROJECT_FILE), 'utf8')
    )
    const path =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { path?: unknown }).path
        : undefined
    return typeof path === 'string' && path.length > 0 ? path : null
  } catch {
    return null
  }
}

export function saveLastProject(projectPath: string): void {
  try {
    writeFileSync(
      join(app.getPath('userData'), LAST_PROJECT_FILE),
      JSON.stringify({ path: projectPath })
    )
  } catch {
    // Remembering is a convenience; never break the flow.
  }
}
