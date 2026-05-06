import { redis } from '@/lib/redis/client'
import { keys } from '@/lib/redis/keys'

const MATCH_KEY_TTL_SECONDS = 2 * 60 * 60

export async function putApiKey(matchId: string, profileId: string, apiKey: string): Promise<void> {
  await redis.hset(keys.matchKeyring(matchId), { [profileId]: apiKey })
  await redis.expire(keys.matchKeyring(matchId), MATCH_KEY_TTL_SECONDS)
}

export async function getApiKey(matchId: string, profileId: string): Promise<string | undefined> {
  const client = redis as typeof redis & { hget?: (key: string, field: string) => Promise<string | null> }
  if (typeof client.hget !== 'function') return undefined
  return (await client.hget(keys.matchKeyring(matchId), profileId)) ?? undefined
}

export async function dropMatchApiKeys(matchId: string): Promise<void> {
  await redis.del(keys.matchKeyring(matchId))
}
