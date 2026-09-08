// Werewolf engine v2 — the phase graph machine (WFR-102 / WFR-401..406).
//
// Collect-then-settle nights, explicit announcement phases, a generalised
// skip-dead-actor cascade (any phase with no living actor auto-advances —
// WFR-406-2), full PK loop (WOD-5) and chained hunter windows (WFR-404-4).
//
// All functions here mutate the *cloned* state inside `Ctx` only; the engine
// entry points clone before calling. Events are append-only with monotonic
// seq (WFR-504).

import type {
  Audience,
  DeathCause,
  DeathRecord,
  EventPayloadMap,
  NightRoleId,
  PhaseId,
  PlayerSlot,
  VoteRecord,
  WerewolfAction,
  WerewolfEngineState,
  WerewolfEvent,
  WerewolfEventKind,
} from './types'
import { makeEvent } from './events'
import { aliveByRole, alivePlayers, aliveWolves, bySeat, campOf, playerById } from './roles'
import { evaluateWin, hunterCanShoot, lastWordsEligible, aliveForWin, resolveNight } from './settlement'

export interface Ctx {
  state: WerewolfEngineState
  events: WerewolfEvent[]
}

// ---------------------------------------------------------------------------
// Event / phase primitives
// ---------------------------------------------------------------------------

export function emitEvent<K extends WerewolfEventKind>(
  ctx: Ctx,
  kind: K,
  audience: Audience,
  actorId: string | null,
  payload: EventPayloadMap[K],
  extra?: { isDefault?: boolean; action?: WerewolfAction },
): void {
  ctx.events.push(
    makeEvent({
      seq: ctx.state.nextSeq++,
      day: ctx.state.day,
      kind,
      audience,
      actorId,
      payload,
      isDefault: extra?.isDefault,
      action: extra?.action,
    }),
  )
}

/** Every phase switch emits the public phaseEntered event (WFR-502 #2). */
function setPhase(ctx: Ctx, phase: PhaseId): void {
  if (ctx.state.phase !== phase) {
    ctx.state.phase = phase
    emitEvent(ctx, 'phaseEntered', { kind: 'public' }, null, { phase })
  }
}

function setPending(ctx: Ctx, actorId: string | null): void {
  ctx.state.pendingActor = actorId
}

function winParams(state: WerewolfEngineState) {
  return {
    winCondition: state.board.winCondition,
    wolfPriority: state.board.wolfPriorityOnSimultaneousWin,
  }
}

function hunterParams(state: WerewolfEngineState) {
  return {
    hunterShootOnPoison: state.board.hunterShootOnPoison,
    hunterShootOnMilkPierce: state.board.hunterShootOnMilkPierce,
  }
}

// ---------------------------------------------------------------------------
// Cascade — the generalised dead-phase skipper (WFR-406-2)
// ---------------------------------------------------------------------------

const CASCADE_BOUND = 1000

/** Advance until the machine waits for player input or the game ends. */
export function runCascade(ctx: Ctx): void {
  let steps = 0
  while (ctx.state.phase !== 'ended') {
    if (steps++ > CASCADE_BOUND) {
      throw new Error('werewolf engine2: cascade safety bound exceeded (phase graph cycle?)')
    }
    if (!advanceOnce(ctx)) return
  }
}

function stepOfPhase(phase: PhaseId): NightRoleId | null {
  switch (phase) {
    case 'night.guard':
      return 'guard'
    case 'night.wolves':
      return 'werewolf'
    case 'night.witch.save':
    case 'night.witch.poison':
      return 'witch'
    case 'night.seer':
      return 'seer'
    default:
      return null
  }
}

function phaseForStep(step: NightRoleId): PhaseId {
  switch (step) {
    case 'guard':
      return 'night.guard'
    case 'werewolf':
      return 'night.wolves'
    case 'witch':
      return 'night.witch.save'
    case 'seer':
      return 'night.seer'
  }
}

