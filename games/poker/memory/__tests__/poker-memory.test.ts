import { describe, expect, it } from 'vitest'
import { PokerMemoryModule } from '../poker-memory'

describe('PokerMemoryModule', () => {
  it('gameType is poker', () => {
    expect(new PokerMemoryModule().gameType).toBe('poker')
  })

  it('buildMemoryContext renders all sections', () => {
    const module = new PokerMemoryModule()
    const context = module.buildMemoryContext({
      working: module.initWorking('match_1', 'agt_1'),
      allEpisodic: [],
      semanticByTarget: new Map(),
    })

    expect(context.workingSummary).toContain('Recent action log')
    expect(context.episodicSection).toContain('Opponent episodes')
    expect(context.semanticSection).toContain('Opponent profiles')
  })
})
