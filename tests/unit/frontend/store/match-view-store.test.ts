import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveMatchView, reduceMatchViewEvent, useMatchViewStore } from '@/frontend/store/match-view-store'
import type { MatchViewProjection, PokerUiPlayer } from '@/frontend/store/match-view-store'
import type { GameEvent } from '@/platform/core/types'

const MATCH_ID = 'match_1'

let seq = 0

function makeEvent(
  gameType: 'poker' | 'werewolf',
  kind: string,
  payload: Record<string, unknown>,
  actorAgentId: string | null = null,
): GameEvent {
  seq += 1
  return {
    id: `evt_${seq}`,
    matchId: MATCH_ID,
    gameType,
    seq,
    occurredAt: new Date(0).toISOString(),
    kind,
    actorAgentId,
    payload,
    visibility: 'public',
    restrictedTo: null,
  }
}

function pokerEvent(kind: string, payload: Record<string, unknown>, actorAgentId: string | null = null): GameEvent {
  return makeEvent('poker', kind, payload, actorAgentId)
}

function werewolfEvent(
  kind: string,
  payload: Record<string, unknown>,
  actorAgentId: string | null = null,
): GameEvent {
  return makeEvent('werewolf', kind, payload, actorAgentId)
}

function player(agentId: string, displayName: string, seatIndex: number, chips: number): PokerUiPlayer {
  return {
    agentId,
    displayName,
    avatarEmoji: '🤖',
    seatIndex,
    chips,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }
}

const pokerRoster: PokerUiPlayer[] = [
  player('agent-a', 'Agent A', 0, 200),
  player('agent-b', 'Agent B', 1, 200),
  player('agent-c', 'Agent C', 2, 200),
]

const werewolfRoster: PokerUiPlayer[] = [
  player('agent-a', 'Agent A', 0, 0),
  player('agent-b', 'Agent B', 1, 0),
  player('agent-c', 'Agent C', 2, 0),
  player('agent-d', 'Agent D', 3, 0),
  player('agent-e', 'Agent E', 4, 0),
]

/** Fold the same events through the zustand store and compare against the batch projection. */
function expectMatchesStore(events: GameEvent[], roster: PokerUiPlayer[], derived: MatchViewProjection): void {
  useMatchViewStore.getState().reset()
  useMatchViewStore.getState().init({ matchId: MATCH_ID, players: roster })
  for (const item of events) useMatchViewStore.getState().ingestEvent(item)
  const live = useMatchViewStore.getState()

  expect(derived.handNumber).toBe(live.handNumber)
  expect(derived.phase).toBe(live.phase)
  expect(derived.status).toBe(live.status)
  expect(derived.matchComplete).toBe(live.matchComplete)
  expect(derived.winnerAgentId).toBe(live.winnerAgentId)
  expect(derived.currentActor).toBe(live.currentActor)
  expect(derived.pot).toBe(live.pot)
  expect(derived.players).toEqual(live.players)
  expect(derived.chipHistory).toEqual(live.chipHistory)
  expect(derived.werewolf).toEqual(live.werewolf)
  expect(derived.events.map((item) => item.id)).toEqual(live.events.map((item) => item.id))
  expect(derived.events.map((item) => item.handNumberAt)).toEqual(live.events.map((item) => item.handNumberAt))
}

function initialProjection(roster: PokerUiPlayer[]): MatchViewProjection {
  return deriveMatchView([], { matchId: MATCH_ID, players: roster })
}

