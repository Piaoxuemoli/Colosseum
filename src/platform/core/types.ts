import { z } from 'zod'

export const visibilitySchema = z.enum(['public', 'role-restricted', 'private'])
export type Visibility = z.infer<typeof visibilitySchema>

export const gameTypeSchema = z.enum(['poker', 'werewolf'])
export type GameType = z.infer<typeof gameTypeSchema>

export const gameEventSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  gameType: gameTypeSchema,
  seq: z.number().int().nonnegative(),
  occurredAt: z.string(),
  kind: z.string(),
  actorAgentId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  visibility: visibilitySchema,
  restrictedTo: z.array(z.string()).nullable(),
})
export type GameEvent = z.infer<typeof gameEventSchema>

export const matchConfigSchema = z.object({
  // Reasoning models (MiniMax-M2.7, DeepSeek-R1, mimo-v2.5-pro …) can
  // easily take 30-90s to finish a hand's thinking + decision over a slow
  // API. 3-minute ceiling gives room without burying truly hung requests.
  agentTimeoutMs: z.number().int().nonnegative().default(180_000),
  minActionIntervalMs: z.number().int().nonnegative().default(1_000),
  tickConcurrencyLockMs: z.number().int().positive().default(180_000),
  maxConsecutiveErrors: z.number().int().positive().default(3),
})
export type MatchConfig = z.infer<typeof matchConfigSchema>

export function defaultMatchConfig(): MatchConfig {
  return matchConfigSchema.parse({})
}

export type MatchResult = {
  winnerFaction: string | null
  ranking: Array<{
    agentId: string
    rank: number
    score: number
    extra?: Record<string, unknown>
  }>
  stats?: Record<string, unknown>
}

export const agentKindSchema = z.enum(['player', 'moderator'])
export type AgentKind = z.infer<typeof agentKindSchema>

export const providerKindSchema = z.enum(['openai-compatible', 'anthropic', 'custom'])
export type ProviderKind = z.infer<typeof providerKindSchema>
