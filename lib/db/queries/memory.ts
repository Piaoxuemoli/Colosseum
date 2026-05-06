import { and, desc, eq } from 'drizzle-orm'
import { newId } from '@/lib/core/ids'
import type { GameType } from '@/lib/core/types'
import { db } from '@/lib/db/client'
import { episodicMemory, semanticMemory, workingMemory } from '@/lib/db/schema.sqlite'

export async function saveWorkingMemory(input: {
  observerAgentId: string
  matchId: string
  gameType: GameType
  stateJson: Record<string, unknown>
}): Promise<void> {
  const existing = await db
    .select()
    .from(workingMemory)
    .where(and(eq(workingMemory.observerAgentId, input.observerAgentId), eq(workingMemory.matchId, input.matchId)))
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(workingMemory)
      .set({ stateJson: input.stateJson, updatedAt: new Date() })
      .where(and(eq(workingMemory.observerAgentId, input.observerAgentId), eq(workingMemory.matchId, input.matchId)))
    return
  }

  await db.insert(workingMemory).values({
    observerAgentId: input.observerAgentId,
    matchId: input.matchId,
    gameType: input.gameType,
    stateJson: input.stateJson,
    updatedAt: new Date(),
  })
}

export async function loadWorkingMemory(
  observerAgentId: string,
  matchId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(workingMemory)
    .where(and(eq(workingMemory.observerAgentId, observerAgentId), eq(workingMemory.matchId, matchId)))
    .limit(1)

  return rows[0]?.stateJson ?? null
}

export async function deleteWorkingMemory(observerAgentId: string, matchId: string): Promise<void> {
  await db
    .delete(workingMemory)
    .where(and(eq(workingMemory.observerAgentId, observerAgentId), eq(workingMemory.matchId, matchId)))
}

export async function insertEpisodic(input: {
  observerAgentId: string
  targetAgentId: string | null
  matchId: string
  gameType: GameType
  entryJson: Record<string, unknown>
  tags?: string[]
}): Promise<void> {
  await db.insert(episodicMemory).values({
    id: newId(),
    observerAgentId: input.observerAgentId,
    targetAgentId: input.targetAgentId,
    matchId: input.matchId,
    gameType: input.gameType,
    entryJson: input.entryJson,
    tags: input.tags ?? null,
    createdAt: new Date(),
  })
}

export async function listEpisodic(input: {
  observerAgentId: string
  targetAgentId?: string | null
  gameType: GameType
  limit?: number
}): Promise<Array<{ entryJson: Record<string, unknown>; tags: string[] | null; createdAt: Date }>> {
  const conditions = [
    eq(episodicMemory.observerAgentId, input.observerAgentId),
    eq(episodicMemory.gameType, input.gameType),
  ]
  if (input.targetAgentId !== undefined && input.targetAgentId !== null) {
    conditions.push(eq(episodicMemory.targetAgentId, input.targetAgentId))
  }

  const rows = await db
    .select()
    .from(episodicMemory)
    .where(and(...conditions))
    .orderBy(desc(episodicMemory.createdAt))
    .limit(input.limit ?? 200)

  return rows.map((row) => ({
    entryJson: row.entryJson,
    tags: row.tags,
    createdAt: row.createdAt,
  }))
}

export async function upsertSemantic(input: {
  observerAgentId: string
  targetAgentId: string
  gameType: GameType
  profileJson: Record<string, unknown>
  gamesObserved: number
}): Promise<void> {
  const existing = await db
    .select()
    .from(semanticMemory)
    .where(
      and(
        eq(semanticMemory.observerAgentId, input.observerAgentId),
        eq(semanticMemory.targetAgentId, input.targetAgentId),
        eq(semanticMemory.gameType, input.gameType),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(semanticMemory)
      .set({
        profileJson: input.profileJson,
        gamesObserved: input.gamesObserved,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(semanticMemory.observerAgentId, input.observerAgentId),
          eq(semanticMemory.targetAgentId, input.targetAgentId),
          eq(semanticMemory.gameType, input.gameType),
        ),
      )
    return
  }

  await db.insert(semanticMemory).values({
    observerAgentId: input.observerAgentId,
    targetAgentId: input.targetAgentId,
    gameType: input.gameType,
    profileJson: input.profileJson,
    gamesObserved: input.gamesObserved,
    updatedAt: new Date(),
  })
}

export async function loadSemantic(input: {
  observerAgentId: string
  targetAgentId: string
  gameType: GameType
}): Promise<{ profileJson: Record<string, unknown>; gamesObserved: number } | null> {
  const rows = await db
    .select()
    .from(semanticMemory)
    .where(
      and(
        eq(semanticMemory.observerAgentId, input.observerAgentId),
        eq(semanticMemory.targetAgentId, input.targetAgentId),
        eq(semanticMemory.gameType, input.gameType),
      ),
    )
    .limit(1)

  if (!rows[0]) return null
  return {
    profileJson: rows[0].profileJson,
    gamesObserved: rows[0].gamesObserved,
  }
}

export async function loadAllSemanticForObserver(input: {
  observerAgentId: string
  gameType: GameType
}): Promise<Map<string, { profileJson: Record<string, unknown>; gamesObserved: number }>> {
  const rows = await db
    .select()
    .from(semanticMemory)
    .where(and(eq(semanticMemory.observerAgentId, input.observerAgentId), eq(semanticMemory.gameType, input.gameType)))
  const map = new Map<string, { profileJson: Record<string, unknown>; gamesObserved: number }>()

  for (const row of rows) {
    map.set(row.targetAgentId, {
      profileJson: row.profileJson,
      gamesObserved: row.gamesObserved,
    })
  }

  return map
}
