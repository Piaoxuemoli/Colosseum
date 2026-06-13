import type { GameEvent } from '@/platform/core/types'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'

export type MatchSseEvent =
  | { kind: 'event'; event: GameEvent }
  | { kind: 'thinking-delta'; agentId: string; delta: string }
  | { kind: 'agent-action-ready'; agentId: string; actionType: string }
  | { kind: 'match-end'; winnerAgentId: string | null }

export async function publishSse(matchId: string, event: MatchSseEvent): Promise<void> {
  await redis.publish(keys.matchChannel(matchId), JSON.stringify(event))
}
