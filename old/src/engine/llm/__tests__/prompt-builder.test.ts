import { describe, it, expect } from 'vitest'
import { buildSystemMessage, buildDecisionRequest, buildHandSummary } from '../../../games/poker/agent/poker-context'
import type { Player, StructuredImpression } from '../../../types/player'
import type { GameState } from '../../../types/game'
import type { Card } from '../../../types/card'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'player-1',
    name: 'TestBot',
    type: 'llm',
    chips: 1000,
    status: 'active',
    holeCards: [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'spades' },
    ] as Card[],
    currentBet: 0,
    totalBetThisRound: 0,
    seatIndex: 0,
    hasActed: false,
    systemPrompt: '激进的职业玩家',
    ...overrides,
  }
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'test-game',
    phase: 'flop',
    communityCards: [
      { rank: 'T', suit: 'hearts' },
      { rank: 'J', suit: 'spades' },
      { rank: '2', suit: 'diamonds' },
    ] as Card[],
    pot: 240,
    sidePots: [],
    players: [
      makePlayer({ id: 'player-0', name: 'Hero', type: 'human', seatIndex: 0 }),
      makePlayer({ id: 'player-1', name: 'TestBot', seatIndex: 1 }),
      makePlayer({ id: 'player-2', name: 'OtherBot', type: 'bot', seatIndex: 2 }),
    ],
    dealerIndex: 0,
    currentPlayerIndex: 1,
    smallBlind: 5,
    bigBlind: 10,
    minRaise: 10,
    deck: [],
    actionHistory: [
      { playerId: 'player-0', type: 'postSmallBlind', amount: 5, timestamp: 1, phase: 'preflop' },
      { playerId: 'player-1', type: 'postBigBlind', amount: 10, timestamp: 2, phase: 'preflop' },
      { playerId: 'player-2', type: 'call', amount: 10, timestamp: 3, phase: 'flop' },
    ],
    handNumber: 5,
    sessionId: 'test-session',
    timingConfig: { minActionInterval: 1500, thinkingTimeout: 30000 },
    ...overrides,
  }
}

describe('buildSystemMessage', () => {
  it('includes player name and role description', () => {
    const player = makePlayer()
    const state = makeGameState()
    const others = state.players.filter(p => p.id !== player.id)

    const msg = buildSystemMessage(player, state, undefined, others)
    expect(msg).toContain('TestBot')
    expect(msg).toContain('激进的职业玩家')
  })

  it('includes impressions when provided', () => {
    const player = makePlayer()
    const state = makeGameState()
    const others = state.players.filter(p => p.id !== player.id)
    const heroImpression: StructuredImpression = {
      looseness: 3, aggression: 4, stickiness: 5, honesty: 7, note: '稳健型玩家', handCount: 5,
    }
    const otherImpression: StructuredImpression = {
      looseness: 8, aggression: 9, stickiness: 6, honesty: 2, note: '常诈唬', handCount: 3,
    }
    const impressions = new Map<string, StructuredImpression>([
      ['player-0', heroImpression],
      ['player-2', otherImpression],
    ])

    const msg = buildSystemMessage(player, state, impressions, others)
    expect(msg).toContain('稳健型玩家')
    expect(msg).toContain('常诈唬')
  })

  it('includes game rules', () => {
    const player = makePlayer()
    const state = makeGameState()
    const msg = buildSystemMessage(player, state, undefined, [])
    expect(msg).toContain('6人桌有限注德州扑克')
  })

  it('includes actual blind amounts from gameState', () => {
    const player = makePlayer()
    const state = makeGameState({ smallBlind: 5, bigBlind: 10 })
    const msg = buildSystemMessage(player, state, undefined, [])
    expect(msg).toContain('$5/$10')
    expect(msg).toContain('$2.5')  // smallBlind / 2
    expect(msg).not.toContain('${')  // no template literal bugs
  })

  it('uses action name output format', () => {
    const player = makePlayer()
    const state = makeGameState()
    const msg = buildSystemMessage(player, state, undefined, [])
    expect(msg).toContain('<action>操作名</action>')
  })
})

