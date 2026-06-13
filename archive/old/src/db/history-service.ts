import { db } from './database'
import type { HandHistory } from '../types/history'

/**
 * Save a hand history record to IndexedDB.
 */
export async function saveHistory(history: HandHistory): Promise<void> {
  await db.handHistories.put(history)
}

/**
 * Get all hand histories, sorted by timestamp descending (newest first).
 */
export async function getAllHistories(): Promise<HandHistory[]> {
  return db.handHistories.orderBy('timestamp').reverse().toArray()
}

/**
 * Get hand histories for a specific session.
 */
export async function getHistoriesBySession(sessionId: string): Promise<HandHistory[]> {
  return db.handHistories.where('sessionId').equals(sessionId).reverse().sortBy('timestamp')
}

/**
 * Get a single hand history by its ID.
 */
export async function getHistoryById(id: string): Promise<HandHistory | undefined> {
  return db.handHistories.get(id)
}

/**
 * Delete a hand history by its ID.
 */
export async function deleteHistory(id: string): Promise<void> {
  await db.handHistories.delete(id)
}

/**
 * Clear all hand histories.
 */
export async function clearAllHistories(): Promise<void> {
  await db.handHistories.clear()
}

/**
 * Get total count of hand histories.
 */
export async function getHistoryCount(): Promise<number> {
  return db.handHistories.count()
}
