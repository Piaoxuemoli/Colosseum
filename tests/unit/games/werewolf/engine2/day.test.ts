// Day flow: explicit announcements (WFR-102-3), last-words matrix (WFR-105),
// hunter windows (WFR-404), vote + PK loop (WFR-403, WOD-5), speech order
// (param 13 / WOD-7) and day-side validation. AC-5/6/8/12 + budget rules.

import { describe, expect, it } from 'vitest'
import { availableActions } from '@/games/werewolf/engine2'
import {
  SEATING_6,
  SEATING_9,
  evOf,
  evsOf,
  fail,
  hunterPass,
  hunterShoot,
  killVote,
  player,
  seerCheck,
  settleLastWords,
  speakAll,
  speechOrderOfDay,
  start6,
  start9,
  step,
  witchPoisonPass,
  witchSavePass,
} from './_helpers'

/** Board A night where the wolves knife `target` and the witch passes. */
function quietNight(acc: Parameters<typeof killVote>[0], target: string | null): void {
  killVote(acc, target)
  witchSavePass(acc)
  witchPoisonPass(acc)
  seerCheck(acc, 'p5')
}

describe('AC-12: death announcements', () => {
  it('empty kill → explicit 平安夜 announcement in an explicit announce phase', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, null)
    const announce = evOf(acc.events, 'deathsAnnounced')
    expect(announce.payload).toEqual({ kind: 'peaceful', seatNumbers: [] })
    expect(Object.keys(announce.payload).sort()).toEqual(['kind', 'seatNumbers'])
    const phases = evsOf(acc.events, 'phaseEntered').map((e) => e.payload.phase)
    expect(phases).toContain('day.announce')
  })

  it('single death announces seat only — no cause, no role (params 9/10 default)', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, 'p3')
    const announce = evOf(acc.events, 'deathsAnnounced')
    expect(announce.payload.kind).toBe('single')
    expect(announce.payload.seatNumbers).toEqual([3])
    expect(Object.keys(announce.payload).sort()).toEqual(['kind', 'seatNumbers'])
  })

  it('double death announces both seats ascending without cause', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p6')
    witchSavePass(acc)
    step(acc, { type: 'witchPoison', actorId: 'p4', targetId: 'p3' })
    seerCheck(acc, 'p5')
    const announce = evOf(acc.events, 'deathsAnnounced')
    expect(announce.payload.kind).toBe('double')
    expect(announce.payload.seatNumbers).toEqual([3, 6])
    expect(announce.payload.causes).toBeUndefined()
  })

  it('params 9/10 on: announcements carry causes and roles (config-driven)', () => {
    const acc = start6(SEATING_6, { deathCauseRevealed: true, roleRevealedOnDeath: true })
    quietNight(acc, 'p3')
    const announce = evOf(acc.events, 'deathsAnnounced')
    expect(announce.payload.causes).toEqual([['wolf-kill']])
    expect(announce.payload.roles).toEqual(['seer'])
  })
})

describe('AC-6: last-words matrix through real scenarios', () => {
  it('first-night knife death gets last words, announced before speeches', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, 'p5')
    settleLastWords(acc, 'lw-p5')
    speakAll(acc)
    const lastWords = evsOf(acc.events, 'lastWords')
    expect(lastWords.map((e) => e.payload.playerId)).toEqual(['p5'])
    expect(lastWords[0].payload.content).toBe('lw-p5')
    expect(lastWords[0].audience).toEqual({ kind: 'public' })
    expect(evOf(acc.events, 'deathsAnnounced').seq).toBeLessThan(lastWords[0].seq)
    expect(lastWords[0].seq).toBeLessThan(evsOf(acc.events, 'speech')[0].seq)
  })

  it('second-night knife death gets no last words', () => {
    const acc = start9(SEATING_9)
    quietNight9(acc, 'p6')
    settleLastWords(acc)
    speakAll(acc)
    for (const v of ['p1', 'p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9']) {
      step(acc, { type: 'vote', actorId: v, targetId: null })
    }
    quietNight9(acc, 'p5')
    // p6 (first-night knife) spoke on day 1; p5 (night-2 knife) does not.
    const lastWords = evsOf(acc.events, 'lastWords')
    expect(lastWords.map((e) => e.payload.playerId)).toEqual(['p6'])
    expect(lastWords.every((e) => e.day === 1)).toBe(true)
    expect(acc.state.phase).toBe('day.speech') // straight to speeches
  })

  it('poisoned death gets no last words even on night 1 (inference line preserved)', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p4')
    witchSavePass(acc)
    step(acc, { type: 'witchPoison', actorId: 'p2', targetId: 'p5' })
    seerCheck(acc, 'p6')
    settleLastWords(acc)
    // p4 (first-night knife) speaks; p5 (poisoned) does not.
    expect(evsOf(acc.events, 'lastWords').map((e) => e.payload.playerId)).toEqual(['p4'])
  })

  it('day-time exile gets last words; declining is an explicit null-content event', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, null)
    speakAll(acc)
    step(acc, { type: 'vote', actorId: 'p1', targetId: 'p4' })
    step(acc, { type: 'vote', actorId: 'p2', targetId: 'p4' })
    step(acc, { type: 'vote', actorId: 'p3', targetId: 'p4' })
    step(acc, { type: 'vote', actorId: 'p5', targetId: 'p4' })
    step(acc, { type: 'vote', actorId: 'p4', targetId: null })
    step(acc, { type: 'vote', actorId: 'p6', targetId: null })
    settleLastWords(acc, null)
    const lastWords = evsOf(acc.events, 'lastWords')
    expect(lastWords.map((e) => e.payload.playerId)).toEqual(['p4'])
    expect(lastWords[0].payload.content).toBeNull()
    expect(player(acc, 'p4').death?.causes).toEqual(['exile'])
    expect(acc.state.phase).toBe('night.wolves')
  })
})

