// Terminal scenarios: 屠边 vs 屠城 vs parity (WFR-405), 狼刀在先 (param 3),
// the maxDays deadlock cap (WFR-406-1) and WFR-304 default-action drives
// (AC-9/10/11/17).

import { describe, expect, it } from 'vitest'
import type { BoardPreset } from '@/games/werewolf/engine2'
import {
  SEATING_6,
  SEATING_9,
  evOf,
  evsOf,
  hunterPass,
  killVote,
  player,
  runDefaults,
  seerCheck,
  settleLastWords,
  speakAll,
  start6,
  start9,
  step,
  witchPoisonPass,
  witchSavePass,
  type Acc,
} from './_helpers'

function vote(acc: Acc, entries: ReadonlyArray<readonly [string, string | null]>): void {
  for (const [voter, target] of entries) {
    step(acc, { type: 'vote', actorId: voter, targetId: target })
  }
}

describe('AC-9: 屠边 (kill-side, board B)', () => {
  it('gods side cleared → wolves win; terminal ends before the hunter window opens', () => {
    const acc = start9(SEATING_9)
    // n1: knife the seer (he still checks before settlement).
    killVote(acc, 'p1')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p4')
    // d1: exile villager p4.
    settleLastWords(acc)
    speakAll(acc)
    vote(acc, [
      ['p2', 'p4'], ['p3', 'p4'], ['p4', null], ['p5', 'p4'], ['p6', 'p4'],
      ['p7', 'p2'], ['p8', 'p2'], ['p9', 'p2'],
    ])
    settleLastWords(acc)
    expect(acc.state.phase).toBe('night.wolves')
    // n2: knife the witch (she still passes on her potions the night she dies).
    killVote(acc, 'p2')
    witchSavePass(acc)
    witchPoisonPass(acc)
    // d2: exile villager p5.
    speakAll(acc)
    vote(acc, [
      ['p3', 'p5'], ['p5', 'p6'], ['p6', 'p5'], ['p7', null], ['p8', null], ['p9', null],
    ])
    settleLastWords(acc)
    // n3: knife the hunter — last god. Settlement itself is terminal.
    killVote(acc, 'p3')
    expect(acc.state.phase).toBe('ended')
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.winner).toBe('wolves')
    expect(ended.payload.basis).toBe('kill-side:gods-eliminated')
    expect(ended.payload.reveal).toHaveLength(9)
    // Announce happened, but no permission / no speeches on day 3.
    const announce = evsOf(acc.events, 'deathsAnnounced')
    expect(announce[announce.length - 1].payload.seatNumbers).toEqual([3])
    expect(evsOf(acc.events, 'hunterShootPermission')).toEqual([])
    expect(evsOf(acc.events, 'phaseEntered').filter((e) => e.payload.phase === 'day.speech')).toHaveLength(2)
  })

  it('villager side cleared → wolves win even with the hunter alive', () => {
    const acc = start9(SEATING_9)
    killVote(acc, 'p4')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p4')
    // d1: exile the seer.
    settleLastWords(acc)
    speakAll(acc)
    vote(acc, [
      ['p1', null], ['p2', 'p1'], ['p3', 'p1'], ['p5', 'p1'], ['p6', 'p1'],
      ['p7', 'p2'], ['p8', 'p2'], ['p9', 'p2'],
    ])
    settleLastWords(acc)
    // n2: knife p5.
    killVote(acc, 'p5')
    witchSavePass(acc)
    witchPoisonPass(acc)
    // d2: exile the witch.
    speakAll(acc)
    vote(acc, [
      ['p2', 'p7'], ['p3', 'p2'], ['p6', 'p2'], ['p7', null], ['p8', null], ['p9', null],
    ])
    settleLastWords(acc)
    // n3: knife the last villager → villagers side cleared.
    killVote(acc, 'p6')
    witchSavePass(acc)
    witchPoisonPass(acc)
    expect(acc.state.phase).toBe('ended')
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.winner).toBe('wolves')
    expect(ended.payload.basis).toBe('kill-side:villagers-eliminated')
    const hunter = ended.payload.reveal.find((r) => r.playerId === 'p3')
    expect(hunter?.role).toBe('hunter')
    expect(hunter?.death).toBeNull() // hunter survives; wolves win anyway
  })

  it('all wolves exiled → good wins', () => {
    const acc = start9(SEATING_9)
    // n1: 空刀 (save question auto-answers "no" — only the poison pass is asked).
    killVote(acc, null)
    witchPoisonPass(acc)
    seerCheck(acc, 'p4')
    speakAll(acc)
    vote(acc, [
      ['p1', 'p7'], ['p2', 'p7'], ['p3', 'p7'], ['p4', 'p7'], ['p5', 'p7'], ['p6', 'p7'],
      ['p7', null], ['p8', 'p1'], ['p9', 'p1'],
    ])
    settleLastWords(acc)
    // n2: 空刀.
    killVote(acc, null)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    speakAll(acc)
    vote(acc, [
      ['p1', 'p8'], ['p2', 'p8'], ['p3', 'p8'], ['p4', 'p8'], ['p5', 'p8'], ['p6', 'p8'],
      ['p8', null], ['p9', 'p1'],
    ])
    settleLastWords(acc)
    // n3: 空刀; d3: exile the last wolf.
    killVote(acc, null)
    witchPoisonPass(acc)
    seerCheck(acc, 'p6')
    speakAll(acc)
    vote(acc, [
      ['p1', 'p9'], ['p2', 'p9'], ['p3', 'p9'], ['p4', 'p9'], ['p5', 'p9'], ['p6', 'p9'],
      ['p9', null],
    ])
    expect(acc.state.phase).toBe('ended')
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.winner).toBe('good')
    expect(ended.payload.basis).toBe('all-wolves-eliminated')
  })
})