/** One machine step; returns false when the current phase awaits input. */
function advanceOnce(ctx: Ctx): boolean {
  const s = ctx.state
  switch (s.phase) {
    case 'night.guard':
      // v1-M2 slot: boards seating a guard are rejected by board validation,
      // so this can only be reached defensively. Auto-skip keeps WFR-406-2.
      return nextNightStep(ctx)

    case 'night.wolves': {
      const night = s.night
      if (!night) return enterNight(ctx)
      const voted = new Set(night.wolfVotes.map((v) => v.voterId))
      const pending = aliveWolves(s).filter((w) => !voted.has(w.playerId))
      if (pending.length > 0) {
        setPending(ctx, pending.sort(bySeat)[0].playerId)
        return false
      }
      // WOD-3: 存活狼多数决, 平票 = 空刀.
      const tally = new Map<string | null, number>()
      for (const v of night.wolfVotes) tally.set(v.targetId, (tally.get(v.targetId) ?? 0) + 1)
      let best: string | null = null
      let bestVotes = 0
      let tie = false
      for (const [target, votes] of tally) {
        if (votes > bestVotes) {
          best = target
          bestVotes = votes
          tie = false
        } else if (votes === bestVotes) {
          tie = true
        }
      }
      const knife = tie || bestVotes === 0 ? null : best
      night.knifeTarget = knife
      emitEvent(
        ctx,
        'wolfKillAgreed',
        { kind: 'wolves' },
        null,
        {
          targetId: knife,
          tally: sortTally(s, tally),
        },
      )
      // WFR-203-2: the awake witch learns the knife target before her action.
      const witch = aliveByRole(s, 'witch')
      const witchAwake = witch !== null && (s.witchPotions.save || s.witchPotions.poison)
      if (witch && witchAwake) {
        emitEvent(
          ctx,
          'knifeTargetRevealed',
          { kind: 'role-self', playerId: witch.playerId },
          witch.playerId,
          { nightNumber: night.nightNumber, targetId: knife },
        )
      }
      return nextNightStep(ctx)
    }

    case 'night.witch.save': {
      const night = s.night
      const witch = aliveByRole(s, 'witch')
      if (!night || !witch) return nextNightStep(ctx)
      if (!s.witchPotions.save) {
        // Potion already consumed on an earlier night: question not asked.
        setPhase(ctx, 'night.witch.poison')
        return true
      }
      if (night.knifeTarget === null) {
        // 空刀: explicit auto-confirmation that no save happens.
        emitEvent(ctx, 'witchSaveDecision', { kind: 'role-self', playerId: witch.playerId }, witch.playerId, {
          used: false,
          targetId: null,
          auto: true,
          autoReason: 'no-knife-target',
        })
        setPhase(ctx, 'night.witch.poison')
        return true
      }
      setPending(ctx, witch.playerId)
      return false
    }

    case 'night.witch.poison': {
      const night = s.night
      const witch = aliveByRole(s, 'witch')
      if (!night || !witch) return nextNightStep(ctx)
      if (!s.witchPotions.poison) return nextNightStep(ctx)
      if (s.board.witchOnePotionPerNight && night.witchSaveTarget !== null) {
        emitEvent(ctx, 'witchPoisonDecision', { kind: 'role-self', playerId: witch.playerId }, witch.playerId, {
          used: false,
          targetId: null,
          auto: true,
          autoReason: 'one-potion-per-night',
        })
        return nextNightStep(ctx)
      }
      setPending(ctx, witch.playerId)
      return false
    }

    case 'night.seer': {
      const seer = aliveByRole(s, 'seer')
      if (!seer) return nextNightStep(ctx)
      setPending(ctx, seer.playerId)
      return false
    }

    case 'day.announce':
      // Transient phase — announcement already emitted by enterDay.
      return proceedAfterAnnounce(ctx)

    case 'day.hunterWindow':
      // Awaits hunterShoot / hunterPass (permission emitted on window open).
      return false

    case 'day.lastWords': {
      const queue = s.settlement?.lastWordsQueue ?? []
      if (queue.length === 0) return finishSettlement(ctx)
      setPending(ctx, queue[0])
      return false
    }

    case 'day.speech': {
      // Drop speakers who died mid-day (e.g. hunter shot) — WFR-406-2.
      while (s.speechQueue.length > 0 && playerById(s, s.speechQueue[0])?.alive !== true) {
        s.speechQueue.shift()
      }
      if (s.speechQueue.length === 0) {
        startVoteRound(ctx)
        return true
      }
      setPending(ctx, s.speechQueue[0])
      return false
    }

    case 'day.vote':
    case 'day.pkVote': {
      const round = s.voteRound
      if (!round) {
        startVoteRound(ctx)
        return true
      }
      const voted = new Set(round.votes.map((v) => v.voterId))
      const pending = alivePlayers(s)
        .slice()
        .sort(bySeat)
        .filter((p) => !voted.has(p.playerId))
      if (pending.length > 0) {
        setPending(ctx, pending[0].playerId)
        return false
      }
      return resolveVoteRound(ctx)
    }

    case 'day.pkSpeech': {
      const round = s.voteRound
      if (!round) {
        return finishSettlement(ctx) // defensive; pk always entered via vote
      }
      const queue = round.pkSpeechQueue
      if (queue.length === 0) {
        setPhase(ctx, 'day.pkVote')
        return true
      }
      setPending(ctx, queue[0])
      return false
    }

    case 'ended':
      return false
  }
}