describe('AC-5: hunter windows', () => {
  it('night-knifed hunter: permission after the death announcement, shot target dies as a night death (no last words)', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p3') // hunter
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p4')

    const permission = evOf(acc.events, 'hunterShootPermission')
    expect(permission.audience).toEqual({ kind: 'role-self', playerId: 'p3' })
    expect(permission.payload.canShoot).toBe(true)
    expect(evOf(acc.events, 'deathsAnnounced').seq).toBeLessThan(permission.seq)
    expect(acc.state.phase).toBe('day.hunterWindow')
    expect(acc.state.pendingActor).toBe('p3')

    hunterShoot(acc, 'p7')
    const shot = evOf(acc.events, 'hunterShot')
    expect(shot.audience).toEqual({ kind: 'public' })
    expect(shot.payload).toEqual({ hunterId: 'p3', targetId: 'p7' })
    // Target's death time syncs with the (night-dead) hunter: night, no last words.
    expect(player(acc, 'p7').death?.time).toBe('night')
    expect(player(acc, 'p7').death?.causes).toEqual(['shot'])
    settleLastWords(acc)
    expect(evsOf(acc.events, 'lastWords').map((e) => e.payload.playerId)).toEqual(['p3'])
    expect(acc.state.phase).toBe('day.speech')
  })

  it('exiled hunter (day death): shot target dies as a day death and gets last words', () => {
    const acc = start9(SEATING_9)
    quietNight9(acc, null)
    speakAll(acc)
    for (const [voter, target] of [
      ['p1', 'p3'], ['p2', 'p3'], ['p3', null], ['p4', 'p3'], ['p5', 'p3'], ['p6', 'p3'],
      ['p7', 'p4'], ['p8', 'p4'], ['p9', 'p4'],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    expect(acc.state.phase).toBe('day.hunterWindow')
    hunterShoot(acc, 'p7')
    expect(player(acc, 'p7').death?.time).toBe('day')
    settleLastWords(acc)
    // Exiled hunter and day-shot target both speak.
    expect(evsOf(acc.events, 'lastWords').map((e) => e.payload.playerId)).toEqual(['p3', 'p7'])
    expect(acc.state.phase).toBe('night.wolves')
  })

  it('hunter can 憩枪 (decline) — private confirmation, game continues', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p3')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p4')
    hunterPass(acc)
    const declined = evOf(acc.events, 'hunterDeclined')
    expect(declined.audience).toEqual({ kind: 'role-self', playerId: 'p3' })
    expect(player(acc, 'p7').alive).toBe(true)
    settleLastWords(acc)
    expect(acc.state.phase).toBe('day.speech')
    // Window closed: further hunter actions are rejected.
    expect(fail(acc, { type: 'hunterShoot', actorId: 'p3', targetId: 'p7' }).code).toBe('WRONG_PHASE')
  })

  it('AC-4: poisoned hunter gets no permission event and no window at all', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p4')
    witchSavePass(acc)
    step(acc, { type: 'witchPoison', actorId: 'p2', targetId: 'p3' }) // poison the hunter
    seerCheck(acc, 'p4')
    expect(evsOf(acc.events, 'hunterShootPermission')).toEqual([])
    expect(evsOf(acc.events, 'phaseEntered').some((e) => e.payload.phase === 'day.hunterWindow')).toBe(false)
    // Knife victim (first night) still gets last words; poisoned hunter does not.
    settleLastWords(acc)
    expect(evsOf(acc.events, 'lastWords').map((e) => e.payload.playerId)).toEqual(['p4'])
    expect(player(acc, 'p3').death?.causes).toEqual(['poison'])
  })
})

