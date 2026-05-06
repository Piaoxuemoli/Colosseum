import { describe, expect, it } from 'vitest'
import { initWorking, updateWorking } from '../working'

describe('poker working memory', () => {
  it('init returns empty log', () => {
    const working = initWorking()
    expect(working.matchActionsLog).toEqual([])
    expect(working.currentHandNumber).toBe(1)
  })

  it('updateWorking appends event', () => {
    const updated = updateWorking(initWorking(), {
      id: 'evt_1',
      matchId: 'match_1',
      gameType: 'poker',
      seq: 1,
      occurredAt: new Date().toISOString(),
      kind: 'poker/action',
      actorAgentId: 'a',
      payload: { type: 'fold' },
      visibility: 'public',
      restrictedTo: null,
    })

    expect(updated.matchActionsLog.length).toBe(1)
    expect(updated.matchActionsLog[0].actorAgentId).toBe('a')
  })
})
