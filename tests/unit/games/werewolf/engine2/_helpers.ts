// Shared scripted-scenario helpers for engine v2 tests.
//
// Everything is driven through the public engine API only (applyAction /
// applyDefaultAction), so every test is also an integration test of the
// phase machine. Determinism (NFR-W1) makes the scripts reproducible.

import {
  BOARD_PRESET_6P_BASE,
  BOARD_PRESET_9P_333,
  applyAction,
  applyDefaultAction,
  createMatchFromSeating,
  presetBoard,
} from '@/games/werewolf/engine2'
import type {
  ActionRejection,
  ApplyOutcome,
  BoardPreset,
  PlayerSlot,
  ResolvedBoard,
  RoleId,
  WerewolfAction,
  WerewolfEngineState,
  WerewolfEvent,
  WerewolfEventKind,
} from '@/games/werewolf/engine2'

export const IDS6 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const
export const IDS9 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'] as const
export const SEED = 20260908

export interface Acc {
  state: WerewolfEngineState
  events: WerewolfEvent[]
}

function resolvedBoard(preset: BoardPreset, overrides?: Partial<BoardPreset>): ResolvedBoard {
  const result = presetBoard(preset, overrides)
  if (!result.ok) throw new Error(`board invalid: ${JSON.stringify(result.issues)}`)
  return result.board
}

export function board6(overrides?: Partial<BoardPreset>): ResolvedBoard {
  return resolvedBoard(BOARD_PRESET_6P_BASE, overrides)
}

export function board9(overrides?: Partial<BoardPreset>): ResolvedBoard {
  return resolvedBoard(BOARD_PRESET_9P_333, overrides)
}

function start(
  board: ResolvedBoard,
  seating: RoleId[],
  playerIds: readonly string[],
): Acc {
  const created = createMatchFromSeating({
    board,
    seating,
    playerIds: [...playerIds],
    seed: SEED,
  })
  if (created.status !== 'created') {
    throw new Error(`match creation rejected: ${JSON.stringify(created.issues)}`)
  }
  return { state: created.state, events: created.events }
}

/** Board A fixture: default 2狼/预/女/2民 with an explicit seating. */
export function start6(seating: RoleId[], overrides?: Partial<BoardPreset>): Acc {
  return start(board6(overrides), seating, IDS6)
}

/** Board B fixture: 预女猎 3民 3狼 with an explicit seating. */
export function start9(seating: RoleId[], overrides?: Partial<BoardPreset>): Acc {
  return start(board9(overrides), seating, IDS9)
}

/** Standard board B seating: p1 seer, p2 witch, p3 hunter, p4-6 villagers, p7-9 wolves. */
export const SEATING_9: RoleId[] = [
  'seer',
  'witch',
  'hunter',
  'villager',
  'villager',
  'villager',
  'werewolf',
  'werewolf',
  'werewolf',
]