describe('AC-8: vote → tie → PK speeches → revote', () => {
  it('full PK loop: tie → PK speeches → revote tie → nobody exiled, enters night', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, null)
    speakAll(acc)
    step(acc, { type: 'vote', actorId: 'p1', targetId: 'p5' })
    step(acc, { type: 'vote', actorId: 'p2', targetId: 'p5' })
    step(acc, { type: 'vote', actorId: 'p3', targetId: 'p6' })
    step(acc, { type: 'vote', actorId: 'p4', targetId: 'p6' })
    step(acc, { type: 'vote', actorId: 'p5', targetId: null })
    step(acc, { type: 'vote', actorId: 'p6', targetId: null })

    const results = evsOf(acc.events, 'voteResult')
    expect(results[0].payload.outcome).toBe('tie-pk')
    expect(results[0].payload.tally).toEqual([
      { targetId: 'p5', votes: 2 },
      { targetId: 'p6', votes: 2 },
      { targetId: null, votes: 2 },
    ])
    expect(acc.state.phase).toBe('day.pkSpeech')

    speakAll(acc)
    expect(speechOrderOfDay(acc.events, 1)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p5', 'p6'])

    step(acc, { type: 'vote', actorId: 'p1', targetId: 'p5' })
    step(acc, { type: 'vote', actorId: 'p2', targetId: 'p5' })
    step(acc, { type: 'vote', actorId: 'p3', targetId: 'p6' })
    step(acc, { type: 'vote', actorId: 'p4', targetId: 'p6' })
    step(acc, { type: 'vote', actorId: 'p5', targetId: null })
    step(acc, { type: 'vote', actorId: 'p6', targetId: null })

    const final = evOf(acc.events, 'voteResult')
    expect(final.payload.outcome).toBe('no-exile-after-pk')
    expect(final.payload.round).toBe('pk')
    expect(acc.state.players.every((p) => p.alive)).toBe(true)
    expect(acc.state.phase).toBe('night.wolves')
    expect(acc.state.day).toBe(1)
    expect(acc.state.night?.nightNumber).toBe(2)
  })

  it('PK revote resolving a winner exiles that player (with last words)', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, null)
    speakAll(acc)
    for (const [voter, target] of [
      ['p1', 'p5'], ['p2', 'p5'], ['p3', 'p6'], ['p4', 'p6'], ['p5', null], ['p6', null],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    speakAll(acc)
    for (const [voter, target] of [
      ['p1', 'p5'], ['p2', 'p5'], ['p3', 'p5'], ['p4', 'p6'], ['p5', null], ['p6', 'p6'],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    const final = evOf(acc.events, 'voteResult')
    expect(final.payload.outcome).toBe('exile')
    expect(final.payload.exiledId).toBe('p5')
    settleLastWords(acc)
    expect(player(acc, 'p5').alive).toBe(false)
    expect(acc.state.phase).toBe('night.wolves')
  })

  it('nobody-immediately policy skips the PK entirely', () => {
    const acc = start6(SEATING_6, { voteTiePolicy: 'nobody-immediately' })
    quietNight(acc, null)
    speakAll(acc)
    for (const [voter, target] of [
      ['p1', 'p5'], ['p2', 'p5'], ['p3', 'p6'], ['p4', 'p6'], ['p5', null], ['p6', null],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    const final = evOf(acc.events, 'voteResult')
    expect(final.payload.outcome).toBe('no-exile')
    expect(evsOf(acc.events, 'phaseEntered').some((e) => e.payload.phase === 'day.pkSpeech')).toBe(false)
    expect(acc.state.phase).toBe('night.wolves')
  })

  it('vote validations: dead voter, double vote, dead target, non-candidate in PK', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, 'p3')
    settleLastWords(acc)
    speakAll(acc)
    expect(fail(acc, { type: 'vote', actorId: 'p3', targetId: 'p5' }).code).toBe('WRONG_ACTOR')
    step(acc, { type: 'vote', actorId: 'p1', targetId: 'p5' })
    expect(fail(acc, { type: 'vote', actorId: 'p1', targetId: 'p5' }).code).toBe('EXHAUSTED')
    expect(fail(acc, { type: 'vote', actorId: 'p2', targetId: 'p3' }).code).toBe('ILLEGAL_TARGET')
    // Drive into a PK to check candidate restriction.
    for (const [voter, target] of [
      ['p2', 'p5'], ['p4', 'p6'], ['p5', null], ['p6', 'p6'],
    ] as const) {
      step(acc, { type: 'vote', actorId: voter, targetId: target })
    }
    expect(acc.state.phase).toBe('day.pkSpeech')
    speakAll(acc)
    expect(fail(acc, { type: 'vote', actorId: 'p1', targetId: 'p4' }).code).toBe('ILLEGAL_TARGET')
    expect(availableActions(acc.state, 'p1')[0].targetIds).toEqual(['p5', 'p6'])
  })
})

describe('speech order (param 13 / WOD-7)', () => {
  it('peaceful day 1 speaks from seat 1 in seat order (fixed, recorded in events)', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, null)
    speakAll(acc)
    expect(speechOrderOfDay(acc.events, 1)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
  })

  it('from-dead-next starts at the seat after the lowest-seat night death', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, 'p3')
    settleLastWords(acc)
    speakAll(acc)
    expect(speechOrderOfDay(acc.events, 1)).toEqual(['p4', 'p5', 'p6', 'p1', 'p2'])
  })

  it('double death rotates from the seat after the lower seat', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p6')
    witchSavePass(acc)
    step(acc, { type: 'witchPoison', actorId: 'p2', targetId: 'p4' })
    seerCheck(acc, 'p5')
    settleLastWords(acc)
    speakAll(acc)
    expect(speechOrderOfDay(acc.events, 1)).toEqual(['p5', 'p7', 'p8', 'p9', 'p1', 'p2', 'p3'])
  })

  it('later peaceful days fall back to day1StartSeat', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, 'p6')
    settleLastWords(acc)
    speakAll(acc)
    for (const v of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      step(acc, { type: 'vote', actorId: v, targetId: null })
    }
    quietNight(acc, null)
    speakAll(acc)
    expect(speechOrderOfDay(acc.events, 2)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('"seat" policy always speaks from seat 1 even after deaths', () => {
    const acc = start6(SEATING_6, { speechOrderPolicy: 'seat' })
    quietNight(acc, 'p3')
    settleLastWords(acc)
    speakAll(acc)
    expect(speechOrderOfDay(acc.events, 1)).toEqual(['p1', 'p2', 'p4', 'p5', 'p6'])
  })
})