/** A realistic two-hand heads-of-play poker sequence (blinds, bet/raise/fold, showdown, awards). */
function pokerMatchEvents(): GameEvent[] {
  return [
    pokerEvent('poker/hand-start', { handNumber: 1 }),
    pokerEvent('poker/state', {
      phase: 'preflop',
      handNumber: 1,
      currentActor: 'agent-a',
      dealerIndex: 0,
      smallBlindIndex: 1,
      bigBlindIndex: 2,
      communityCards: [],
      pot: 3,
      streetPots: { preflop: 3, flop: 0, turn: 0, river: 0 },
      sidePots: [],
      players: [
        { id: 'agent-a', seatIndex: 0, chips: 199, currentBet: 1, status: 'active', holeCards: [] },
        { id: 'agent-b', seatIndex: 1, chips: 198, currentBet: 2, status: 'active', holeCards: [] },
        { id: 'agent-c', seatIndex: 2, chips: 200, currentBet: 0, status: 'active', holeCards: [] },
      ],
    }),
    pokerEvent('poker/action', { type: 'call', amount: 2 }, 'agent-c'),
    pokerEvent('poker/action', { type: 'raise', toAmount: 10 }, 'agent-a'),
    pokerEvent('poker/action', { type: 'fold' }, 'agent-b'),
    pokerEvent('poker/action', { type: 'call', amount: 8 }, 'agent-c'),
    pokerEvent('poker/deal-flop', {
      cards: [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: '7', suit: 'diamonds' },
      ],
    }),
    pokerEvent('poker/showdown', {}),
    pokerEvent('poker/pot-award', { potAmount: 22, winnerIds: ['agent-a'] }),
    pokerEvent('poker/hand-start', { handNumber: 2 }),
    pokerEvent('poker/state', {
      phase: 'preflop',
      handNumber: 2,
      currentActor: 'agent-b',
      dealerIndex: 1,
      smallBlindIndex: 2,
      bigBlindIndex: 0,
      communityCards: [],
      pot: 3,
      streetPots: { preflop: 3, flop: 0, turn: 0, river: 0 },
      sidePots: [],
      players: [
        { id: 'agent-a', seatIndex: 0, chips: 211, currentBet: 1, status: 'active', holeCards: [] },
        { id: 'agent-b', seatIndex: 1, chips: 196, currentBet: 2, status: 'active', holeCards: [] },
        { id: 'agent-c', seatIndex: 2, chips: 190, currentBet: 0, status: 'active', holeCards: [] },
      ],
    }),
    pokerEvent('poker/pot-award', { potAmount: 3, winnerIds: ['agent-a'] }),
    pokerEvent('poker/match-end', { winnerId: 'agent-a' }),
  ]
}

/** A realistic werewolf day cycle plus game end. */
function werewolfMatchEvents(): GameEvent[] {
  return [
    werewolfEvent('werewolf/moderator-narrate', {
      day: 1,
      upcomingPhase: 'day',
      narration: '天亮了，昨晚 agent-b 出局',
      deaths: [{ agentId: 'agent-b', cause: 'werewolfKill' }],
    }),
    werewolfEvent('werewolf/speak', { day: 1, content: '我是预言家，昨晚验了 agent-b', claimedRole: 'seer' }, 'agent-a'),
    werewolfEvent('werewolf/speak', { day: 1, content: '我怀疑 agent-d' }, 'agent-c'),
    werewolfEvent('werewolf/vote', { day: 1, target: 'agent-d', reason: '发言最可疑' }, 'agent-a'),
    werewolfEvent('werewolf/vote', { day: 1, target: null }, 'agent-c'),
    werewolfEvent('werewolf/moderator-narrate', {
      day: 1,
      upcomingPhase: 'night',
      narration: 'agent-d 被投票出局',
      deaths: [
        { agentId: 'agent-d', cause: 'vote' },
        { agentId: 'agent-b', cause: 'vote' },
      ],
    }),
    werewolfEvent('werewolf/game-end', {
      winner: 'werewolves',
      actualRoles: {
        'agent-a': 'werewolf',
        'agent-b': 'werewolf',
        'agent-c': 'seer',
        'agent-d': 'villager',
        'agent-e': 'witch',
      },
    }),
  ]
}

