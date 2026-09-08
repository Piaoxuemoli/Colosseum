// Night flow: collect-then-settle, witch two-question protocol, seer checks,
// wolf deliberation (WOD-3) and the skip-dead cascade (WFR-102/401/402,
// AC-1/2/3/7/16).

import { describe, expect, it } from 'vitest'
import {
  applyAction,
  availableActions,
  normalizeAction,
} from '@/games/werewolf/engine2'
import type { WerewolfAction } from '@/games/werewolf/engine2'
import {
  SEATING_6,
  SEATING_9,
  dayCycle,
  evOf,
  evsOf,
  fail,
  killVote,
  seerCheck,
  speakAll,
  start6,
  start9,
  step,
  witchPoisonPass,
  witchSavePass,
} from './_helpers'

describe('AC-1: wolf kill + witch save → peaceful dawn', () => {
  it('announces 平安夜 and records the save + auto-confirmed second question', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3')
    step(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p3' })
    seerCheck(acc, 'p1')

    const announce = evOf(acc.events, 'deathsAnnounced')
    expect(announce.payload.kind).toBe('peaceful')
    expect(announce.payload.seatNumbers).toEqual([])
    expect(announce.audience).toEqual({ kind: 'public' })

    const save = evOf(acc.events, 'witchSaveDecision')
    expect(save.payload.used).toBe(true)
    expect(save.payload.targetId).toBe('p3')
    expect(save.payload.auto).toBe(false)

    // Second question auto-answered "no" via param 5 (identifiable).
    const poison = evOf(acc.events, 'witchPoisonDecision')
    expect(poison.payload.used).toBe(false)
    expect(poison.payload.auto).toBe(true)
    expect(poison.payload.autoReason).toBe('one-potion-per-night')

    expect(acc.state.day).toBe(1)
    expect(acc.state.phase).toBe('day.speech')
    // Moderator sees the settlement fact; players do not (checked in visibility tests).
    expect(evOf(acc.events, 'nightSettled').audience).toEqual({ kind: 'moderator' })
  })
})

describe('AC-2: one potion per night (param 5)', () => {
  it('rejects the second potion after the save with PARAM_CONFLICT', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3')
    step(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p3' })
    const rejection = fail(acc, { type: 'witchPoison', actorId: 'p4', targetId: 'p5' })
    expect(rejection.code).toBe('PARAM_CONFLICT')
    expect(rejection.message).toContain('witchOnePotionPerNight')
    // No state side effects from the rejected action.
    expect(acc.state.witchPotions.poison).toBe(true)
  })

  it('rejects the save after the poison question has resolved (reverse order)', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3')
    witchSavePass(acc)
    step(acc, { type: 'witchPoison', actorId: 'p4', targetId: 'p5' })
    const rejection = fail(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p3' })
    expect(rejection.code).toBe('WRONG_PHASE')
  })

  it('allows both potions in one night when param 5 is off', () => {
    const acc = start6(SEATING_6, { witchOnePotionPerNight: false })
    killVote(acc, 'p3')
    step(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p3' })
    // Poison question stays open after the save.
    expect(acc.state.phase).toBe('night.witch.poison')
    step(acc, { type: 'witchPoison', actorId: 'p4', targetId: 'p5' })
    seerCheck(acc, 'p1')
    const announce = evOf(acc.events, 'deathsAnnounced')
    expect(announce.payload.kind).toBe('single')
    expect(announce.payload.seatNumbers).toEqual([5])
  })
})

describe('AC-3: knife-target reveal precedes every witch decision', () => {
  it('delivers a role-self reveal event before the save decision', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3')
    const reveal = evOf(acc.events, 'knifeTargetRevealed')
    expect(reveal.audience).toEqual({ kind: 'role-self', playerId: 'p4' })
    expect(reveal.payload.targetId).toBe('p3')
    witchSavePass(acc)
    const save = evOf(acc.events, 'witchSaveDecision')
    expect(reveal.seq).toBeLessThan(save.seq)
  })

  it('reveals targetId null on 空刀 and auto-confirms "no save"', () => {
    const acc = start6(SEATING_6)
    killVote(acc, null)
    const reveal = evOf(acc.events, 'knifeTargetRevealed')
    expect(reveal.payload.targetId).toBeNull()
    const save = evOf(acc.events, 'witchSaveDecision')
    expect(save.payload.auto).toBe(true)
    expect(save.payload.autoReason).toBe('no-knife-target')
    // Poison stays usable on an empty-kill night.
    expect(acc.state.phase).toBe('night.witch.poison')
    step(acc, { type: 'witchPoison', actorId: 'p4', targetId: 'p5' })
    seerCheck(acc, 'p1')
    expect(evOf(acc.events, 'deathsAnnounced').payload.seatNumbers).toEqual([5])
  })

  it('every witch decision event in a longer game is preceded by a reveal to her', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p6')
    dayCycle(acc, [
      ['p1', null], ['p2', null], ['p4', null], ['p5', null], ['p6', null],
    ])
    killVote(acc, 'p5')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    const reveals = evsOf(acc.events, 'knifeTargetRevealed')
    const decisions = [
      ...evsOf(acc.events, 'witchSaveDecision'),
      ...evsOf(acc.events, 'witchPoisonDecision'),
    ]
    expect(decisions.length).toBeGreaterThanOrEqual(4)
    for (const decision of decisions) {
      expect(
        reveals.some((r) => r.seq < decision.seq && r.payload.nightNumber === decision.day + 1),
      ).toBe(true)
    }
  })
})