// ---------------------------------------------------------------------------
// Night flow
// ---------------------------------------------------------------------------

export function enterNight(ctx: Ctx): boolean {
  const s = ctx.state
  if (s.outcome !== null) return false
  // WFR-406-1: 防死锁天数上限.
  if (s.day >= s.board.maxDays) {
    finalizeMatch(ctx, { winner: 'tie', basis: 'max-days-cap' })
    return true
  }

  const steps = s.board.nightActionOrder.filter((step) => nightStepHasActor(s, step))
  s.night = {
    nightNumber: s.day + 1,
    steps,
    guardTarget: null,
    wolfVotes: [],
    knifeTarget: null,
    witchSaveTarget: null,
    witchPoisonTarget: null,
    resolvedDeaths: [],
  }
  s.speechQueue = []
  s.speechTurn = 0
  s.voteRound = null
  s.settlement = null
  setPending(ctx, null)

  if (steps.length === 0) {
    // No night actor at all (WFR-406-2): settle an empty night immediately.
    return settleNight(ctx)
  }
  setPhase(ctx, phaseForStep(steps[0]))
  return true
}

function nightStepHasActor(s: WerewolfEngineState, step: NightRoleId): boolean {
  switch (step) {
    case 'guard':
      return aliveByRole(s, 'guard') !== null
    case 'werewolf':
      return aliveWolves(s).length > 0
    case 'witch': {
      const witch = aliveByRole(s, 'witch')
      return witch !== null && (s.witchPotions.save || s.witchPotions.poison)
    }
    case 'seer':
      return aliveByRole(s, 'seer') !== null
  }
}

function nextNightStep(ctx: Ctx): boolean {
  const s = ctx.state
  const night = s.night
  if (!night) return enterNight(ctx)
  const current = stepOfPhase(s.phase)
  const idx = current === null ? night.steps.length : night.steps.indexOf(current)
  const next = night.steps[idx + 1]
  if (next === undefined) return settleNight(ctx)
  setPhase(ctx, phaseForStep(next))
  return true
}

