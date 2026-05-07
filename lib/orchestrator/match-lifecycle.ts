import { newEventId, newMatchToken } from '@/lib/core/ids'
import { getGame } from '@/lib/core/registry'
import { defaultMatchConfig, type GameType, type MatchConfig } from '@/lib/core/types'
import { appendEvents, nextSeq } from '@/lib/db/queries/events'
import { deleteWorkingMemory } from '@/lib/db/queries/memory'
import {
  createMatch,
  finalizeMatchRow,
  findMatchById,
  listParticipants,
  updateMatchStatus,
} from '@/lib/db/queries/matches'
import { redis } from '@/lib/redis/client'
import { keys } from '@/lib/redis/keys'
import { log } from '@/lib/telemetry/logger'
import { validateMatchCreate } from './match-lifecycle-validation'

export type CreateMatchInput = {
  gameType: GameType
  agentIds: string[]
  moderatorAgentId?: string | null
  config?: Partial<MatchConfig>
  keyring?: Record<string, string>
  engineConfig?: Record<string, unknown>
}

export async function createAndStartMatch(input: CreateMatchInput): Promise<{ matchId: string; token: string }> {
  validateMatchCreate(input.gameType, {
    agentIds: input.agentIds,
    moderatorAgentId: input.moderatorAgentId ?? null,
  })

  const config: MatchConfig = { ...defaultMatchConfig(), ...(input.config ?? {}) }
  const { matchId } = await createMatch({
    gameType: input.gameType,
    config,
    participants: input.agentIds.map((agentId, seatIndex) => ({ agentId, seatIndex })),
  })

  const game = getGame(input.gameType)
  const defaultEngineConfig: Record<string, unknown> =
    input.gameType === 'werewolf'
      ? { moderatorAgentId: input.moderatorAgentId ?? null }
      : {
          smallBlind: 2,
          bigBlind: 4,
          startingChips: 200,
          maxBetsPerStreet: 4,
        }
  // Caller's engineConfig overrides defaults (normal semantics), but the
  // validated moderatorAgentId is pinned last so an untrusted engineConfig
  // cannot shadow it with a different value (e.g. a player id).
  const mergedEngineConfig = {
    ...defaultEngineConfig,
    ...(input.engineConfig ?? {}),
  }
  const engineConfig =
    input.gameType === 'werewolf'
      ? { ...mergedEngineConfig, moderatorAgentId: input.moderatorAgentId ?? null }
      : mergedEngineConfig
  const initialState = game.engine.createInitialState(engineConfig, input.agentIds)
  const token = newMatchToken()

  await redis.set(keys.matchState(matchId), JSON.stringify(initialState), 'EX', 24 * 60 * 60)
  await redis.set(keys.matchToken(matchId), token, 'EX', 24 * 60 * 60)
  if (input.keyring && Object.keys(input.keyring).length > 0) {
    await redis.hset(keys.matchKeyring(matchId), input.keyring)
    await redis.expire(keys.matchKeyring(matchId), 2 * 60 * 60)
  }

  await appendEvents([
    {
      id: newEventId(),
      matchId,
      gameType: input.gameType,
      seq: await nextSeq(matchId),
      occurredAt: new Date().toISOString(),
      kind: `${input.gameType}/match-start`,
      actorAgentId: null,
      payload: { participants: input.agentIds },
      visibility: 'public',
      restrictedTo: null,
    },
  ])
  await updateMatchStatus(matchId, 'running')
  log.info('match created', { matchId, gameType: input.gameType })

  return { matchId, token }
}

export async function finalizeMatch(matchId: string): Promise<void> {
  const match = await findMatchById(matchId)
  if (!match) return

  const stateRaw = await redis.get(keys.matchState(matchId))
  if (!stateRaw) {
    await updateMatchStatus(matchId, 'errored')
    return
  }

  const game = getGame(match.gameType as GameType)
  const result = game.engine.finalize(JSON.parse(stateRaw))

  await finalizeMatchRow({ matchId, winnerFaction: result.winnerFaction, result })
  await redis.del(keys.matchState(matchId))
  await redis.del(keys.matchKeyring(matchId))
  await redis.del(keys.matchToken(matchId))

  const participants = await listParticipants(matchId)
  for (const participant of participants) {
    await deleteWorkingMemory(participant.agentId, matchId)
  }

  log.info('match finalized', { matchId, winnerFaction: result.winnerFaction })
}