describe('match-view-store projection — poker', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_723_000_000_000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives the same projection as incremental store ingestion', () => {
    const events = pokerMatchEvents()
    const derived = deriveMatchView(events, { matchId: MATCH_ID, players: pokerRoster })
    expectMatchesStore(events, pokerRoster, derived)
  })

  it('tracks hand numbers, chips, chipHistory and event handNumberAt across two hands', () => {
    const derived = deriveMatchView(pokerMatchEvents(), { matchId: MATCH_ID, players: pokerRoster })

    expect(derived.handNumber).toBe(2)
    expect(derived.phase).toBe('preflop')
    expect(derived.status).toBe('settled')
    expect(derived.matchComplete).toBe(true)
    expect(derived.winnerAgentId).toBe('agent-a')
    expect(derived.currentActor).toBeNull()
    expect(derived.pot).toBe(0)
    expect(derived.events.map((item) => item.handNumberAt)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2])
    // The hand-2 poker/state event resets the board for the new hand.
    expect(derived.communityCards).toEqual([])
    // NOTE: the winner keeps its pre-award currentBet (the pot-award branch
    // returns early for winners and skips the currentBet reset applied to
    // everyone else). Asserting actual behavior; flagged as a suspected bug.
    expect(derived.players.map((item) => [item.agentId, item.chips, item.currentBet, item.status])).toEqual([
      ['agent-a', 214, 1, 'active'],
      ['agent-b', 196, 0, 'active'],
      ['agent-c', 190, 0, 'active'],
    ])
    expect(derived.chipHistory).toEqual([
      { handNumber: 1, at: 1_723_000_000_000, chips: { 'agent-a': 212, 'agent-b': 198, 'agent-c': 190 } },
      { handNumber: 2, at: 1_723_000_000_000, chips: { 'agent-a': 214, 'agent-b': 196, 'agent-c': 190 } },
    ])
  })

  it('applies bet/raise/fold actions incrementally via reduceMatchViewEvent', () => {
    const events = pokerMatchEvents().slice(1, 6)
    const state = events.reduce(reduceMatchViewEvent, initialProjection(pokerRoster))

    // a: 199 - (raise-to-10 minus currentBet 1) = 190, currentBet 10
    // b: folded at 198 chips
    // c: 200 - 2 (call) - 8 (call) = 190, currentBet 10
    expect(state.players.map((item) => [item.agentId, item.chips, item.currentBet, item.status])).toEqual([
      ['agent-a', 190, 10, 'active'],
      ['agent-b', 198, 2, 'folded'],
      ['agent-c', 190, 10, 'active'],
    ])
    expect(state.pot).toBe(22)
    expect(state.phase).toBe('preflop')
    expect(state.currentActor).toBe('agent-a')
    expect(state.chipHistory).toEqual([])
  })

  it('appends community cards on street deals and advances the phase', () => {
    let state = reduceMatchViewEvent(
      initialProjection(pokerRoster),
      pokerEvent('poker/deal-flop', {
        cards: [
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
          { rank: '7', suit: 'diamonds' },
        ],
      }),
    )
    expect(state.phase).toBe('flop')
    expect(state.communityCards).toHaveLength(3)

    state = reduceMatchViewEvent(state, pokerEvent('poker/deal-turn', { cards: [{ rank: '2', suit: 'clubs' }] }))
    expect(state.phase).toBe('turn')
    expect(state.communityCards).toEqual([
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
      { rank: '2', suit: 'clubs' },
    ])
  })

  it('uses poker hand-start as an authoritative hand number during refresh replay', () => {
    const state = reduceMatchViewEvent(initialProjection(pokerRoster), pokerEvent('poker/hand-start', { handNumber: 52 }))
    expect(state.handNumber).toBe(52)
    expect(state.events.at(-1)?.handNumberAt).toBe(52)
    expect(state.phase).toBe('preflop')
    expect(state.status).toBe('live')
  })

  it('splits a multi-winner pot and replaces the same-hand chipHistory snapshot', () => {
    const initial = initialProjection(pokerRoster)
    const split = reduceMatchViewEvent(
      initial,
      pokerEvent('poker/pot-award', { potAmount: 10, winnerIds: ['agent-a', 'agent-c'] }),
    )
    expect(split.players.map((item) => [item.agentId, item.chips])).toEqual([
      ['agent-a', 205],
      ['agent-b', 200],
      ['agent-c', 205],
    ])
    expect(split.pot).toBe(0)
    expect(split.chipHistory).toHaveLength(1)

    const sidePot = reduceMatchViewEvent(
      split,
      pokerEvent('poker/pot-award', { potAmount: 4, winnerIds: ['agent-b'] }),
    )
    expect(sidePot.players.map((item) => [item.agentId, item.chips])).toEqual([
      ['agent-a', 205],
      ['agent-b', 204],
      ['agent-c', 205],
    ])
    // Second award for hand 1 replaces the snapshot instead of appending.
    expect(sidePot.chipHistory).toEqual([
      { handNumber: 1, at: 1_723_000_000_000, chips: { 'agent-a': 205, 'agent-b': 204, 'agent-c': 205 } },
    ])
    expect(sidePot.events.map((item) => item.handNumberAt)).toEqual([1, 1])
  })

  it('marks an allIn actor with zero chips and the contributed pot', () => {
    const state = reduceMatchViewEvent(
      initialProjection(pokerRoster),
      pokerEvent('poker/action', { type: 'allIn', amount: 200 }, 'agent-a'),
    )
    expect(state.players[0]).toMatchObject({ agentId: 'agent-a', chips: 0, currentBet: 200, status: 'allIn' })
    expect(state.pot).toBe(200)
  })

  it('treats the settlement event kind as match end', () => {
    const state = reduceMatchViewEvent(initialProjection(pokerRoster), pokerEvent('settlement', { winnerId: 'agent-b' }))
    expect(state.matchComplete).toBe(true)
    expect(state.status).toBe('settled')
    expect(state.winnerAgentId).toBe('agent-b')
    expect(state.currentActor).toBeNull()
  })
})

