// Werewolf engine v2 — public engine facade.
//
//   applyAction(state, action)  → { state, events } | { rejection }   (WFR-3xx)
//   applyDefaultAction(state)   → WFR-304 no-response fallback
//   availableActions(state, id) → WFR-303 machine-readable action contract
//   reduceEvents(events)        → WFR-503 replay
//
// Deterministic and side-effect free: the input state is never mutated
// (NFR-W1/W2); every step is a pure function of (state, action).

import type {
  ActionOption,
  ActionRejection,
  ApplyOutcome,
  CreateMatchResult,
  RejectionCode,
  RoleId,
  WerewolfAction,
  WerewolfEngineState,
  WerewolfEvent,
} from './types'
import { engineActionSchema } from './types'
import { alivePlayers, bySeat, playerById } from './roles'
import { validateAction } from './validator'
import { applyActionToCtx, runCascade, type Ctx } from './phases'
import { createMatchFromSeating } from './setup'

export { createMatch, createMatchFromSeating } from './setup'
export { visibleEvents } from './events'
export type { EventViewer } from './events'
export type { Ctx } from './phases'

function rejectWith(
  state: WerewolfEngineState,
  action: WerewolfAction | { actorId: string; type: string },
  code: RejectionCode,
  message: string,
): ApplyOutcome {
  const rejection: ActionRejection = {
    code,
    message,
    context: {
      day: state.day,
      phase: state.phase,
      actorId: action.actorId,
      actionType: action.type,
    },
  }
  return { status: 'rejected', rejection }
}

/**
 * WFR-303 alias-normalization hook point: upstream adapters translate LLM
 * output into standard actions; the engine only adjudicates the standard
 * form. This parser is the boundary — anything malformed becomes a
 * structured UNPARSEABLE rejection instead of an exception.
 */
export function normalizeAction(raw: unknown): { ok: true; action: WerewolfAction } | { ok: false; rejection: ActionRejection } {
  const parsed = engineActionSchema.safeParse(raw)
  if (parsed.success) return { ok: true, action: parsed.data }
  return {
    ok: false,
    rejection: {
      code: 'UNPARSEABLE',
      message: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      context: { day: -1, phase: 'ended', actorId: '(unknown)', actionType: '(unknown)' },
    },
  }
}

/** Validate + apply one action; rejected actions leave the state untouched. */
export function applyAction(state: WerewolfEngineState, action: WerewolfAction): ApplyOutcome {
  return applyActionInternal(state, action, false)
}

function applyActionInternal(
  state: WerewolfEngineState,
  action: WerewolfAction,
  isDefault: boolean,
): ApplyOutcome {
  const normalized = normalizeAction(action)
  if (!normalized.ok) return { status: 'rejected', rejection: normalized.rejection }

  const validation = validateAction(state, normalized.action)
  if (!validation.ok) return { status: 'rejected', rejection: validation.rejection }

  const next: WerewolfEngineState = structuredClone(state)
  const ctx: Ctx = { state: next, events: [] }
  applyActionToCtx(ctx, normalized.action, isDefault)
  runCascade(ctx)
  return { status: 'accepted', state: next, events: ctx.events }
}

/**
 * WFR-304: every slot defines a no-response default — 弃票 / 不发言占位 /
 * 不使用技能 / 憋枪 / 空刀(或最低座位兜底). Default-produced events carry
 * isDefault=true so they are identifiable in the stream (AC-17).
 */
export function applyDefaultAction(state: WerewolfEngineState): ApplyOutcome {
  const actor = state.pendingActor
  if (actor === null) {
    return rejectWith(state, { actorId: '-', type: '(default)' }, 'WRONG_PHASE', 'no pending actor to default')
  }
  let action: WerewolfAction
  switch (state.phase) {
    case 'night.wolves': {
      // Default = 空刀 vote; when 空刀 is banned, fall back to the
      // lowest-seat legal victim (never self) so the match still progresses.
      let targetId: string | null = null
      if (!state.board.emptyKillAllowed) {
        const victim = alivePlayers(state)
          .slice()
          .sort(bySeat)
          .find((p) => p.playerId !== actor)
        targetId = victim?.playerId ?? null
      }
      action = { type: 'kill', actorId: actor, targetId }
      break
    }
    case 'night.witch.save':
      action = { type: 'witchSavePass', actorId: actor }
      break
    case 'night.witch.poison':
      action = { type: 'witchPoisonPass', actorId: actor }
      break
    case 'night.seer':
      action = { type: 'seerPass', actorId: actor }
      break
    case 'day.speech':
    case 'day.pkSpeech':
      action = { type: 'speak', actorId: actor, content: '' }
      break
    case 'day.vote':
    case 'day.pkVote':
      action = { type: 'vote', actorId: actor, targetId: null }
      break
    case 'day.hunterWindow':
      action = { type: 'hunterPass', actorId: actor }
      break
    case 'day.lastWords':
      action = { type: 'lastWordsPass', actorId: actor }
      break
    default:
      return rejectWith(state, { actorId: actor, type: '(default)' }, 'WRONG_PHASE', `phase ${state.phase} has no default action`)
  }
  return applyActionInternal(state, action, true)
}

/** The agent the moderator should prompt next (null while auto-advancing/ended). */
export function currentActor(state: WerewolfEngineState): string | null {
  return state.pendingActor
}

/**
 * WFR-303 action contract for one player: what they may legally submit right
 * now ( legality matrix of WFR-301, expressed data-only for agent adapters).
 */
