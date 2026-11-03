import { app } from 'electron'
import dotenv from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Key and model overrides, loaded before anything reads process.env (this
 * module is imported first by every main-process caller). Precedence:
 * existing process env, then app/.env, then ~/.secrets/game-agent.env.
 * dotenv never overrides a variable that is already set, so load order
 * gives the earlier file higher precedence. Never log these values.
 */
function loadEnv(): void {
  let appDir = process.cwd()
  try {
    appDir = app.getAppPath()
  } catch {
    // Packaged oddity: fall back to the working directory.
  }
  dotenv.config({ path: join(appDir, '.env'), quiet: true })
  dotenv.config({ path: join(homedir(), '.secrets/game-agent.env'), quiet: true })
}

loadEnv()

/** Model quality settings per request kind. A proxy may later override these per kind. */
export type ModelRequestKind =
  | 'locate'
  | 'locate_retry'
  | 'advisor'
  | 'recover'
  | 'look'
  | 'research'
  | 'improve'

export interface QualitySetting {
  effort: 'minimal' | 'low' | 'medium'
  maxTokens: number
}

/**
 * Model for every direct call (advisor, locate, verify, recover, look,
 * research). Switchable via SH0_MODEL (shell or app/.env) for speed tests.
 */
export const MODEL = process.env['SH0_MODEL'] || 'muse-spark-1.3'

export const QUALITY: Record<ModelRequestKind, QualitySetting> = {
  locate: { effort: 'minimal', maxTokens: 2000 },
  locate_retry: { effort: 'low', maxTokens: 2000 },
  advisor: { effort: 'low', maxTokens: 16000 },
  recover: { effort: 'low', maxTokens: 2000 },
  look: { effort: 'low', maxTokens: 2000 },
  research: { effort: 'low', maxTokens: 2000 },
  improve: { effort: 'medium', maxTokens: 4000 }
}