describe('match-view-store projection — werewolf', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_723_000_000_000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives the same projection as incremental store ingestion', () => {
    const events = werewolfMatchEvents()
    const derived = deriveMatchView(events, { matchId: MATCH_ID, players: werewolfRoster })
    expectMatchesStore(events, werewolfRoster, derived)
  })

  it('accumulates speeches, votes, deduped deaths and the game-end reveal', () => {
    const derived = deriveMatchView(werewolfMatchEvents(), { matchId: MATCH_ID, players: werewolfRoster })

    expect(derived.werewolf.day).toBe(1)
    expect(derived.werewolf.phase).toBe('night')
    expect(derived.werewolf.speechLog).toEqual([
      { day: 1, agentId: 'agent-a', content: '我是预言家，昨晚验了 agent-b', claimedRole: 'seer' },
      { day: 1, agentId: 'agent-c', content: '我怀疑 agent-d' },
    ])
    expect(derived.werewolf.voteLog).toEqual([
      { day: 1, voter: 'agent-a', target: 'agent-d', reason: '发言最可疑' },
      { day: 1, voter: 'agent-c', target: null },
    ])
    expect(derived.werewolf.moderatorNarration).toEqual([
      { day: 1, phase: 'day', narration: '天亮了，昨晚 agent-b 出局' },
      { day: 1, phase: 'night', narration: 'agent-d 被投票出局' },
    ])
    // agent-b is announced once; the duplicate announcement in event 6 is ignored.
    expect(derived.werewolf.deaths).toEqual([
      { agentId: 'agent-b', day: 1, cause: 'werewolfKill' },
      { agentId: 'agent-d', day: 1, cause: 'vote' },
    ])
    expect(derived.werewolf.roleAssignments).toEqual({
      'agent-a': 'werewolf',
      'agent-b': 'werewolf',
      'agent-c': 'seer',
      'agent-d': 'villager',
      'agent-e': 'witch',
    })
    expect(derived.werewolf.winner).toBe('werewolves')
    expect(derived.matchComplete).toBe(true)
    expect(derived.status).toBe('settled')
    expect(derived.currentActor).toBeNull()
    expect(derived.events.map((item) => item.handNumberAt)).toEqual([1, 1, 1, 1, 1, 1, 1])
  })

  it('ignores malformed death entries and defaults missing day/phase from prior state', () => {
    const state = reduceMatchViewEvent(
      initialProjection(werewolfRoster),
      werewolfEvent('werewolf/moderator-narrate', {
        narration: '杂讯公告',
        deaths: [{ cause: 'unknown' }, 'garbage', { agentId: 'agent-e' }],
      }),
    )
    expect(state.werewolf.day).toBe(0)
    expect(state.werewolf.phase).toBeNull()
    expect(state.werewolf.deaths).toEqual([{ agentId: 'agent-e', day: 0, cause: null }])
    expect(state.werewolf.moderatorNarration).toEqual([{ day: 0, phase: '', narration: '杂讯公告' }])
  })
})
