/**
 * 斗地主引擎测试 — 验证 EngineProtocol 实现。
 */
import { describe, it, expect } from 'vitest'
import { DoudizhuEngine } from '../engine/doudizhu-engine'
import { detectCombo, compareCombo } from '../engine/combo-detector'
import { createDdzDeck, ddzRankValue } from '../engine/ddz-types'
import type { DdzCard, DdzConfig, DdzAction } from '../engine/ddz-types'
import type { EngineProtocol } from '../../../core/protocols'
import type { DdzGameState } from '../engine/ddz-types'

const testConfig: DdzConfig = {
  playerNames: ['张三', '李四', '王五'],
  baseScore: 1,
  sessionId: 'test-ddz',
}

/** 快速跳过叫地主阶段: 第一个玩家叫3分 */
function skipBidding(engine: DoudizhuEngine, state: DdzGameState): DdzGameState {
  const current = state.players[state.currentPlayerIndex]
  const result = engine.applyAction(state, { type: 'bid', playerId: current.id, bidScore: 3 })
  if (!result.ok) throw new Error('Failed to skip bidding: ' + result.error)
  return result.state
}

describe('DoudizhuEngine - Bidding Phase', () => {
  const engine = new DoudizhuEngine()

  it('should start in bidding phase', () => {
    const state = engine.createGame(testConfig)
    expect(state.phase).toBe('bidding')
    expect(state.bidHistory).toEqual([])
    expect(state.highestBid).toBe(0)
    expect(state.highestBidder).toBe(-1)
    // All undecided
    state.players.forEach(p => expect(p.role).toBe('undecided'))
  })

  it('should handle bid action', () => {
    const state = engine.createGame(testConfig)
    const current = state.players[state.currentPlayerIndex]
    const result = engine.applyAction(state, { type: 'bid', playerId: current.id, bidScore: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.bidHistory).toHaveLength(1)
      expect(result.state.highestBid).toBe(1)
      expect(result.state.highestBidder).toBe(state.currentPlayerIndex)
    }
  })

  it('should reject bid lower than current highest', () => {
    const state = engine.createGame(testConfig)
    const p0 = state.players[state.currentPlayerIndex]
    const r1 = engine.applyAction(state, { type: 'bid', playerId: p0.id, bidScore: 2 })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const p1 = r1.state.players[r1.state.currentPlayerIndex]
    const r2 = engine.applyAction(r1.state, { type: 'bid', playerId: p1.id, bidScore: 1 })
    expect(r2.ok).toBe(false)
  })

  it('should finalize when someone bids 3', () => {
    const state = engine.createGame(testConfig)
    const current = state.players[state.currentPlayerIndex]
    const result = engine.applyAction(state, { type: 'bid', playerId: current.id, bidScore: 3 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.phase).toBe('playing')
      expect(result.state.baseScore).toBe(3)
      const landlord = result.state.players.find(p => p.role === 'landlord')
      expect(landlord).toBeDefined()
      expect(landlord!.hand).toHaveLength(20)
    }
  })

  it('should finalize after all 3 players bid', () => {
    const state = engine.createGame(testConfig)
    const p0 = state.players[state.currentPlayerIndex]
    const r1 = engine.applyAction(state, { type: 'bid', playerId: p0.id, bidScore: 1 })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return

    const p1 = r1.state.players[r1.state.currentPlayerIndex]
    const r2 = engine.applyAction(r1.state, { type: 'bid', playerId: p1.id, bidScore: 0 })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return

    const p2 = r2.state.players[r2.state.currentPlayerIndex]
    const r3 = engine.applyAction(r2.state, { type: 'bid', playerId: p2.id, bidScore: 0 })
    expect(r3.ok).toBe(true)
    if (r3.ok) {
      // First bidder (p0) wins with 1 point
      expect(r3.state.phase).toBe('playing')
      expect(r3.state.baseScore).toBe(1)
    }
  })

  it('should rebid when all 3 pass', () => {
    const state = engine.createGame(testConfig)
    let s = state
    for (let i = 0; i < 3; i++) {
      const p = s.players[s.currentPlayerIndex]
      const r = engine.applyAction(s, { type: 'bid', playerId: p.id, bidScore: 0 })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      s = r.state
    }
    // Should restart in bidding phase
    expect(s.phase).toBe('bidding')
    expect(s.bidHistory).toEqual([])
  })

  it('should return bid actions during bidding', () => {
    const state = engine.createGame(testConfig)
    const current = state.players[state.currentPlayerIndex]
    const actions = engine.getAvailableActions(state, current.id)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.every(a => a.type === 'bid')).toBe(true)
  })
})