/** WFR-401: collect all night actions, then settle in one pass (WFR-402). */
function settleNight(ctx: Ctx): boolean {
  const s = ctx.state
  const night = s.night
  if (!night) return enterDay(ctx, null)

  const resolution = resolveNight(
    {
      knifeTarget: night.knifeTarget,
      guardTarget: night.guardTarget,
      witchSaveTarget: night.witchSaveTarget,
      witchPoisonTarget: night.witchPoisonTarget,
    },
    { guardSaveConflict: s.board.guardSaveConflict, guardBlocksPoison: s.board.guardBlocksPoison },
  )
  for (const death of resolution.deaths) {
    const player = playerById(s, death.playerId)
    if (!player) continue
    player.alive = false
    player.death = {
      settledDay: s.day + 1,
      time: 'night',
      nightNumber: night.nightNumber,
      causes: [...death.causes],
    }
  }
  night.resolvedDeaths = resolution.deaths
  emitEvent(ctx, 'nightSettled', { kind: 'moderator' }, null, {
    nightNumber: night.nightNumber,
    deaths: resolution.deaths.map((d) => ({ playerId: d.playerId, causes: [...d.causes] })),
    facts: resolution.facts,
  })

  const win = evaluateWin(aliveForWin(s.players), winParams(s))
  return enterDay(ctx, win.settled ? win : null)
}

// ---------------------------------------------------------------------------
// Day flow
// ---------------------------------------------------------------------------

function enterDay(ctx: Ctx, terminal: { winner: 'wolves' | 'good' | 'tie'; basis: string } | null): boolean {
  const s = ctx.state
  s.day += 1
  setPhase(ctx, 'day.announce')

  // Event #9: explicit death announcement (平安夜 / 单死 / 双死) — seats only.
  const deaths = s.night?.resolvedDeaths ?? []
  const seatSorted = deaths
    .map((d) => ({ player: playerById(s, d.playerId), causes: d.causes }))
    .filter((d): d is { player: PlayerSlot; causes: readonly DeathCause[] } => d.player !== null)
    .sort((a, b) => a.player.seat - b.player.seat)
  const kind = deaths.length === 0 ? 'peaceful' : deaths.length === 1 ? 'single' : 'double'
  emitEvent(ctx, 'deathsAnnounced', { kind: 'public' }, null, {
    kind,
    seatNumbers: seatSorted.map((d) => d.player.seat),
    ...(s.board.deathCauseRevealed ? { causes: seatSorted.map((d) => [...d.causes]) } : {}),
    ...(s.board.roleRevealedOnDeath ? { roles: seatSorted.map((d) => d.player.role) } : {}),
  })

  if (terminal) {
    finalizeMatch(ctx, terminal)
    return true
  }

  // Death settlement: hunter windows (WFR-404-1) then night-death last words.
  const windows: string[] = []
  const lastWords: string[] = []
  for (const dead of seatSorted.map((d) => d.player)) {
    if (
      dead.role === 'hunter' &&
      !s.hunterShotsUsed.includes(dead.playerId) &&
      hunterCanShoot(dead.death?.causes ?? [], hunterParams(s))
    ) {
      windows.push(dead.playerId)
    }
    if (dead.death && lastWordsEligible(dead.death, s.board.lastWordsPolicy)) {
      lastWords.push(dead.playerId)
    }
  }
  s.settlement = { hunterWindows: windows, lastWordsQueue: lastWords }
  s.postSettlement = 'speech'
  s.speechQueue = buildSpeechQueue(s)
  return true // proceedAfterAnnounce runs on the next cascade tick
}

function proceedAfterAnnounce(ctx: Ctx): boolean {
  const s = ctx.state
  const settlement = s.settlement
  if (settlement && settlement.hunterWindows.length > 0) {
    openHunterWindow(ctx)
    return false
  }
  if (settlement && settlement.lastWordsQueue.length > 0) {
    setPhase(ctx, 'day.lastWords')
    setPending(ctx, settlement.lastWordsQueue[0])
    return false
  }
  s.settlement = null
  if (s.postSettlement === 'night') {
    return enterNight(ctx)
  }
  setPhase(ctx, 'day.speech')
  return true
}

function openHunterWindow(ctx: Ctx): void {
  const s = ctx.state
  const hunterId = s.settlement?.hunterWindows[0]
  if (!hunterId) return
  setPhase(ctx, 'day.hunterWindow')
  setPending(ctx, hunterId)
  // Event #10: private permission — emitted only when shooting is possible
  // (a poisoned hunter gets no event at all, AC-4).
  emitEvent(ctx, 'hunterShootPermission', { kind: 'role-self', playerId: hunterId }, hunterId, {
    canShoot: true,
  })
}

