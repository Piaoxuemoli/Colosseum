// Replay + determinism (WFR-503 / NFR-W1): the event stream alone rebuilds
// the exact state, and identical inputs produce byte-identical streams
// (AC-14/15), including mid-match prefixes.

import { describe, expect, it } from 'vitest'
import type { WerewolfEngineState, WerewolfEvent } from '@/games/werewolf/engine2'
import {
  BOARD_PRESET_6P_BASE,
  BOARD_PRESET_9P_333,
  createMatch,
  presetBoard,
  reduceEvents,
} from '@/games/werewolf/engine2'
import {
  SEED,
  SEATING_6,
  SEATING_9,
  evOf,
  hunterPass,
  killVote,
  runDefaults,
  seerCheck,
  settleLastWords,
  snapshot,
  speakAll,
  start6,
  start9,
  step,
  witchPoisonPass,
  witchSavePass,
  type Acc,
} from './_helpers'

/** Full board-A game ending by parity at the day-1 exile. */
function parityGame(): Acc {
  const acc = start6(SEATING_6)
  killVote(acc, 'p3') // seer
  witchSavePass(acc)
  witchPoisonPass(acc)
  seerCheck(acc, 'p5')
  settleLastWords(acc)
  speakAll(acc)
  for (const [voter, target] of [
    ['p1', 'p6'], ['p2', 'p6'], ['p4', 'p6'], ['p5', 'p6'], ['p6', 'p5'],
  ] as const) {
    step(acc, { type: 'vote', actorId: voter, targetId: target })
  }
  // Exiling p6 leaves 2 wolves vs 2 good → parity fast path ends the match.
  return acc
}

/** Full board-B game with hunter interaction ending by wolf priority (AC-11 script). */
function wolfPriorityGame(onMidDay1SpeechesDone?: (acc: Acc) => void): Acc {
  const acc = start9(SEATING_9)
  killVote(acc, 'p3')
  witchSavePass(acc)
  witchPoisonPass(acc)
  seerCheck(acc, 'p4')
  hunterPass(acc)
  settleLastWords(acc)
  speakAll(acc)
  onMidDay1SpeechesDone?.(acc)
  for (const [voter, target] of [
    ['p1', 'p7'], ['p2', 'p7'], ['p4', 'p7'], ['p5', 'p7'], ['p6', 'p7'],
    ['p7', 'p2'], ['p8', 'p1'], ['p9', 'p1'],
  ] as const) {
    step(acc, { type: 'vote', actorId: voter, targetId: target })
  }
  settleLastWords(acc)
  killVote(acc, 'p4')
  witchSavePass(acc)
  witchPoisonPass(acc)
  seerCheck(acc, 'p5')
  speakAll(acc)
  for (const [voter, target] of [
    ['p1', null], ['p2', 'p1'], ['p5', 'p1'], ['p6', 'p1'], ['p8', 'p2'], ['p9', 'p2'],
  ] as const) {
    step(acc, { type: 'vote', actorId: voter, targetId: target })
  }
  settleLastWords(acc)
  killVote(acc, 'p5')
  witchSavePass(acc)
  witchPoisonPass(acc)
  speakAll(acc)
  for (const [voter, target] of [
    ['p2', 'p8'], ['p6', 'p8'], ['p8', 'p2'], ['p9', 'p6'],
  ] as const) {
    step(acc, { type: 'vote', actorId: voter, targetId: target })
  }
  settleLastWords(acc)
  killVote(acc, 'p6')
  witchSavePass(acc)
  step(acc, { type: 'witchPoison', actorId: 'p2', targetId: 'p9' })
  return acc
}