describe('AC-10: 屠城 + parity (kill-all-parity, board A)', () => {
  it('wolves reach parity (2 wolves vs 2 good) → wolves win at dawn settlement', () => {
    const acc = start6(SEATING_6)
    killVote(acc, 'p3') // seer
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    // d1: 平安日 — everyone abstains, nobody exiled.
    settleLastWords(acc)
    speakAll(acc)
    vote(acc, [['p1', null], ['p2', null], ['p4', null], ['p5', null], ['p6', null]])
    expect(acc.state.phase).toBe('night.wolves')
    // n2: knife the witch — self-save barred after night 1 (WOD-1).
    killVote(acc, 'p4')
    witchSavePass(acc)
    witchPoisonPass(acc)
    // Alive: p1,p2 wolves vs p5,p6 good → parity fast path.
    expect(acc.state.phase).toBe('ended')
    expect(acc.state.outcome).toEqual({
      winner: 'wolves',
      basis: 'kill-all-parity:wolves-no-fewer-than-good',
    })
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.winner).toBe('wolves')
  })
})

describe('AC-11: 狼刀在先 (param 3) — simultaneous wolf-win + good-win in one settlement', () => {
  function runWolfPriority(overrides?: Partial<BoardPreset>): Acc {
    const acc = start9(SEATING_9, overrides)
    // n1: knife the hunter; witch keeps both potions.
    killVote(acc, 'p3')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p4')
    // d1: hunter declines; p3 last words; exile wolf p7.
    hunterPass(acc)
    settleLastWords(acc)
    speakAll(acc)
    vote(acc, [
      ['p1', 'p7'], ['p2', 'p7'], ['p4', 'p7'], ['p5', 'p7'], ['p6', 'p7'],
      ['p7', 'p2'], ['p8', 'p1'], ['p9', 'p1'],
    ])
    settleLastWords(acc)
    // n2: knife p4; d2: exile the seer.
    killVote(acc, 'p4')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p5')
    speakAll(acc)
    vote(acc, [
      ['p1', null], ['p2', 'p1'], ['p5', 'p1'], ['p6', 'p1'], ['p8', 'p2'], ['p9', 'p2'],
    ])
    settleLastWords(acc)
    // n3: knife p5; d3: exile wolf p8.
    killVote(acc, 'p5')
    witchSavePass(acc)
    witchPoisonPass(acc)
    speakAll(acc)
    vote(acc, [
      ['p2', 'p8'], ['p6', 'p8'], ['p8', 'p2'], ['p9', 'p6'],
    ])
    settleLastWords(acc)
    expect(acc.state.phase).toBe('night.wolves')
    // Alive: p2 witch, p6 villager, p9 wolf.
    // n4: the last wolf knives the last villager while the witch poisons the last wolf.
    killVote(acc, 'p6')
    witchSavePass(acc)
    step(acc, { type: 'witchPoison', actorId: 'p2', targetId: 'p9' })
    return acc
  }

  it('param 3 on (default): the simultaneous settlement is scored for the wolves', () => {
    const acc = runWolfPriority()
    expect(acc.state.phase).toBe('ended')
    const announce = evsOf(acc.events, 'deathsAnnounced')
    expect(announce[announce.length - 1].payload.kind).toBe('double')
    expect(announce[announce.length - 1].payload.seatNumbers).toEqual([6, 9])
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.winner).toBe('wolves')
    expect(ended.payload.basis).toBe('kill-side:villagers-eliminated')
    expect(player(acc, 'p9').death?.causes).toEqual(['poison'])
    expect(player(acc, 'p6').death?.causes).toEqual(['wolf-kill'])
  })

  it('param 3 off: the same settlement is scored for good', () => {
    const acc = runWolfPriority({ wolfPriorityOnSimultaneousWin: false })
    expect(acc.state.phase).toBe('ended')
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.payload.winner).toBe('good')
    expect(ended.payload.basis).toBe('all-wolves-eliminated')
  })
})

