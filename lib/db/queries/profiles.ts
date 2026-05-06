import { eq } from 'drizzle-orm'
import { newProfileId } from '@/lib/core/ids'
import { db } from '@/lib/db/client'
import { apiProfiles } from '@/lib/db/schema.sqlite'

export type ApiProfileRow = typeof apiProfiles.$inferSelect

export type NewApiProfileInput = {
  displayName: string
  providerId: string
  baseUrl: string
  model: string
  temperature?: number
  maxTokens?: number | null
  contextWindowTokens?: number | null
}

export async function createProfile(input: NewApiProfileInput): Promise<ApiProfileRow> {
  const row = {
    id: newProfileId(),
    displayName: input.displayName,
    providerId: input.providerId,
    baseUrl: input.baseUrl,
    model: input.model,
    temperature: input.temperature ?? 70,
    maxTokens: input.maxTokens ?? null,
    contextWindowTokens: input.contextWindowTokens ?? null,
    createdAt: new Date(),
  }

  await db.insert(apiProfiles).values(row)
  return row
}

export async function findProfileById(id: string): Promise<ApiProfileRow | undefined> {
  const rows = await db.select().from(apiProfiles).where(eq(apiProfiles.id, id)).limit(1)
  return rows[0]
}

export async function listProfiles(): Promise<ApiProfileRow[]> {
  return db.select().from(apiProfiles)
}
