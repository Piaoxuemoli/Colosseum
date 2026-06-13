import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'
import type { GameEvent, GameType, Visibility } from '@/platform/core/types'
import { db } from '@/platform/db/client'
import { gameEvents } from '@/platform/db/schema.sqlite'

export async function appendEvent(event: GameEvent): Promise<void> {
  await db.insert(gameEvents).values({
    id: event.id,
    matchId: event.matchId,
    seq: event.seq,
    occurredAt: new Date(event.occurredAt),
    kind: event.kind,
    actorAgentId: event.actorAgentId,
    payload: event.payload,
    visibility: event.visibility,
    restrictedTo: event.restrictedTo,
  })
}

export async function appendEvents(events: GameEvent[]): Promise<void> {
  if (events.length === 0) return

  await db.insert(gameEvents).values(
    events.map((event) => ({
      id: event.id,
      matchId: event.matchId,
      seq: event.seq,
      occurredAt: new Date(event.occurredAt),
      kind: event.kind,
      actorAgentId: event.actorAgentId,
      payload: event.payload,
      visibility: event.visibility,
      restrictedTo: event.restrictedTo,
    })),
  )
}

export async function listMatchEvents(
  matchId: string,
  options?: { fromSeq?: number; toSeq?: number; visibility?: Visibility; limit?: number },
): Promise<GameEvent[]> {
  const conditions = [eq(gameEvents.matchId, matchId)]
  if (options?.fromSeq !== undefined) conditions.push(gte(gameEvents.seq, options.fromSeq))
  if (options?.toSeq !== undefined) conditions.push(lte(gameEvents.seq, options.toSeq))
  if (options?.visibility) conditions.push(eq(gameEvents.visibility, options.visibility))

  let query = db
    .select()
    .from(gameEvents)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))

  if (options?.limit !== undefined && options.limit > 0) {
    query = query.orderBy(desc(gameEvents.seq)).limit(options.limit) as unknown as typeof query
    const rows = await query
    return rows
      .reverse()
      .map((row) => ({
        id: row.id,
        matchId: row.matchId,
        gameType: inferGameTypeFromKind(row.kind),
        seq: row.seq,
        occurredAt: row.occurredAt.toISOString(),
        kind: row.kind,
        actorAgentId: row.actorAgentId,
        payload: row.payload,
        visibility: row.visibility as Visibility,
        restrictedTo: row.restrictedTo,
      }))
  }

  const rows = await query.orderBy(asc(gameEvents.seq))
  return rows.map((row) => ({
    id: row.id,
    matchId: row.matchId,
    gameType: inferGameTypeFromKind(row.kind),
    seq: row.seq,
    occurredAt: row.occurredAt.toISOString(),
    kind: row.kind,
    actorAgentId: row.actorAgentId,
    payload: row.payload,
    visibility: row.visibility as Visibility,
    restrictedTo: row.restrictedTo,
  }))
}

function inferGameTypeFromKind(kind: string): GameType {
  if (kind.startsWith('werewolf/')) return 'werewolf'
  return 'poker'
}

export async function nextSeq(matchId: string): Promise<number> {
  const rows = await db
    .select({ max: gameEvents.seq })
    .from(gameEvents)
    .where(eq(gameEvents.matchId, matchId))
  const max = rows[0]?.max ?? 0
  return max + 1
}