function finishSettlement(ctx: Ctx): boolean {
  const s = ctx.state
  s.settlement = null
  setPending(ctx, null)
  if (s.postSettlement === 'night') return enterNight(ctx)
  setPhase(ctx, 'day.speech')
  return true
}

/**
 * WFR-403 / param 13: speech order.
 *  - seat: always seat-ascending from seat 1.
 *  - from-dead-next: from the seat after the lowest-seat fresh night death;
 *    peaceful days (and day 1) fall back to day1StartSeat (WOD-7).
 */
function buildSpeechQueue(s: WerewolfEngineState): string[] {
  const alive = alivePlayers(s).slice().sort(bySeat)
  if (alive.length === 0) return []
  const totalSeats = s.players.length
  let startSeat: number
  if (s.board.speechOrderPolicy === 'seat') {
    startSeat = 1
  } else {
    const freshDead = s.players.filter(
      (p) => !p.alive && p.death !== null && p.death.settledDay === s.day && p.death.time === 'night',
    )
    const lowestDeadSeat = freshDead.length > 0 ? Math.min(...freshDead.map((p) => p.seat)) : null
    startSeat = lowestDeadSeat === null ? s.board.day1StartSeat : (lowestDeadSeat % totalSeats) + 1
  }
  const dist = (seat: number): number => (seat - startSeat + totalSeats) % totalSeats
  return alive.sort((a, b) => dist(a.seat) - dist(b.seat)).map((p) => p.playerId)
}

// ---------------------------------------------------------------------------
// Voting (WFR-403 / params 6-7 / WOD-5)
// ---------------------------------------------------------------------------

function startVoteRound(ctx: Ctx): void {
  ctx.state.voteRound = { round: 'main', candidates: null, votes: [], pkSpeechQueue: [] }
  setPhase(ctx, 'day.vote')
  setPending(ctx, null)
}

function sortTally(
  s: WerewolfEngineState,
  tally: ReadonlyMap<string | null, number>,
): Array<{ targetId: string | null; votes: number }> {
  const seatOf = (id: string): number => playerById(s, id)?.seat ?? Number.MAX_SAFE_INTEGER
  return [...tally.entries()]
    .sort((a, b) => {
      const aSeat = a[0] === null ? Number.MAX_SAFE_INTEGER : seatOf(a[0])
      const bSeat = b[0] === null ? Number.MAX_SAFE_INTEGER : seatOf(b[0])
      return aSeat - bSeat
    })
    .map(([targetId, votes]) => ({ targetId, votes }))
}

function resolveVoteRound(ctx: Ctx): boolean {
  const s = ctx.state
  const round = s.voteRound
  if (!round) return finishDay(ctx)

  const tally = new Map<string, number>()
  let abstain = 0
  for (const v of round.votes) {
    if (v.targetId === null) {
      abstain += v.weight
      continue
    }
    tally.set(v.targetId, (tally.get(v.targetId) ?? 0) + v.weight)
  }
  const cast = round.votes
    .filter((v) => v.targetId !== null)
    .reduce((sum, v) => sum + v.weight, 0)

  let exiled: string | null = null
  let outcome: 'exile' | 'tie-pk' | 'no-exile' | 'no-exile-after-pk' | 'no-majority'
  const leaders = leadersOf(tally)

  if (s.board.voteRule === 'majority') {
    const top = leaders[0]
    exiled = top !== undefined && top.votes > cast / 2 ? top.targetId : null
    outcome = exiled !== null ? 'exile' : 'no-majority'
  } else {
    if (leaders.length === 1 && leaders[0].votes > 0) {
      exiled = leaders[0].targetId
      outcome = 'exile'
    } else if (leaders.length > 1 && round.round === 'main' && s.board.voteTiePolicy === 'pk-revote-then-nobody') {
      outcome = 'tie-pk'
    } else if (round.round === 'pk') {
      outcome = 'no-exile-after-pk'
    } else {
      outcome = 'no-exile'
    }
  }

  const fullTally = sortTally(s, tally)
  if (abstain > 0 || fullTally.length === 0) fullTally.push({ targetId: null, votes: abstain })
  emitEvent(ctx, 'voteResult', { kind: 'public' }, null, {
    round: round.round,
    tally: fullTally,
    outcome,
    ...(exiled !== null ? { exiledId: exiled } : {}),
  })

  if (exiled !== null) return applyExile(ctx, exiled)
  if (outcome === 'tie-pk') {
    const candidates = leaders.map((l) => l.targetId)
    const byPlayerSeat = (id: string): number => playerById(s, id)?.seat ?? 0
    candidates.sort((a, b) => byPlayerSeat(a) - byPlayerSeat(b))
    s.voteRound = {
      round: 'pk',
      candidates,
      votes: [],
      pkSpeechQueue: [...candidates], // WOD-5: PK speeches in seat order
    }
    setPhase(ctx, 'day.pkSpeech')
    return true
  }
  return finishDay(ctx)
}