export function availableActions(state: WerewolfEngineState, playerId: string): ActionOption[] {
  const player = playerById(state, playerId)
  if (!player) return []
  const aliveIds = alivePlayers(state)
    .slice()
    .sort(bySeat)
    .map((p) => p.playerId)
  const round = state.voteRound

  switch (state.phase) {
    case 'night.wolves': {
      if (player.role !== 'werewolf' || !player.alive) return []
      if (state.night?.wolfVotes.some((v) => v.voterId === playerId)) return []
      const targets = aliveIds.filter((id) => state.board.selfKillAllowed || id !== playerId)
      return [{ type: 'kill', label: '狼刀投票', targetIds: targets, allowNone: state.board.emptyKillAllowed }]
    }
    case 'night.seer': {
      if (player.role !== 'seer' || !player.alive || state.pendingActor !== playerId) return []
      return [
        { type: 'seerCheck', label: '查验', targetIds: aliveIds.filter((id) => id !== playerId), allowNone: false },
        { type: 'seerPass', label: '不查验', targetIds: [], allowNone: true },
      ]
    }
    case 'night.witch.save': {
      if (player.role !== 'witch' || !player.alive || state.pendingActor !== playerId) return []
      const knife = state.night?.knifeTarget ?? null
      if (!state.witchPotions.save || knife === null) return []
      const selfSaveLegal =
        state.board.witchSelfSavePolicy === 'always' ||
        (state.board.witchSelfSavePolicy === 'first-night-only' && (state.night?.nightNumber ?? 0) === 1)
      const targets = knife === playerId && !selfSaveLegal ? [] : [knife]
      return [
        { type: 'witchSave', label: '用解药', targetIds: targets, allowNone: false },
        { type: 'witchSavePass', label: '不用解药', targetIds: [], allowNone: true },
      ]
    }
    case 'night.witch.poison': {
      if (player.role !== 'witch' || !player.alive || state.pendingActor !== playerId) return []
      if (!state.witchPotions.poison) return []
      if (state.board.witchOnePotionPerNight && state.night?.witchSaveTarget != null) return []
      return [
        { type: 'witchPoison', label: '用毒药', targetIds: aliveIds.filter((id) => id !== playerId), allowNone: false },
        { type: 'witchPoisonPass', label: '不用毒药', targetIds: [], allowNone: true },
      ]
    }
    case 'day.speech':
    case 'day.pkSpeech': {
      if (state.pendingActor !== playerId || !player.alive) return []
      return [{ type: 'speak', label: '发言', targetIds: [], allowNone: false }]
    }
    case 'day.vote': {
      if (!player.alive) return []
      if (round?.votes.some((v) => v.voterId === playerId)) return []
      return [{ type: 'vote', label: '放逐投票', targetIds: aliveIds, allowNone: true }]
    }
    case 'day.pkVote': {
      if (!player.alive) return []
      if (round?.votes.some((v) => v.voterId === playerId)) return []
      return [{ type: 'vote', label: 'PK 投票', targetIds: round?.candidates ?? [], allowNone: true }]
    }
    case 'day.hunterWindow': {
      if (state.pendingActor !== playerId || player.role !== 'hunter') return []
      return [
        { type: 'hunterShoot', label: '开枪', targetIds: aliveIds.filter((id) => id !== playerId), allowNone: false },
        { type: 'hunterPass', label: '憋枪', targetIds: [], allowNone: true },
      ]
    }
    case 'day.lastWords': {
      if (state.pendingActor !== playerId) return []
      return [
        { type: 'lastWords', label: '遗言', targetIds: [], allowNone: false },
        { type: 'lastWordsPass', label: '不留遗言', targetIds: [], allowNone: true },
      ]
    }
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Replay (WFR-503)
// ---------------------------------------------------------------------------

export type ReduceResult =
  | { status: 'ok'; state: WerewolfEngineState }
  | { status: 'error'; message: string }

/**
 * Rebuild the state from the event stream alone: header events (matchStarted
 * / rolesAssigned / randomnessSeed) reconstruct the initial deal, then every
 * action-anchored event replays through the engine. Determinism (NFR-W1)
 * makes the rebuilt stream byte-identical — verified in tests (AC-14/15).
 */
export function reduceEvents(events: readonly WerewolfEvent[]): ReduceResult {
  const started = events.find((e) => e.kind === 'matchStarted')
  if (!started || started.actorId !== null) {
    return { status: 'error', message: 'event stream has no matchStarted header' }
  }
  const board = started.payload.board
  const seats = [...started.payload.seats].sort((a, b) => a.seat - b.seat)
  const playerIds = seats.map((x) => x.playerId)
  const roles = new Map<string, string>()
  for (const event of events) {
    if (event.kind === 'rolesAssigned' && event.actorId !== null) {
      roles.set(event.actorId, event.payload.role)
    }
  }
  const seating = playerIds.map((id) => roles.get(id))
  if (seating.some((role) => role === undefined)) {
    return { status: 'error', message: 'event stream is missing rolesAssigned events for some seats' }
  }
  const seedEvent = events.find((e) => e.kind === 'randomnessSeed')
  const seed = seedEvent && seedEvent.kind === 'randomnessSeed' ? seedEvent.payload.seed : 0

  const created: CreateMatchResult = createMatchFromSeating({
    board,
    seating: seating as RoleId[],
    playerIds,
    seed,
  })
  if (created.status !== 'created') {
    return { status: 'error', message: `replayed board rejected: ${JSON.stringify(created.issues)}` }
  }

  let state = created.state
  for (const event of events) {
    if (!('action' in event) || event.action === undefined) continue
    const outcome = applyAction(state, event.action)
    if (outcome.status === 'rejected') {
      return {
        status: 'error',
        message: `replay diverged at seq ${event.seq}: ${outcome.rejection.code} — ${outcome.rejection.message}`,
      }
    }
    state = outcome.state
  }
  return { status: 'ok', state }
}
