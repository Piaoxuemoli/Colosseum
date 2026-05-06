import { and, asc, eq, gte, lte } from 'drizzle-orm'
import type { GameEvent, Visibility } from '@/lib/core/types'
import { db } from '@/lib/db/client'
import { gameEvents } from '@/lib/db/schema.sqlite'

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
  options?: { fromSeq?: number; toSeq?: number; visibility?: Visibility },
): Promise<GameEvent[]> {
  const conditions = [eq(gameEvents.matchId, matchId)]
  if (options?.fromSeq !== undefined) conditions.push(gte(gameEvents.seq, options.fromSeq))
  if (options?.toSeq !== undefined) conditions.push(lte(gameEvents.seq, options.toSeq))
  if (options?.visibility) conditions.push(eq(gameEvents.visibility, options.visibility))

  const rows = await db
    .select()
    .from(gameEvents)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
    .orderBy(asc(gameEvents.seq))

  return rows.map((row) => ({
    id: row.id,
    matchId: row.matchId,
    gameType: 'poker',
    seq: row.seq,
    occurredAt: row.occurredAt.toISOString(),
    kind: row.kind,
    actorAgentId: row.actorAgentId,
    payload: row.payload,
    visibility: row.visibility as Visibility,
    restrictedTo: row.restrictedTo,
  }))
}

export async function nextSeq(matchId: string): Promise<number> {
  const rows = await db.select({ seq: gameEvents.seq }).from(gameEvents).where(eq(gameEvents.matchId, matchId))
  if (rows.length === 0) return 1
  return Math.max(...rows.map((row) => row.seq)) + 1
}