describe('buildDecisionRequest', () => {
  it('includes hole cards', () => {
    const player = makePlayer()
    const state = makeGameState()
    const validActions = [
      { type: 'fold' as const },
      { type: 'call' as const, minAmount: 10, maxAmount: 10 },
    ]

    const msg = buildDecisionRequest(player, state, validActions)
    expect(msg).toContain('Ah')
    expect(msg).toContain('Ks')
  })

  it('includes pot and community cards', () => {
    const player = makePlayer()
    const state = makeGameState()
    const msg = buildDecisionRequest(player, state, [])
    expect(msg).toContain('$240')
    expect(msg).toContain('Th')
  })

  it('includes valid actions with tool descriptions', () => {
    const player = makePlayer()
    const state = makeGameState()
    const validActions = [
      { type: 'fold' as const },
      { type: 'raise' as const, minAmount: 200, maxAmount: 1000 },
    ]

    const msg = buildDecisionRequest(player, state, validActions)
    expect(msg).toContain('fold — 弃牌，放弃本手')
    expect(msg).toContain('raise — 加注到 $200（固定金额）')
  })

  it('includes thinking/action format instructions with plain action name', () => {
    const player = makePlayer()
    const state = makeGameState()
    const msg = buildDecisionRequest(player, state, [])
    expect(msg).toContain('<action>')
    expect(msg).toContain('<action>call</action>')
  })

  it('formats call action with description', () => {
    const player = makePlayer()
    const state = makeGameState()
    const validActions = [
      { type: 'fold' as const },
      { type: 'call' as const, minAmount: 10, maxAmount: 10 },
    ]

    const msg = buildDecisionRequest(player, state, validActions)
    expect(msg).toContain('call — 跟注 $10')
  })

  it('action history uses per-action phase headers', () => {
    const player = makePlayer()
    const state = makeGameState()
    const msg = buildDecisionRequest(player, state, [])
    // actionHistory has preflop and flop actions — should show both headers
    expect(msg).toContain('[Preflop]')
    expect(msg).toContain('[Flop]')
  })
})

describe('buildHandSummary', () => {
  it('summarizes player actions', () => {
    const state = makeGameState()
    const summary = buildHandSummary(state)
    expect(summary).toContain('Hero')
    expect(summary).toContain('TestBot')
    expect(summary).toContain('小盲注')
  })
})

