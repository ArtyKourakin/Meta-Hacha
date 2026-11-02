/** Model quality settings per request kind. A proxy may later override these per kind. */
export type ModelRequestKind =
  | 'locate'
  | 'locate_retry'
  | 'advisor'
  | 'recover'
  | 'look'
  | 'research'

export interface QualitySetting {
  effort: 'minimal' | 'low' | 'medium'
  maxTokens: number
}

/**
 * Model for every direct call (advisor, locate, verify, recover, look,
 * research). Switchable via SH0_MODEL for speed tests.
 */
export const MODEL = process.env['SH0_MODEL'] || 'muse-spark-1.3-contributor'

export const QUALITY: Record<ModelRequestKind, QualitySetting> = {
  locate: { effort: 'minimal', maxTokens: 2000 },
  locate_retry: { effort: 'low', maxTokens: 2000 },
  advisor: { effort: 'low', maxTokens: 4000 },
  recover: { effort: 'low', maxTokens: 2000 },
  look: { effort: 'low', maxTokens: 2000 },
  research: { effort: 'low', maxTokens: 2000 }
}