describe('AC-7: seer checks are binary and private', () => {
  it('returns only good/werewolf, visible to the seer alone, and rejects self-checks', () => {
    const acc = start9(SEATING_9)
    // Night 1: check a wolf.
    killVote(acc, 'p4')
    witchSavePass(acc)
    witchPoisonPass(acc)
    step(acc, { type: 'seerCheck', actorId: 'p1', targetId: 'p7' })
    // Day 1 passes without an exile.
    dayCycle(acc, [
      ['p1', null], ['p2', null], ['p3', null], ['p5', null], ['p6', null],
      ['p7', null], ['p8', null], ['p9', null],
    ])
    // Night 2: self-check rejected, then check a villager.
    killVote(acc, null)
    witchPoisonPass(acc)
    const rejection = fail(acc, { type: 'seerCheck', actorId: 'p1', targetId: 'p1' })
    expect(rejection.code).toBe('ILLEGAL_TARGET')
    expect(rejection.message).toContain('itself')
    step(acc, { type: 'seerCheck', actorId: 'p1', targetId: 'p5' })

    const checks = evsOf(acc.events, 'seerChecked')
    expect(checks.map((c) => c.payload)).toEqual([
      { targetId: 'p7', result: 'werewolf' },
      { targetId: 'p5', result: 'good' },
    ])
    expect(checks[0].audience).toEqual({ kind: 'role-self', playerId: 'p1' })
    for (const check of checks) {
      expect(Object.keys(check.payload).sort()).toEqual(['result', 'targetId'])
    }
  })
})

describe('AC-16: wolf deliberation — majority, tie = 空刀', () => {
  it('split wolves (1-1) produce 空刀 and a peaceful night', () => {
    const acc = start6(SEATING_6)
    step(acc, { type: 'kill', actorId: 'p1', targetId: 'p5' })
    step(acc, { type: 'kill', actorId: 'p2', targetId: 'p6' })
    const agreed = evOf(acc.events, 'wolfKillAgreed')
    expect(agreed.payload.targetId).toBeNull()
    expect(agreed.audience).toEqual({ kind: 'wolves' })
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p1')
    expect(evOf(acc.events, 'deathsAnnounced').payload.kind).toBe('peaceful')
  })

  it('3-wolf majority (2-1) selects the majority target', () => {
    const acc = start9(SEATING_9)
    step(acc, { type: 'kill', actorId: 'p7', targetId: 'p4' })
    step(acc, { type: 'kill', actorId: 'p8', targetId: 'p4' })
    step(acc, { type: 'kill', actorId: 'p9', targetId: 'p5' })
    const agreed = evOf(acc.events, 'wolfKillAgreed')
    expect(agreed.payload.targetId).toBe('p4')
    expect(agreed.payload.tally).toEqual([
      { targetId: 'p4', votes: 2 },
      { targetId: 'p5', votes: 1 },
    ])
  })

  it('rejects an explicit 空刀 vote when param 11 is off', () => {
    const acc = start6(SEATING_6, { emptyKillAllowed: false })
    const rejection = fail(acc, { type: 'kill', actorId: 'p1', targetId: null })
    expect(rejection.code).toBe('PARAM_CONFLICT')
  })

  it('rejects self-kill when param 12 is off', () => {
    const acc = start6(SEATING_6, { selfKillAllowed: false })
    const rejection = fail(acc, { type: 'kill', actorId: 'p1', targetId: 'p1' })
    expect(rejection.code).toBe('PARAM_CONFLICT')
  })

  it('rejects dead targets, double votes and non-wolf voters', () => {
    const acc = start6(SEATING_6)
    step(acc, { type: 'kill', actorId: 'p1', targetId: 'p3' })
    expect(fail(acc, { type: 'kill', actorId: 'p1', targetId: 'p3' }).code).toBe('EXHAUSTED')
    expect(fail(acc, { type: 'kill', actorId: 'p3', targetId: 'p5' }).code).toBe('WRONG_ACTOR')
    // Complete night 1 (p3 knifed) so a dead target exists on night 2.
    step(acc, { type: 'kill', actorId: 'p2', targetId: 'p3' })
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    dayCycle(acc, [
      ['p1', null], ['p2', null], ['p4', null], ['p5', null], ['p6', null],
    ])
    expect(fail(acc, { type: 'kill', actorId: 'p1', targetId: 'p3' }).code).toBe('ILLEGAL_TARGET')
  })
})

