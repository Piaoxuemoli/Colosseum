import { describe, expect, it } from 'vitest'
import { newId, newMatchId, newMatchToken, newTaskId, parsePrefix } from '@/lib/core/ids'

describe('lib/core/ids', () => {
  it('newId returns a uuid v4 string', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('newMatchId has the match prefix', () => {
    const id = newMatchId()
    expect(id.startsWith('match_')).toBe(true)
    expect(id.length).toBeGreaterThan('match_'.length + 8)
  })

  it('newTaskId composes matchId, hand number, and agentId', () => {
    expect(newTaskId({ matchId: 'match_abc', handNumber: 3, agentId: 'agt_xyz' })).toBe(
      'task_match_abc-3-agt_xyz',
    )
  })

  it('newMatchToken returns a long random hex token', () => {
    expect(newMatchToken()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('parsePrefix extracts prefix', () => {
    expect(parsePrefix('match_abc123')).toBe('match')
    expect(parsePrefix('no-prefix')).toBeNull()
  })
})
