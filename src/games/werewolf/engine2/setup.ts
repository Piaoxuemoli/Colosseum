// Werewolf engine v2 — match bootstrap (WFR-101 acceptance, WFR-503).
//
// Deterministic seeded role shuffle; the seed enters the event stream as a
// moderator-audience event so replays are reproducible without leaking the
// role permutation to players (a public seed would leak every seat's card).

import type {
  BoardIssue,
  CreateMatchResult,
  PlayerSlot,
  ResolvedBoard,
  RoleId,
  WerewolfEngineState,
} from './types'
import { parseBoard } from './board'
import { emitEvent, enterNight, runCascade, type Ctx } from './phases'

/** Seeded LCG — same generator as the legacy engine, chosen for stability. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Fisher–Yates shuffle with an injectable rng for determinism (NFR-W1). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface CreateMatchArgs {
  /** Raw board config — parsed and validated here (structured rejection). */
  board: unknown
  /** Player ids in seat order (seat 1..N). */
  playerIds: string[]
  /** Explicit random seed; recorded in the event stream (WFR-503). */
  seed: number
}

export function createMatch(args: CreateMatchArgs): CreateMatchResult {
  const parsed = parseBoard(args.board)
  if (!parsed.ok) return { status: 'invalid', issues: parsed.issues }

  const total = Object.values(parsed.board.roles).reduce((sum, n) => sum + n, 0)
  if (args.playerIds.length !== total) {
    return {
      status: 'invalid',
      issues: [
        {
          field: 'playerIds',
          code: 'count-mismatch',
          message: `board seats ${total} players but ${args.playerIds.length} were given`,
        },
      ],
    }
  }
  if (new Set(args.playerIds).size !== args.playerIds.length) {
    return {
      status: 'invalid',
      issues: [{ field: 'playerIds', code: 'duplicate-player', message: 'player ids must be unique' }],
    }
  }
  if (parsed.board.day1StartSeat > total) {
    return {
      status: 'invalid',
      issues: [
        {
          field: 'day1StartSeat',
          code: 'out-of-range',
          message: `day1StartSeat ${parsed.board.day1StartSeat} exceeds seat count ${total}`,
        },
      ],
    }
  }

  const pool: RoleId[] = []
  for (const [role, count] of Object.entries(parsed.board.roles) as Array<[RoleId, number]>) {
    for (let i = 0; i < count; i++) pool.push(role)
  }
  const seating = shuffle(pool, seededRng(args.seed))
  return createMatchFromSeating({
    board: parsed.board,
    seating,
    playerIds: args.playerIds,
    seed: args.seed,
  })
}

export interface CreateMatchFromSeatingArgs {
  board: ResolvedBoard
  /** Role for each seat, in seat order. Must match the board counts exactly. */
  seating: RoleId[]
  playerIds: string[]
  seed: number
}

/**
 * Deterministic fixture/replay entry point: seat players explicitly instead
 * of shuffling. Also validates that the seating matches the board's role
 * counts (scripted scenarios must be legal boards).
 */
export function createMatchFromSeating(args: CreateMatchFromSeatingArgs): CreateMatchResult {
  const { board, playerIds, seed } = args
  const issues: BoardIssue[] = []
  if (args.seating.length !== playerIds.length) {
    issues.push({
      field: 'seating',
      code: 'count-mismatch',
      message: `seating has ${args.seating.length} roles for ${playerIds.length} players`,
    })
  }
  const expected = new Map<RoleId, number>(Object.entries(board.roles) as Array<[RoleId, number]>)
  const actual = new Map<RoleId, number>()
  for (const role of args.seating) actual.set(role, (actual.get(role) ?? 0) + 1)
  for (const [role, want] of expected) {
    const got = actual.get(role) ?? 0
    if (got !== want) {
      issues.push({
        field: `seating.${role}`,
        code: 'count-mismatch',
        message: `seating has ${got}× ${role}, board declares ${want}`,
      })
    }
  }
  if (board.day1StartSeat > playerIds.length) {
    issues.push({
      field: 'day1StartSeat',
      code: 'out-of-range',
      message: `day1StartSeat ${board.day1StartSeat} exceeds seat count ${playerIds.length}`,
    })
  }
  if (issues.length > 0) return { status: 'invalid', issues }

  const players: PlayerSlot[] = playerIds.map((playerId, index) => ({
    playerId,
    seat: index + 1,
    role: args.seating[index],
    alive: true,
    death: null,
  }))

  const state: WerewolfEngineState = {
    engineVersion: 2,
    board,
    players,
    day: 0,
    phase: 'day.announce', // placeholder; enterNight (cascade) sets the real first phase
    pendingActor: null,
    night: null,
    witchPotions: { save: true, poison: true },
    hunterShotsUsed: [],
    speechQueue: [],
    speechTurn: 0,
    voteRound: null,
    settlement: null,
    postSettlement: 'speech',
    outcome: null,
    nextSeq: 0,
  }
  const ctx: Ctx = { state, events: [] }

  // Header events (WFR-502 #1 + WFR-503 seed provenance).
  emitEvent(ctx, 'matchStarted', { kind: 'public' }, null, {
    board,
    seats: players.map((p) => ({ playerId: p.playerId, seat: p.seat })),
  })
  emitEvent(ctx, 'randomnessSeed', { kind: 'moderator' }, null, { seed })
  for (const p of players) {
    emitEvent(ctx, 'rolesAssigned', { kind: 'role-self', playerId: p.playerId }, p.playerId, {
      role: p.role,
    })
  }
  const wolves = players.filter((p) => p.role === 'werewolf')
  if (wolves.length >= 2) {
    emitEvent(ctx, 'teammatesRevealed', { kind: 'wolves' }, null, {
      wolfIds: wolves.map((p) => p.playerId),
    })
  }

  // Walk the phase graph to the first actionable phase (skip-dead cascade).
  enterNight(ctx)
  runCascade(ctx)

  return { status: 'created', state: ctx.state, events: ctx.events }
}