/** Standard board A seating: p1/p2 wolves, p3 seer, p4 witch, p5/p6 villagers. */
export const SEATING_6: RoleId[] = ['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'villager']

/** Apply an action that must be accepted; folds events into the accumulator. */
export function step(acc: Acc, action: WerewolfAction): WerewolfEvent[] {
  const outcome = applyAction(acc.state, action)
  if (outcome.status === 'rejected') {
    throw new Error(`action ${action.type} rejected: [${outcome.rejection.code}] ${outcome.rejection.message}`)
  }
  acc.state = outcome.state
  acc.events.push(...outcome.events)
  return outcome.events
}

/** Apply an action that must be rejected; returns the structured rejection. */
export function fail(acc: Acc, action: WerewolfAction): ActionRejection {
  const outcome = applyAction(acc.state, action)
  if (outcome.status === 'accepted') {
    throw new Error(`action ${action.type} unexpectedly accepted (phase ${acc.state.phase})`)
  }
  return outcome.rejection
}

/** Apply an action, accepted or not, folding on success. */
export function attempt(acc: Acc, action: WerewolfAction): ApplyOutcome {
  const outcome = applyAction(acc.state, action)
  if (outcome.status === 'accepted') {
    acc.state = outcome.state
    acc.events.push(...outcome.events)
  }
  return outcome
}

/** Every living wolf (seat order) votes the same kill target (null = 空刀). */
export function killVote(acc: Acc, target: string | null): void {
  const wolves = acc.state.players
    .filter((p) => p.alive && p.role === 'werewolf')
    .map((p) => p.playerId)
  for (const wolf of wolves) step(acc, { type: 'kill', actorId: wolf, targetId: target })
}

export function witchSavePass(acc: Acc): void {
  const witch = aliveByRoleId(acc, 'witch')
  if (witch && acc.state.phase === 'night.witch.save') {
    step(acc, { type: 'witchSavePass', actorId: witch })
  }
}

export function witchPoisonPass(acc: Acc): void {
  const witch = aliveByRoleId(acc, 'witch')
  if (witch && acc.state.phase === 'night.witch.poison') {
    step(acc, { type: 'witchPoisonPass', actorId: witch })
  }
}

/**
 * Walk the remaining day flow around a vote round: pending last words,
 * speeches, the votes (and optional PK revote), then any exile last words.
 * Hunter windows must be scripted explicitly by the test.
 */
export function dayCycle(
  acc: Acc,
  votes: ReadonlyArray<readonly [string, string | null]>,
  pkVotes?: ReadonlyArray<readonly [string, string | null]>,
): void {
  settleLastWords(acc)
  speakAll(acc)
  settleLastWords(acc)
  for (const [voter, target] of votes) step(acc, { type: 'vote', actorId: voter, targetId: target })
  if (acc.state.phase === 'day.pkSpeech') {
    speakAll(acc)
    if (pkVotes) {
      for (const [voter, target] of pkVotes) step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
  }
  settleLastWords(acc)
}

export function seerCheck(acc: Acc, target: string): void {
  const seer = aliveByRoleId(acc, 'seer')
  if (seer) step(acc, { type: 'seerCheck', actorId: seer, targetId: target })
}

function aliveByRoleId(acc: Acc, role: RoleId): string | null {
  return acc.state.players.find((p) => p.alive && p.role === role)?.playerId ?? null
}

/** Speak for every pending speech slot (day + PK speeches). */
export function speakAll(acc: Acc, text = 'speech'): void {
  let guard = 0
  while ((acc.state.phase === 'day.speech' || acc.state.phase === 'day.pkSpeech') && guard++ < 50) {
    const actor = acc.state.pendingActor
    if (!actor) break
    step(acc, { type: 'speak', actorId: actor, content: text })
  }
}

/** Deliver (or decline) every pending last-words slot. */
export function settleLastWords(acc: Acc, content: string | null = 'last-words'): void {
  let guard = 0
  while (acc.state.phase === 'day.lastWords' && guard++ < 20) {
    const actor = acc.state.pendingActor
    if (!actor) break
    if (content === null) step(acc, { type: 'lastWordsPass', actorId: actor })
    else step(acc, { type: 'lastWords', actorId: actor, content })
  }
}

export function hunterPass(acc: Acc): void {
  const actor = acc.state.pendingActor
  if (!actor) throw new Error('hunterPass: no pending hunter')
  step(acc, { type: 'hunterPass', actorId: actor })
}

export function hunterShoot(acc: Acc, target: string): void {
  const actor = acc.state.pendingActor
  if (!actor) throw new Error('hunterShoot: no pending hunter')
  step(acc, { type: 'hunterShoot', actorId: actor, targetId: target })
}

/** Cast the day's main votes (and optionally the PK revote). */
export function playDay(
  acc: Acc,
  votes: ReadonlyArray<readonly [string, string | null]>,
  pkVotes?: ReadonlyArray<readonly [string, string | null]>,
): void {
  speakAll(acc)
  settleLastWords(acc)
  for (const [voter, target] of votes) step(acc, { type: 'vote', actorId: voter, targetId: target })
  if (acc.state.phase === 'day.pkSpeech') {
    speakAll(acc)
    if (pkVotes) {
      for (const [voter, target] of pkVotes) step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
  }
  settleLastWords(acc)
}

/** Keep applying the WFR-304 default action until `until` holds (or bound). */
export function runDefaults(acc: Acc, until: (a: Acc) => boolean, maxSteps = 2000): number {
  let applied = 0
  while (!until(acc) && applied < maxSteps) {
    const outcome = applyDefaultAction(acc.state)
    if (outcome.status === 'rejected') {
      throw new Error(`default rejected in ${acc.state.phase}: ${outcome.rejection.message}`)
    }
    acc.state = outcome.state
    acc.events.push(...outcome.events)
    applied += 1
  }
  if (applied >= maxSteps) throw new Error('runDefaults: exceeded step bound (deadlock?)')
  return applied
}

export function evsOf<K extends WerewolfEventKind>(
  events: readonly WerewolfEvent[],
  kind: K,
): Array<Extract<WerewolfEvent, { kind: K }>> {
  return events.filter((e): e is Extract<WerewolfEvent, { kind: K }> => e.kind === kind)
}

export function evOf<K extends WerewolfEventKind>(
  events: readonly WerewolfEvent[],
  kind: K,
): Extract<WerewolfEvent, { kind: K }> {
  const found = evsOf(events, kind)
  if (found.length === 0) throw new Error(`no ${kind} event found`)
  return found[found.length - 1]
}

export function kinds(events: readonly WerewolfEvent[]): WerewolfEventKind[] {
  return events.map((e) => e.kind)
}

export function player(acc: Acc, playerId: string): PlayerSlot {
  const found = acc.state.players.find((p) => p.playerId === playerId)
  if (!found) throw new Error(`no player ${playerId}`)
  return found
}

export function snapshot(events: readonly WerewolfEvent[]): string {
  return JSON.stringify(events)
}

export function speechOrderOfDay(events: readonly WerewolfEvent[], day: number): string[] {
  return evsOf(events, 'speech')
    .filter((e) => e.day === day)
    .map((e) => e.payload.playerId)
}