describe('speech / last-words budgets (WOD-4)', () => {
  it('rejects speeches beyond the board budget with PARAM_CONFLICT', () => {
    const acc = start6(SEATING_6) // budget 200
    quietNight(acc, null)
    const long = 'x'.repeat(201)
    expect(fail(acc, { type: 'speak', actorId: 'p1', content: long }).code).toBe('PARAM_CONFLICT')
    step(acc, { type: 'speak', actorId: 'p1', content: 'x'.repeat(200) })
  })

  it('bigger boards get bigger budgets (board B = 300)', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p4')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    settleLastWords(acc)
    const firstSpeaker = acc.state.pendingActor
    expect(firstSpeaker).not.toBeNull()
    if (!firstSpeaker) return
    step(acc, { type: 'speak', actorId: firstSpeaker, content: 'x'.repeat(300) })
  })

  it('rejects last words beyond the budget', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, 'p5')
    const rejection = fail(acc, {
      type: 'lastWords',
      actorId: 'p5',
      content: 'x'.repeat(201),
    })
    expect(rejection.code).toBe('PARAM_CONFLICT')
  })

  it('only the slot owner may deliver last words', () => {
    const acc = start6(SEATING_6)
    quietNight(acc, 'p5')
    expect(fail(acc, { type: 'lastWords', actorId: 'p6', content: 'hi' }).code).toBe('WRONG_ACTOR')
  })
})

/** Board B quiet night: wolves knife (or 空), witch passes, seer checks p4. */
function quietNight9(acc: Parameters<typeof killVote>[0], target: string | null): void {
  killVote(acc, target)
  witchSavePass(acc)
  witchPoisonPass(acc)
  seerCheck(acc, 'p4')
}