function leadersOf(tally: ReadonlyMap<string, number>): Array<{ targetId: string; votes: number }> {
  let max = 0
  for (const votes of tally.values()) max = Math.max(max, votes)
  const leaders: Array<{ targetId: string; votes: number }> = []
  for (const [targetId, votes] of tally) {
    if (votes === max && max > 0) leaders.push({ targetId, votes })
  }
  return leaders
}

/** Day is over with nobody exiled → night. */
function finishDay(ctx: Ctx): boolean {
  ctx.state.voteRound = null
  ctx.state.postSettlement = 'night'
  return enterNight(ctx)
}

// ---------------------------------------------------------------------------
// Death settlements (WFR-404)
// ---------------------------------------------------------------------------

function applyExile(ctx: Ctx, playerId: string): boolean {
  const s = ctx.state
  const player = playerById(s, playerId)
  if (!player) return finishDay(ctx)
  player.alive = false
  player.death = { settledDay: s.day, time: 'day', nightNumber: 0, causes: ['exile'] }

  // WFR-404-4: evaluate the terminal state after every death settlement.
  const win = evaluateWin(aliveForWin(s.players), winParams(s))
  if (win.settled) {
    finalizeMatch(ctx, win)
    return true
  }

  const windows: string[] = []
  if (
    player.role === 'hunter' &&
    !s.hunterShotsUsed.includes(playerId) &&
    hunterCanShoot(player.death.causes, hunterParams(s))
  ) {
    windows.push(playerId)
  }
  const lastWords: string[] = lastWordsEligible(player.death, s.board.lastWordsPolicy)
    ? [playerId]
    : []
  s.settlement = { hunterWindows: windows, lastWordsQueue: lastWords }
  s.postSettlement = 'night'
  s.voteRound = null

  if (windows.length > 0) {
    openHunterWindow(ctx)
    return false
  }
  if (lastWords.length > 0) {
    setPhase(ctx, 'day.lastWords')
    setPending(ctx, lastWords[0])
    return false
  }
  return finishDay(ctx)
}