describe('WFR-406: deadlock guards', () => {
  it('maxDays cap forces a terminal tie with a recorded basis', () => {
    const acc = start6(SEATING_6, { maxDays: 2 })
    for (let day = 0; day < 2; day++) {
      killVote(acc, null) // 空刀
      witchPoisonPass(acc)
      seerCheck(acc, 'p5')
      speakAll(acc)
      settleLastWords(acc)
      vote(acc, [
        ['p1', null], ['p2', null], ['p3', null], ['p4', null], ['p5', null], ['p6', null],
      ])
    }
    expect(acc.state.phase).toBe('ended')
    expect(acc.state.outcome).toEqual({ winner: 'tie', basis: 'max-days-cap' })
    expect(evOf(acc.events, 'gameEnded').payload.winner).toBe('tie')
  })

  it('AC-17: a full match of no-response defaults terminates cleanly with identifiable default events', () => {
    const acc = start6(SEATING_6)
    runDefaults(acc, (a) => a.state.phase === 'ended')
    expect(acc.state.phase).toBe('ended')
    expect(acc.state.outcome?.basis).toBe('max-days-cap')
    // Default-produced events are identifiable (WFR-304 / AC-17).
    expect(acc.events.some((e) => e.isDefault === true)).toBe(true)
    expect(evsOf(acc.events, 'speech').some((e) => e.isDefault === true)).toBe(true)
    expect(evsOf(acc.events, 'voteCast').some((e) => e.isDefault === true)).toBe(true)
    expect(evsOf(acc.events, 'wolfKillVote').some((e) => e.isDefault === true)).toBe(true)
    expect(evsOf(acc.events, 'seerSkipped').some((e) => e.isDefault === true)).toBe(true)
    expect(evsOf(acc.events, 'witchPoisonDecision').some((e) => e.isDefault === true)).toBe(true)
    // Engine-auto answers (空刀 → no save question) are distinguishable from
    // actor defaults: auto=true without the isDefault flag.
    const autoNoSave = evsOf(acc.events, 'witchSaveDecision').find((e) => e.payload.autoReason === 'no-knife-target')
    expect(autoNoSave).toBeDefined()
    expect(autoNoSave?.isDefault).toBeUndefined()
  })
})