describe('witch rulings (param 4 self-save, targets)', () => {
  it('first-night self-save is allowed under first-night-only (WOD-1 default)', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p4')
    step(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p4' })
    expect(acc.state.witchPotions.save).toBe(false)
  })

  it('later-night self-save is rejected under first-night-only', () => {
    const acc = start6(SEATING_6)
    // Night 1: keep the save potion.
    killVote(acc, 'p3')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    dayCycle(acc, [
      ['p1', null], ['p2', null], ['p4', null], ['p5', null], ['p6', null],
    ])
    expect(acc.state.phase).toBe('night.wolves')
    killVote(acc, 'p4')
    const rejection = fail(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p4' })
    expect(rejection.code).toBe('PARAM_CONFLICT')
    expect(rejection.message).toContain('first-night-only')
  })

  it('"never" policy rejects even the first-night self-save', () => {
    const acc = start6(SEATING_6, { witchSelfSavePolicy: 'never' })
    killVote(acc, 'p4')
    expect(fail(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p4' }).code).toBe('PARAM_CONFLICT')
  })

  it('"always" policy allows the later-night self-save', () => {
    const acc = start6(SEATING_6, { witchSelfSavePolicy: 'always' })
    killVote(acc, 'p3')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    dayCycle(acc, [
      ['p1', null], ['p2', null], ['p4', null], ['p5', null], ['p6', null],
    ])
    killVote(acc, 'p4')
    step(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p4' })
    seerCheck(acc, 'p5')
    expect(evOf(acc.events, 'deathsAnnounced').payload.kind).toBe('peaceful')
  })

  it('the save must target the knife target; the poison cannot target the witch', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3')
    expect(fail(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p5' }).code).toBe('ILLEGAL_TARGET')
    witchSavePass(acc)
    expect(fail(acc, { type: 'witchPoison', actorId: 'p4', targetId: 'p4' }).code).toBe('ILLEGAL_TARGET')
  })

  it('skips consumed questions: no save question after the potion is gone; witch asleep once both are used', () => {
    const acc = start9(SEATING_9, { witchOnePotionPerNight: false })
    // n1: save the knife target AND burn the poison the same night.
    killVote(acc, 'p4')
    step(acc, { type: 'witchSave', actorId: 'p2', targetId: 'p4' })
    step(acc, { type: 'witchPoison', actorId: 'p2', targetId: 'p5' })
    seerCheck(acc, 'p6')
    expect(evOf(acc.events, 'deathsAnnounced').payload.seatNumbers).toEqual([5])
    // Day passes without an exile.
    dayCycle(acc, [
      ['p1', null], ['p2', null], ['p3', null], ['p4', null], ['p6', null],
      ['p7', null], ['p8', null], ['p9', null],
    ])
    // n2: save potion gone → save question skipped, poison gone → witch asleep.
    killVote(acc, 'p6')
    expect(acc.state.phase).toBe('night.seer')
    expect(evsOf(acc.events, 'witchSaveDecision')).toHaveLength(1)
    expect(evsOf(acc.events, 'witchPoisonDecision')).toHaveLength(1)
    expect(evsOf(acc.events, 'knifeTargetRevealed')).toHaveLength(1) // night 1 only
  })
})

describe('WFR-102: order independence and skip cascade', () => {
  it('two legal night orders with the same action set settle identically', () => {
    type NightOrder = Array<'guard' | 'werewolf' | 'witch' | 'seer'>
    const run = (order: NightOrder) => {
      const acc = start6(SEATING_6, { nightActionOrder: order })
      killVote(acc, 'p3')
      if (order.indexOf('seer') < order.indexOf('witch')) {
        seerCheck(acc, 'p5')
        witchSavePass(acc)
        witchPoisonPass(acc)
      } else {
        witchSavePass(acc)
        witchPoisonPass(acc)
        seerCheck(acc, 'p5')
      }
      return acc
    }
    const a = run(['guard', 'werewolf', 'witch', 'seer'])
    const b = run(['werewolf', 'seer', 'witch'])
    const announceA = evOf(a.events, 'deathsAnnounced').payload
    const announceB = evOf(b.events, 'deathsAnnounced').payload
    expect(announceB).toEqual(announceA)
    expect(b.state.players.map((p) => p.alive)).toEqual(a.state.players.map((p) => p.alive))
    expect(b.state.day).toEqual(a.state.day)
    expect(b.state.phase).toEqual(a.state.phase)
  })

  it('a dead seer leaves no seer-phase trace the following night (WFR-102-2)', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p1') // seer knifed night 1
    witchSavePass(acc)
    witchPoisonPass(acc)
    // Seer still acts on night 1 (alive until settlement).
    seerCheck(acc, 'p4')
    dayCycle(acc, [
      ['p2', null], ['p3', null], ['p4', null], ['p5', null], ['p6', null],
      ['p7', null], ['p8', null], ['p9', null],
    ])
    killVote(acc, 'p2')
    witchSavePass(acc)
    witchPoisonPass(acc)
    const seerPhases = evsOf(acc.events, 'phaseEntered').filter((e) => e.payload.phase === 'night.seer')
    expect(seerPhases).toHaveLength(1) // night 1 only
  })

  it('a potionless witch is not woken: no witch phase, no knife reveal', () => {
    const acc = start6(SEATING_6, { witchOnePotionPerNight: false })
    // Night 1: burn both potions.
    killVote(acc, 'p3')
    step(acc, { type: 'witchSave', actorId: 'p4', targetId: 'p3' })
    step(acc, { type: 'witchPoison', actorId: 'p4', targetId: 'p5' })
    seerCheck(acc, 'p1')
    expect(evOf(acc.events, 'deathsAnnounced').payload.seatNumbers).toEqual([5])
    speakAll(acc)
    for (const v of ['p1', 'p2', 'p3', 'p4', 'p6']) {
      step(acc, { type: 'vote', actorId: v, targetId: null })
    }
    killVote(acc, 'p6')
    const witchPhases = evsOf(acc.events, 'phaseEntered').filter((e) =>
      e.payload.phase.startsWith('night.witch'),
    )
    expect(witchPhases).toHaveLength(2) // save + poison on night 1 only
    expect(evsOf(acc.events, 'knifeTargetRevealed')).toHaveLength(1)
    // Night 2 walks wolves → seer directly.
    expect(acc.state.phase).toBe('night.seer')
  })
})

describe('action contract surface (WFR-303) and parsing (WFR-302)', () => {
  it('exposes the kill option to unvoted wolves only, with 空刀 allowed', () => {
    const acc = start6(SEATING_6)
    expect(availableActions(acc.state, 'p1')).toEqual([
      { type: 'kill', label: '狼刀投票', targetIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], allowNone: true },
    ])
    expect(availableActions(acc.state, 'p3')).toEqual([])
    step(acc, { type: 'kill', actorId: 'p1', targetId: 'p3' })
    expect(availableActions(acc.state, 'p1')).toEqual([])
    expect(availableActions(acc.state, 'p2')[0].allowNone).toBe(true)
  })

  it('exposes witch options scoped to the knife target', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3')
    expect(availableActions(acc.state, 'p4')).toEqual([
      { type: 'witchSave', label: '用解药', targetIds: ['p3'], allowNone: false },
      { type: 'witchSavePass', label: '不用解药', targetIds: [], allowNone: true },
    ])
    expect(availableActions(acc.state, 'p5')).toEqual([])
  })

  it('malformed actions are structured UNPARSEABLE rejections, not exceptions', () => {
    const acc = start6(SEATING_6)
    const outcome = applyAction(acc.state, { type: 'explode', actorId: 'p1' } as unknown as WerewolfAction)
    expect(outcome.status).toBe('rejected')
    if (outcome.status === 'rejected') expect(outcome.rejection.code).toBe('UNPARSEABLE')
    expect(normalizeAction({ type: 'vote' }).ok).toBe(false)
    expect(normalizeAction({ type: 'vote', actorId: 'p1', targetId: null }).ok).toBe(true)
  })
})
