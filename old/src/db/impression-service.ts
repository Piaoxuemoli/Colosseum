import { db } from './database'
import type { ImpressionRecord } from './database'

/**
 * Save or update impressions for a player in a session.
 */
export async function saveImpressions(
  sessionId: string,
  playerId: string,
  impressions: Record<string, string>,
): Promise<void> {
  await db.impressions.put({ sessionId, playerId, impressions })
}

/**
 * Get impressions for a specific player in a session.
 */
export async function getImpressions(
  sessionId: string,
  playerId: string,
): Promise<Record<string, string> | undefined> {
  const record = await db.impressions.get([sessionId, playerId])
  return record?.impressions
}

/**
 * Get all impression records for a session (all LLM players).
 */
export async function getSessionImpressions(
  sessionId: string,
): Promise<ImpressionRecord[]> {
  return db.impressions.where('sessionId').equals(sessionId).toArray()
}

/**
 * Delete all impressions for a session.
 */
export async function clearSessionImpressions(sessionId: string): Promise<void> {
  await db.impressions.where('sessionId').equals(sessionId).delete()
}