describe('AC-14: reduceEvents rebuilds the state from the stream alone', () => {
  it('full board-A game replays to the exact final state', () => {
    const acc = parityGame()
    expect(acc.state.phase).toBe('ended')
    const replay = reduceEvents(acc.events)
    expect(replay.status).toBe('ok')
    if (replay.status !== 'ok') return
    expect(replay.state).toEqual(acc.state)
    expect(replay.state.outcome).toEqual(acc.state.outcome)
  })

  it('full board-B game (hunter windows + exiles) replays to the exact final state', () => {
    const acc = wolfPriorityGame()
    expect(acc.state.phase).toBe('ended')
    const replay = reduceEvents(acc.events)
    expect(replay.status).toBe('ok')
    if (replay.status !== 'ok') return
    expect(replay.state).toEqual(acc.state)
  })

  it('mid-match prefixes replay to the exact intermediate state (NFR-W2)', () => {
    let checkpoint: { state: WerewolfEngineState; events: WerewolfEvent[] } | undefined
    wolfPriorityGame((acc) => {
      checkpoint = { state: structuredClone(acc.state), events: [...acc.events] }
    })
    expect(checkpoint).toBeDefined()
    if (!checkpoint) return
    expect(checkpoint.state.phase).toBe('day.vote')
    const replay = reduceEvents(checkpoint.events)
    expect(replay.status).toBe('ok')
    if (replay.status !== 'ok') return
    expect(replay.state).toEqual(checkpoint.state)
  })

  it('streams without a matchStarted header fail with a structured error', () => {
    expect(reduceEvents([]).status).toBe('error')
    expect(reduceEvents([{ seq: 0, day: 0, kind: 'speech', audience: { kind: 'public' }, actorId: null, payload: { playerId: 'x', content: '', order: 1 } }]).status).toBe('error')
  })
})

describe('AC-15: determinism (NFR-W1)', () => {
  it('same config + same action script → byte-identical event streams (both boards)', () => {
    expect(snapshot(parityGame().events)).toBe(snapshot(parityGame().events))
    expect(snapshot(wolfPriorityGame().events)).toBe(snapshot(wolfPriorityGame().events))
  })

  it('seeded role shuffle: same seed reproduces, different seed diverges', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const first = createMatch({ board: BOARD_PRESET_6P_BASE, playerIds: ids, seed: SEED })
    const second = createMatch({ board: BOARD_PRESET_6P_BASE, playerIds: ids, seed: SEED })
    const other = createMatch({ board: BOARD_PRESET_6P_BASE, playerIds: ids, seed: SEED + 1 })
    expect(first.status).toBe('created')
    expect(second.status).toBe('created')
    expect(other.status).toBe('created')
    if (first.status !== 'created' || second.status !== 'created' || other.status !== 'created') return
    expect(second.state).toEqual(first.state)
    expect(snapshot(second.events)).toBe(snapshot(first.events))
    // Different seed re-deals (overwhelmingly likely to differ on 6 seats).
    const rolesOf = (m: typeof first): string => m.state.players.map((p) => p.role).join(',')
    const differs = rolesOf(other) !== rolesOf(first) || snapshot(other.events) !== snapshot(first.events)
    expect(differs).toBe(true)
  })

  it('a default-driven match is deterministic too', () => {
    const run = (): Acc => {
      const acc = start6(SEATING_6)
      runDefaults(acc, (a) => a.state.phase === 'ended')
      return acc
    }
    expect(snapshot(run().events)).toBe(snapshot(run().events))
  })

  it('preset boards parse identically across runs (stable defaults)', () => {
    const a = presetBoard(BOARD_PRESET_9P_333)
    const b = presetBoard(BOARD_PRESET_9P_333)
    expect(a).toEqual(b)
    expect(a.ok).toBe(true)
  })
})

describe('end-to-end demonstration games (通用门禁)', () => {
  it('board A: complete game with final reveal + replay reconstruction', () => {
    const acc = parityGame()
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.reveal).toHaveLength(6)
    expect(ended.payload.reveal.every((r) => typeof r.role === 'string')).toBe(true)
    expect(ended.audience).toEqual({ kind: 'public' })
    // Seq is strictly monotonic across the whole stream.
    const seqs = acc.events.map((e) => e.seq)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1)
  })

  it('board B: complete game with final reveal + replay reconstruction', () => {
    const acc = wolfPriorityGame()
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.winner).toBe('wolves')
    expect(ended.payload.reveal).toHaveLength(9)
    const replay = reduceEvents(acc.events)
    expect(replay.status).toBe('ok')
    if (replay.status !== 'ok') return
    expect(replay.state.players.map((p) => p.alive)).toEqual(acc.state.players.map((p) => p.alive))
  })
})
