/**
 * POST /api/matches/:id/end — 本手结束后终止（spec §7）。
 *
 * v2 语义：requestStopAfterCurrentHand（德扑在当前手结束后结算；
 * 狼人杀返回原 state，对局照常自然终局）。引擎产生的 stop-requested
 * 事件按 v2 信封落库并广播；不合成 GM 自有事件。
 */

import { getGameV2 } from '@/platform/core/registry'
import type { GameEvent, GameType } from '@/platform/core/types'
import { v2RestrictedTo, v2Visibility } from '@/platform/engine/contracts-v2'
import { appendEvents } from '@/platform/db/queries/events'
import { findMatchById } from '@/platform/db/queries/matches'
import { ensureGamesRegistered } from '@/platform/instrument'
import { newEventId } from '@/platform/core/ids'
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
  const gameType = match.gameType as GameType
  const plugin = getGameV2(gameType)

  const stateRaw = await redis.get(keys.matchState(matchId))
  if (!stateRaw) {
    return Response.json({ error: 'match state missing' }, { status: 409 })
  }

  const stop = plugin.requestStopAfterCurrentHand(JSON.parse(stateRaw))
  if (stop.events.length > 0) {
    const occurredAt = new Date().toISOString()
    const events: GameEvent[] = stop.events.map((event) => ({
      id: newEventId(),
      matchId,
      gameType,
      seq: event.seq,
      occurredAt,
      kind: `${gameType}:v2:${event.kind}`,
      actorAgentId: event.actorAgentId,
      payload: { ...event.raw },
      visibility: v2Visibility(event.audience),
      restrictedTo: v2RestrictedTo(event.audience),
    }))
    await appendEvents(events)
    for (const event of events) {
      await publishSse(matchId, { kind: 'event', event })
    }
  }
  if (stop.state !== undefined) {
    await redis.set(keys.matchState(matchId), JSON.stringify(stop.state), 'EX', 24 * 60 * 60)
  }
  await redis.set(keys.matchStopRequested(matchId), '1', 'EX', 24 * 60 * 60)

  return Response.json({ ok: true, stopRequested: true })
}