describe('DoudizhuEngine - EngineProtocol', () => {
  const engine = new DoudizhuEngine()

  it('should implement EngineProtocol interface', () => {
    const proto: EngineProtocol<DdzGameState, DdzAction, DdzConfig> = engine
    expect(proto.meta.gameType).toBe('doudizhu')
  })

  it('should expose correct meta', () => {
    expect(engine.meta.displayName).toBe('斗地主')
    expect(engine.meta.minPlayers).toBe(3)
    expect(engine.meta.maxPlayers).toBe(3)
  })

  it('should create game with 3 players', () => {
    const state = engine.createGame(testConfig)
    expect(state.players).toHaveLength(3)
  })

  it('should deal cards correctly (17+17+17+3=54)', () => {
    const state = engine.createGame(testConfig)
    const totalCards = state.players.reduce((s, p) => s + p.hand.length, 0) + state.kittyCards.length
    expect(totalCards).toBe(54)
  })

  it('should have exactly one landlord with 20 cards after bidding', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const landlord = state.players.find(p => p.role === 'landlord')
    expect(landlord).toBeDefined()
    expect(landlord!.hand).toHaveLength(20)
    const peasants = state.players.filter(p => p.role === 'peasant')
    expect(peasants).toHaveLength(2)
    peasants.forEach(p => expect(p.hand).toHaveLength(17))
  })

  it('should start with landlord as current player after bidding', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const landlordIdx = state.players.findIndex(p => p.role === 'landlord')
    expect(state.currentPlayerIndex).toBe(landlordIdx)
  })

  it('should serialize and deserialize', () => {
    const state = engine.createGame(testConfig)
    const json = engine.serialize(state)
    const restored = engine.deserialize(json)
    expect(restored.phase).toBe(state.phase)
    expect(restored.players).toHaveLength(3)
  })

  it('should return available actions for current player', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const currentId = state.players[state.currentPlayerIndex].id
    const actions = engine.getAvailableActions(state, currentId)
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.some(a => a.type === 'play')).toBe(true)
  })

  it('should return empty actions for non-current player', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const nonCurrentIdx = (state.currentPlayerIndex + 1) % 3
    const nonCurrentId = state.players[nonCurrentIdx].id
    const actions = engine.getAvailableActions(state, nonCurrentId)
    expect(actions).toHaveLength(0)
  })

  it('should apply a valid single card play', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const current = state.players[state.currentPlayerIndex]
    const card = current.hand[0] // 最小的牌

    const result = engine.applyAction(state, {
      type: 'play',
      playerId: current.id,
      cards: [card],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players[state.currentPlayerIndex].hand.length).toBe(current.hand.length - 1)
      expect(result.state.lastPlay?.type).toBe('single')
      expect(result.state.currentPlayerIndex).toBe((state.currentPlayerIndex + 1) % 3)
    }
  })

  it('should reject play from wrong player', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const wrongIdx = (state.currentPlayerIndex + 1) % 3
    const wrong = state.players[wrongIdx]

    const result = engine.applyAction(state, {
      type: 'play',
      playerId: wrong.id,
      cards: [wrong.hand[0]],
    })
    expect(result.ok).toBe(false)
  })

  it('should reject pass when starting new round', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const current = state.players[state.currentPlayerIndex]
    const result = engine.applyAction(state, { type: 'pass', playerId: current.id })
    expect(result.ok).toBe(false)
  })

  it('should allow pass when not starting round', () => {
    const state = skipBidding(engine, engine.createGame(testConfig))
    const current = state.players[state.currentPlayerIndex]
    // First play a card
    const playResult = engine.applyAction(state, {
      type: 'play',
      playerId: current.id,
      cards: [current.hand[0]],
    })
    expect(playResult.ok).toBe(true)
    if (!playResult.ok) return

    // Next player can pass
    const nextState = playResult.state
    const nextPlayer = nextState.players[nextState.currentPlayerIndex]
    const passResult = engine.applyAction(nextState, { type: 'pass', playerId: nextPlayer.id })
    expect(passResult.ok).toBe(true)
  })
})

