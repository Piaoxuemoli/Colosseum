import { db } from './database'
import type { StructuredImpression } from '../types/player'

/**
 * Save or update a structured impression for a specific observer+target pair.
 * Key: [observerProfileId + targetName]
 */
export async function saveStructuredImpression(
  observerProfileId: string,
  targetName: string,
  impression: StructuredImpression,
): Promise<void> {
  await db.structuredImpressions.put({ observerProfileId, targetName, impression })
}

/**
 * Get a single structured impression for an observer+target pair.
 */
export async function getStructuredImpression(
  observerProfileId: string,
  targetName: string,
): Promise<StructuredImpression | undefined> {
  const record = await db.structuredImpressions.get([observerProfileId, targetName])
  return record?.impression
}

/**
 * Get all structured impressions for a given observer profile.
 * Returns a map of targetName → StructuredImpression.
 */
export async function getProfileImpressions(
  observerProfileId: string,
): Promise<Record<string, StructuredImpression>> {
  const records = await db.structuredImpressions
    .where('observerProfileId')
    .equals(observerProfileId)
    .toArray()

  const result: Record<string, StructuredImpression> = {}
  for (const r of records) {
    result[r.targetName] = r.impression
  }
  return result
}

/**
 * Clear all structured impressions for a given observer profile.
 */
export async function clearProfileImpressions(
  observerProfileId: string,
): Promise<void> {
  await db.structuredImpressions
    .where('observerProfileId')
    .equals(observerProfileId)
    .delete()
}