/** WFR-404: hunter fires; the target's death time syncs with the hunter's. */
export function applyHunterShot(
  ctx: Ctx,
  hunterId: string,
  targetId: string,
  extra?: { action?: WerewolfAction; isDefault?: boolean },
): void {
  const s = ctx.state
  const hunter = playerById(s, hunterId)
  const target = playerById(s, targetId)
  if (!hunter || !target) return

  const settlement = s.settlement
  if (settlement && settlement.hunterWindows[0] === hunterId) settlement.hunterWindows.shift()
  s.hunterShotsUsed.push(hunterId)

  const hunterDeath = hunter.death
  const death: DeathRecord = {
    settledDay: s.day,
    time: hunterDeath?.time ?? 'day',
    nightNumber: hunterDeath?.time === 'night' ? hunterDeath.nightNumber : 0,
    causes: ['shot'],
  }
  target.alive = false
  target.death = death
  emitEvent(ctx, 'hunterShot', { kind: 'public' }, hunterId, { hunterId, targetId }, extra)

  const win = evaluateWin(aliveForWin(s.players), winParams(s))
  if (win.settled) {
    finalizeMatch(ctx, win)
    return
  }

  // WFR-404-4: chained settlement — a shot hunter opens a window, an eligible
  // target joins the last-words queue.
  if (settlement) {
    if (
      target.role === 'hunter' &&
      !s.hunterShotsUsed.includes(targetId) &&
      hunterCanShoot(death.causes, hunterParams(s))
    ) {
      settlement.hunterWindows.unshift(targetId)
    }
    if (lastWordsEligible(death, s.board.lastWordsPolicy)) {
      settlement.lastWordsQueue.push(targetId)
    }
    continueSettlement(ctx)
  }
}

/** Move to the next pending settlement slot (window / last words / resume). */
export function continueSettlement(ctx: Ctx): void {
  const s = ctx.state
  const settlement = s.settlement
  if (!settlement) return
  if (settlement.hunterWindows.length > 0) {
    openHunterWindow(ctx)
    return
  }
  if (settlement.lastWordsQueue.length > 0) {
    setPhase(ctx, 'day.lastWords')
    setPending(ctx, settlement.lastWordsQueue[0])
    return
  }
  finishSettlement(ctx)
}

// ---------------------------------------------------------------------------
// Termination (WFR-405 / WFR-502 #19)
// ---------------------------------------------------------------------------

export function finalizeMatch(
  ctx: Ctx,
  outcome: { winner: 'wolves' | 'good' | 'tie'; basis: string },
): void {
  const s = ctx.state
  s.outcome = { winner: outcome.winner, basis: outcome.basis }
  setPending(ctx, null)
  s.voteRound = null
  setPhase(ctx, 'ended')
  emitEvent(ctx, 'gameEnded', { kind: 'public' }, null, {
    winner: outcome.winner,
    basis: outcome.basis,
    reveal: s.players.map((p) => ({
      playerId: p.playerId,
      seat: p.seat,
      role: p.role,
      death: p.death,
    })),
  })
}

// ---------------------------------------------------------------------------
// Action application (called by the engine after validation)
// ---------------------------------------------------------------------------

