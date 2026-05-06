import { and, eq } from 'drizzle-orm'
import { newAgentId } from '@/lib/core/ids'
import type { AgentKind, GameType } from '@/lib/core/types'
import { db } from '@/lib/db/client'
import { agents } from '@/lib/db/schema.sqlite'

export type AgentRow = typeof agents.$inferSelect

export type NewAgentInput = {
  displayName: string
  gameType: GameType
  kind?: AgentKind
  profileId: string
  systemPrompt: string
  avatarEmoji?: string | null
}

export async function createAgent(input: NewAgentInput): Promise<AgentRow> {
  const row = {
    id: newAgentId(),
    displayName: input.displayName,
    gameType: input.gameType,
    kind: input.kind ?? 'player',
    profileId: input.profileId,
    systemPrompt: input.systemPrompt,
    avatarEmoji: input.avatarEmoji ?? null,
    createdAt: new Date(),
  }

  await db.insert(agents).values(row)
  return row
}

export async function findAgentById(id: string): Promise<AgentRow | undefined> {
  const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1)
  return rows[0]
}

export async function listAgents(filter?: {
  gameType?: GameType
  kind?: AgentKind
}): Promise<AgentRow[]> {
  const conditions = []
  if (filter?.gameType) conditions.push(eq(agents.gameType, filter.gameType))
  if (filter?.kind) conditions.push(eq(agents.kind, filter.kind))

  if (conditions.length === 0) return db.select().from(agents)

  return db
    .select()
    .from(agents)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions))
}