describe('Combo Detector', () => {
  const c = (rank: string, suit: string = 'hearts'): DdzCard =>
    ({ rank, suit } as DdzCard)

  it('should detect single', () => {
    expect(detectCombo([c('3')])).toEqual({ type: 'single', cards: [c('3')], mainRank: 0 })
  })

  it('should detect pair', () => {
    const combo = detectCombo([c('5', 'hearts'), c('5', 'spades')])
    expect(combo?.type).toBe('pair')
  })

  it('should detect triple', () => {
    const combo = detectCombo([c('K', 'hearts'), c('K', 'spades'), c('K', 'clubs')])
    expect(combo?.type).toBe('triple')
  })

  it('should detect triple_one', () => {
    const combo = detectCombo([c('K', 'hearts'), c('K', 'spades'), c('K', 'clubs'), c('3')])
    expect(combo?.type).toBe('triple_one')
  })

  it('should detect triple_pair', () => {
    const combo = detectCombo([c('K', 'hearts'), c('K', 'spades'), c('K', 'clubs'), c('3', 'hearts'), c('3', 'spades')])
    expect(combo?.type).toBe('triple_pair')
  })

  it('should detect bomb', () => {
    const combo = detectCombo([c('7', 'hearts'), c('7', 'spades'), c('7', 'clubs'), c('7', 'diamonds')])
    expect(combo?.type).toBe('bomb')
  })

  it('should detect rocket', () => {
    const combo = detectCombo([
      { suit: 'joker', rank: 'JOKER_S' } as DdzCard,
      { suit: 'joker', rank: 'JOKER_B' } as DdzCard,
    ])
    expect(combo?.type).toBe('rocket')
  })

  it('should detect straight (5+)', () => {
    const combo = detectCombo([c('3'), c('4', 'spades'), c('5'), c('6'), c('7')])
    expect(combo?.type).toBe('straight')
  })

  it('should reject straight with 2', () => {
    const combo = detectCombo([c('10'), c('J'), c('Q'), c('K'), c('A'), c('2')])
    expect(combo).toBeNull()
  })

  it('should reject invalid combo', () => {
    expect(detectCombo([c('3'), c('5')])).toBeNull()
  })
})

describe('Combo Comparison', () => {
  const c = (rank: string, suit: string = 'hearts'): DdzCard =>
    ({ rank, suit } as DdzCard)

  it('rocket beats everything', () => {
    const rocket = detectCombo([{ suit: 'joker', rank: 'JOKER_S' } as DdzCard, { suit: 'joker', rank: 'JOKER_B' } as DdzCard])!
    const bomb = detectCombo([c('A', 'hearts'), c('A', 'spades'), c('A', 'clubs'), c('A', 'diamonds')])!
    expect(compareCombo(rocket, bomb)).toBeGreaterThan(0)
  })

  it('bomb beats non-bomb', () => {
    const bomb = detectCombo([c('3', 'hearts'), c('3', 'spades'), c('3', 'clubs'), c('3', 'diamonds')])!
    const triple = detectCombo([c('A', 'hearts'), c('A', 'spades'), c('A', 'clubs'), c('K')])!
    expect(compareCombo(bomb, triple)).toBeGreaterThan(0)
  })

  it('higher single beats lower', () => {
    const a = detectCombo([c('A')])!
    const b = detectCombo([c('K')])!
    expect(compareCombo(a, b)).toBeGreaterThan(0)
  })

  it('different types (non-bomb) cannot compare', () => {
    const single = detectCombo([c('A')])!
    const pair = detectCombo([c('3', 'hearts'), c('3', 'spades')])!
    expect(compareCombo(single, pair)).toBe(0)
  })
})

describe('Deck', () => {
  it('should create 54-card deck', () => {
    const deck = createDdzDeck()
    expect(deck).toHaveLength(54)
    // Check jokers exist
    expect(deck.filter(c => c.rank === 'JOKER_S')).toHaveLength(1)
    expect(deck.filter(c => c.rank === 'JOKER_B')).toHaveLength(1)
  })

  it('should have correct rank values', () => {
    expect(ddzRankValue('3')).toBe(0)
    expect(ddzRankValue('2')).toBe(12)
    expect(ddzRankValue('JOKER_S')).toBe(13)
    expect(ddzRankValue('JOKER_B')).toBe(14)
  })
})