describe('prompt state consistency (end-to-end)', () => {
  it('player sees own hole cards, not others', () => {
    const playerCards = [
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'spades' },
    ] as Card[]
    const player = makePlayer({ holeCards: playerCards })
    const otherCards = [
      { rank: '2', suit: 'clubs' },
      { rank: '3', suit: 'diamonds' },
    ] as Card[]
    const state = makeGameState({
      players: [
        makePlayer({ id: 'player-0', name: 'Opponent', holeCards: otherCards, seatIndex: 0 }),
        makePlayer({ id: 'player-1', name: 'TestBot', holeCards: playerCards, seatIndex: 1 }),
      ],
    })

    const msg = buildDecisionRequest(player, state, [])
    // Should contain own cards
    expect(msg).toContain('Ah')
    expect(msg).toContain('Ks')
    // Should NOT contain opponent cards
    expect(msg).not.toContain('2c')
    expect(msg).not.toContain('3d')
  })

  it('chips reflect post-bet state (remaining stack)', () => {
    // Player started with 1000, posted BB of 5, has 995 left
    const player = makePlayer({ chips: 995, currentBet: 5 })
    const state = makeGameState({
      players: [
        makePlayer({ id: 'player-0', name: 'SB', chips: 998, currentBet: 2, seatIndex: 0 }),
        makePlayer({ id: 'player-1', name: 'TestBot', chips: 995, currentBet: 5, seatIndex: 1 }),
      ],
    })

    const msg = buildDecisionRequest(player, state, [])
    expect(msg).toContain('筹码: $995')
  })

  it('opponent info shows correct chips and status', () => {
    const player = makePlayer({ id: 'player-1', seatIndex: 1 })
    const state = makeGameState({
      players: [
        makePlayer({ id: 'player-0', name: 'FoldedGuy', status: 'folded', chips: 900, seatIndex: 0 }),
        player,
        makePlayer({ id: 'player-2', name: 'AllInGuy', status: 'allIn', chips: 0, seatIndex: 2 }),
      ],
    })

    const msg = buildDecisionRequest(player, state, [])
    expect(msg).toContain('FoldedGuy')
    expect(msg).toContain('已弃牌')
    expect(msg).toContain('AllInGuy')
    expect(msg).toContain('全下')
  })

  it('community cards match phase', () => {
    const player = makePlayer()

    // Preflop: no community cards
    const preflopState = makeGameState({
      phase: 'preflop',
      communityCards: [],
      actionHistory: [],
    })
    const preflopMsg = buildDecisionRequest(player, preflopState, [])
    expect(preflopMsg).toContain('公共牌: 无')
    expect(preflopMsg).toContain('翻前')

    // Flop: 3 community cards
    const flopState = makeGameState({
      phase: 'flop',
      communityCards: [
        { rank: 'T', suit: 'hearts' },
        { rank: 'J', suit: 'spades' },
        { rank: '2', suit: 'diamonds' },
      ] as Card[],
      actionHistory: [],
    })
    const flopMsg = buildDecisionRequest(player, flopState, [])
    expect(flopMsg).toContain('Th Js 2d')
    expect(flopMsg).toContain('翻牌')

    // Turn: 4 community cards
    const turnState = makeGameState({
      phase: 'turn',
      communityCards: [
        { rank: 'T', suit: 'hearts' },
        { rank: 'J', suit: 'spades' },
        { rank: '2', suit: 'diamonds' },
        { rank: 'Q', suit: 'clubs' },
      ] as Card[],
      actionHistory: [],
    })
    const turnMsg = buildDecisionRequest(player, turnState, [])
    expect(turnMsg).toContain('Th Js 2d Qc')
    expect(turnMsg).toContain('转牌')
  })

  it('pot amount matches game state', () => {
    const player = makePlayer()
    const state = makeGameState({ pot: 42 })
    const msg = buildDecisionRequest(player, state, [])
    expect(msg).toContain('底池: $42')
  })

  it('multi-street action history has correct phase separation', () => {
    const player = makePlayer()
    const state = makeGameState({
      phase: 'turn',
      actionHistory: [
        { playerId: 'player-0', type: 'postSmallBlind', amount: 2, timestamp: 1, phase: 'preflop' },
        { playerId: 'player-1', type: 'postBigBlind', amount: 5, timestamp: 2, phase: 'preflop' },
        { playerId: 'player-0', type: 'call', amount: 5, timestamp: 3, phase: 'preflop' },
        { playerId: 'player-1', type: 'check', amount: 0, timestamp: 4, phase: 'preflop' },
        { playerId: 'player-0', type: 'bet', amount: 5, timestamp: 5, phase: 'flop' },
        { playerId: 'player-1', type: 'call', amount: 5, timestamp: 6, phase: 'flop' },
        { playerId: 'player-0', type: 'check', amount: 0, timestamp: 7, phase: 'turn' },
      ],
    })

    const msg = buildDecisionRequest(player, state, [])
    // All three phase headers should appear in correct order
    expect(msg).toContain('[Preflop]')
    expect(msg).toContain('[Flop]')
    expect(msg).toContain('[Turn]')
    // Preflop should come before Flop
    const preflopIdx = msg.indexOf('[Preflop]')
    const flopIdx = msg.indexOf('[Flop]')
    const turnIdx = msg.indexOf('[Turn]')
    expect(preflopIdx).toBeLessThan(flopIdx)
    expect(flopIdx).toBeLessThan(turnIdx)
  })

  it('hand number matches game state', () => {
    const player = makePlayer()
    const state = makeGameState({ handNumber: 42 })
    const msg = buildDecisionRequest(player, state, [])
    expect(msg).toContain('手牌 #42')
  })

  it('valid actions match what is offered', () => {
    const player = makePlayer()
    const state = makeGameState()
    const validActions = [
      { type: 'fold' as const },
      { type: 'call' as const, minAmount: 10, maxAmount: 10 },
      { type: 'raise' as const, minAmount: 20, maxAmount: 20 },
    ]

    const msg = buildDecisionRequest(player, state, validActions)
    expect(msg).toContain('fold — 弃牌')
    expect(msg).toContain('call — 跟注 $10')
    expect(msg).toContain('raise — 加注到 $20')
    // Should NOT contain actions not in validActions
    expect(msg).not.toContain('bet —')
    expect(msg).not.toContain('check —')
  })

  it('system message blinds match game state blinds', () => {
    const player = makePlayer()
    const state = makeGameState({ smallBlind: 10, bigBlind: 20 })
    const msg = buildSystemMessage(player, state, undefined, [])
    expect(msg).toContain('$10/$20')
    expect(msg).toContain('固定为 $10')  // small bet
    expect(msg).toContain('固定为 $20')  // big bet
  })
})
