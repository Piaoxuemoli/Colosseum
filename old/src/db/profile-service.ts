import { db } from './database'
import type { APIProfile } from '../agent/llm-client'

/**
 * Get all API profiles.
 */
export async function getAllProfiles(): Promise<APIProfile[]> {
  return db.apiProfiles.toArray()
}

/**
 * Get a single profile by ID.
 */
export async function getProfileById(id: string): Promise<APIProfile | undefined> {
  return db.apiProfiles.get(id)
}

/**
 * Save (create or update) an API profile.
 */
export async function saveProfile(profile: APIProfile): Promise<void> {
  await db.apiProfiles.put(profile)
}

/**
 * Delete an API profile by ID.
 */
export async function deleteProfile(id: string): Promise<void> {
  await db.apiProfiles.delete(id)
}

/**
 * Clear all API profiles.
 */
export async function clearAllProfiles(): Promise<void> {
  await db.apiProfiles.clear()
}
