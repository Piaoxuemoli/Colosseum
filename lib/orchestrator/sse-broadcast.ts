import type { GameEvent } from '@/lib/core/types'
import { redis } from '@/lib/redis/client'
import { keys } from '@/lib/redis/keys'

export type MatchSseEvent =
  | { kind: 'event'; event: GameEvent }
  | { kind: 'thinking-delta'; agentId: string; delta: string }
  | { kind: 'agent-action-ready'; agentId: string; actionType: string }
  | { kind: 'match-end'; winnerAgentId: string | null }

export async function publishSse(matchId: string, event: MatchSseEvent): Promise<void> {
  await redis.publish(keys.matchChannel(matchId), JSON.stringify(event))
}
