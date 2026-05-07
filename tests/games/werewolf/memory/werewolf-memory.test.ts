import { describe, expect, it } from 'vitest'
import { WerewolfMemoryModule } from '@/games/werewolf/memory/werewolf-memory'
import type { WerewolfState } from '@/games/werewolf/engine/types'
import { makeBaseState } from '../engine/_helpers'

describe('WerewolfMemoryModule', () => {
  const mod = new WerewolfMemoryModule()

  it('gameType is werewolf', () => {
    expect(mod.gameType).toBe('werewolf')
  })

  it('round-trip serialize/deserialize working memory', () => {
    const w = mod.initWorking('m1', 'v1')
    const raw = mod.serialize.working(w)
    const back = mod.deserialize.working(raw)
    expect(back).toEqual(w)
  })

  it('buildMemoryContext concatenates formatted sections', () => {
    const w = {
      ...mod.initWorking('m1', 'v1'),
      beliefState: {
        w1: { werewolf: 0.8, villager: 0.1, seer: 0.05, witch: 0.05, reasoning: [], lastUpdatedAt: { day: 1, phase: 'day/speak' } },
      },
    }
    const ctx = mod.buildMemoryContext({
      working: w,
      allEpisodic: [],
      semanticByTarget: new Map(),
    })
    expect(ctx.workingSummary).toContain('w1')
    expect(ctx.workingSummary).toContain('0.80')
  })

  it('buildSemanticUpdates fans out one update per non-observer target', () => {
    const finalState: WerewolfState = { ...makeBaseState(), matchComplete: true, winner: 'villagers' }
    const working = mod.initWorking('m1', 'v1')
    const episodic = mod.synthesizeEpisodic({
      working,
      finalState,
      observerAgentId: 'v1',
      targetAgentId: null,
      matchId: 'm1',
    })!
    const updates = mod.buildSemanticUpdates(new Map(), episodic)
    // observer v1 excluded -> 5 other agents
    expect(updates.size).toBe(5)
    expect(updates.has('v1')).toBe(false)
    expect(updates.has('w1')).toBe(true)
  })
})
