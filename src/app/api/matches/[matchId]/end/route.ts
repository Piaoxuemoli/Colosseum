import { newEventId } from '@/platform/core/ids'
import { getGame } from '@/platform/core/registry'
import type { GameEvent, GameType } from '@/platform/core/types'
import { appendEvents, nextSeq } from '@/platform/db/queries/events'
import { findMatchById } from '@/platform/db/queries/matches'
import { ensureGamesRegistered } from '@/platform/instrument'
import { redis } from '@/platform/redis/client'
import { keys } from '@/platform/redis/keys'
import { publishSse } from '@/backend/orchestrator/sse-broadcast'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const match = await findMatchById(matchId)
  if (!match) return Response.json({ error: 'not found' }, { status: 404 })
  if (match.status !== 'running') {
    return Response.json({ error: 'match is not running' }, { status: 409 })
  }

  await ensureGamesRegistered()
  const game = getGame(match.gameType as GameType)
  if (!game.requestStopAfterHand || !game.publicStateEvent) {
    return Response.json({ error: 'finish-after-hand is not supported' }, { status: 400 })
  }

  const stateRaw = await redis.get(keys.matchState(matchId))
  if (!stateRaw) {
    return Response.json({ error: 'match state missing' }, { status: 409 })
  }

  const nextState = game.requestStopAfterHand(JSON.parse(stateRaw))
  await redis.set(keys.matchStopRequested(matchId), '1', 'EX', 24 * 60 * 60)
  await redis.set(keys.matchState(matchId), JSON.stringify(nextState), 'EX', 24 * 60 * 60)

  let seq = await nextSeq(matchId)
  const events: GameEvent[] = [
    {
      id: newEventId(),
      matchId,
      gameType: match.gameType as GameType,
      seq: seq++,
      occurredAt: new Date().toISOString(),
      kind: 'poker/stop-requested',
      actorAgentId: null,
      payload: { stopRequested: true },
      visibility: 'public',
      restrictedTo: null,
    },
    {
      ...game.publicStateEvent(nextState),
      id: newEventId(),
      matchId,
      seq,
    },
  ]

  await appendEvents(events)
  for (const event of events) {
    await publishSse(matchId, { kind: 'event', event })
  }

  return Response.json({ ok: true, stopRequested: true })
}