export function applyActionToCtx(ctx: Ctx, action: WerewolfAction, isDefault: boolean): void {
  const s = ctx.state
  const extra = { action, isDefault: isDefault || undefined }
  switch (action.type) {
    case 'kill': {
      const night = s.night
      if (night) night.wolfVotes.push({ voterId: action.actorId, targetId: action.targetId })
      emitEvent(ctx, 'wolfKillVote', { kind: 'wolves' }, action.actorId, { targetId: action.targetId }, extra)
      break
    }

    case 'seerCheck': {
      const target = playerById(s, action.targetId)
      // WFR-203-3: binary result only — 好人 / 狼人, never the exact role.
      const result = target && campOf(target.role) === 'wolf' ? 'werewolf' : 'good'
      emitEvent(
        ctx,
        'seerChecked',
        { kind: 'role-self', playerId: action.actorId },
        action.actorId,
        { targetId: action.targetId, result },
        extra,
      )
      nextNightStep(ctx)
      break
    }

    case 'seerPass': {
      emitEvent(
        ctx,
        'seerSkipped',
        { kind: 'role-self', playerId: action.actorId },
        action.actorId,
        { nightNumber: s.night?.nightNumber ?? 0 },
        extra,
      )
      nextNightStep(ctx)
      break
    }

    case 'witchSave': {
      const night = s.night
      if (night) {
        night.witchSaveTarget = action.targetId
        s.witchPotions.save = false
      }
      emitEvent(
        ctx,
        'witchSaveDecision',
        { kind: 'role-self', playerId: action.actorId },
        action.actorId,
        { used: true, targetId: action.targetId, auto: false, autoReason: null },
        extra,
      )
      setPhase(ctx, 'night.witch.poison')
      break
    }

    case 'witchSavePass': {
      const night = s.night
      emitEvent(
        ctx,
        'witchSaveDecision',
        { kind: 'role-self', playerId: action.actorId },
        action.actorId,
        { used: false, targetId: night?.knifeTarget ?? null, auto: false, autoReason: null },
        extra,
      )
      setPhase(ctx, 'night.witch.poison')
      break
    }

    case 'witchPoison': {
      const night = s.night
      if (night) {
        night.witchPoisonTarget = action.targetId
        s.witchPotions.poison = false
      }
      emitEvent(
        ctx,
        'witchPoisonDecision',
        { kind: 'role-self', playerId: action.actorId },
        action.actorId,
        { used: true, targetId: action.targetId, auto: false, autoReason: null },
        extra,
      )
      nextNightStep(ctx)
      break
    }

    case 'witchPoisonPass': {
      emitEvent(
        ctx,
        'witchPoisonDecision',
        { kind: 'role-self', playerId: action.actorId },
        action.actorId,
        { used: false, targetId: null, auto: false, autoReason: null },
        extra,
      )
      nextNightStep(ctx)
      break
    }

    case 'speak': {
      s.speechTurn += 1
      const queue = s.speechQueue
      if (queue[0] === action.actorId) queue.shift()
      if (s.phase === 'day.pkSpeech') {
        const round = s.voteRound
        if (round && round.pkSpeechQueue[0] === action.actorId) round.pkSpeechQueue.shift()
      }
      emitEvent(
        ctx,
        'speech',
        { kind: 'public' },
        action.actorId,
        { playerId: action.actorId, content: action.content, order: s.speechTurn },
        extra,
      )
      while (queue.length > 0 && playerById(s, queue[0])?.alive !== true) queue.shift()
      setPending(ctx, queue[0] ?? null)
      break
    }

    case 'vote': {
      const round = s.voteRound
      if (round) {
        const record: VoteRecord = {
          voterId: action.actorId,
          targetId: action.targetId,
          weight: voteWeightOf(s, action.actorId),
        }
        round.votes.push(record)
        emitEvent(
          ctx,
          'voteCast',
          { kind: 'public' },
          action.actorId,
          { round: round.round, voterId: record.voterId, targetId: record.targetId, weight: record.weight },
          extra,
        )
      }
      break
    }

    case 'hunterShoot': {
      applyHunterShot(ctx, action.actorId, action.targetId, extra)
      break
    }

    case 'hunterPass': {
      const settlement = s.settlement
      if (settlement && settlement.hunterWindows[0] === action.actorId) settlement.hunterWindows.shift()
      emitEvent(
        ctx,
        'hunterDeclined',
        { kind: 'role-self', playerId: action.actorId },
        action.actorId,
        { hunterId: action.actorId },
        extra,
      )
      continueSettlement(ctx)
      break
    }

    case 'lastWords': {
      const settlement = s.settlement
      if (settlement && settlement.lastWordsQueue[0] === action.actorId) settlement.lastWordsQueue.shift()
      emitEvent(
        ctx,
        'lastWords',
        { kind: 'public' },
        action.actorId,
        { playerId: action.actorId, content: action.content },
        extra,
      )
      continueSettlement(ctx)
      break
    }

    case 'lastWordsPass': {
      const settlement = s.settlement
      if (settlement && settlement.lastWordsQueue[0] === action.actorId) settlement.lastWordsQueue.shift()
      emitEvent(
        ctx,
        'lastWords',
        { kind: 'public' },
        action.actorId,
        { playerId: action.actorId, content: null },
        extra,
      )
      continueSettlement(ctx)
      break
    }
  }
}

/** M1: everyone votes weight 1; sheriff weighting is the v1-M2 slot (param 23). */
function voteWeightOf(_state: WerewolfEngineState, _voterId: string): number {
  return 1
}
