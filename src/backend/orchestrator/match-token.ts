import { isAgentParticipant } from '@/platform/db/queries/matches'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'

export type MatchTokenContext = {
  matchId: string
  token: string
}

export async function validateMatchToken(
  matchId: string | null,
  token: string | null,
  agentId: string,
): Promise<MatchTokenContext | null> {
  if (!matchId || !token) return null

  const stored = await redis.get(keys.matchToken(matchId))
  if (stored !== token) return null

  const isParticipant = await isAgentParticipant(matchId, agentId)
  if (!isParticipant) return null

  return { matchId, token }
}
