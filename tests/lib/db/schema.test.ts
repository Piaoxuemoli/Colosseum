import { describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema.sqlite'

describe('lib/db/schema.sqlite', () => {
  it('exports all 9 tables', () => {
    const expected = [
      'apiProfiles',
      'agents',
      'matches',
      'matchParticipants',
      'gameEvents',
      'agentErrors',
      'workingMemory',
      'episodicMemory',
      'semanticMemory',
    ] as const

    for (const tableName of expected) {
      expect(schema).toHaveProperty(tableName)
      expect(schema[tableName]).toBeDefined()
    }
  })
})
