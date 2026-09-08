// Information visibility (WFR-2xx): the survey §3 knowledge-isolation matrix
// enforced as automated audits (AC-13 / NFR-W5). Every audience filter is
// asserted against the stream of one rich scripted match.

import { describe, expect, it } from 'vitest'
import { eventVisibleTo, visibleEvents } from '@/games/werewolf/engine2'
import type { WerewolfEvent } from '@/games/werewolf/engine2'
import {
  SEATING_9,
  evOf,
  evsOf,
  hunterShoot,
  killVote,
  seerCheck,
  settleLastWords,
  speakAll,
  start9,
  step,
  witchSavePass,
  type Acc,
} from './_helpers'

/** Rich match: knife+poison night, hunter shot, speeches, exile, terminal. */
function richMatch(): Acc {
  const acc = start9(SEATING_9)
  // n1: wolves knife the hunter; witch poisons wolf p7; seer checks a wolf.
  killVote(acc, 'p3')
  witchSavePass(acc)
  step(acc, { type: 'witchPoison', actorId: 'p2', targetId: 'p7' })
  seerCheck(acc, 'p7')
  // d1: double death announce; hunter shoots wolf p8; p3 last words; exile the last wolf.
  hunterShoot(acc, 'p8')
  settleLastWords(acc)
  speakAll(acc)
  for (const [voter, target] of [
    ['p1', 'p9'], ['p2', 'p9'], ['p4', 'p9'], ['p5', 'p9'], ['p6', 'p9'], ['p9', null],
  ] as const) {
    step(acc, { type: 'vote', actorId: voter, targetId: target })
  }
  settleLastWords(acc)
  return acc
}

const PLAYER_VIEW = (id: string) => ({ type: 'player' as const, playerId: id })

describe('WFR-202: per-audience stream filtering (survey §3 matrix)', () => {
  const acc = richMatch()
  const events = acc.events
  const view = (id: string) => visibleEvents(events, PLAYER_VIEW(id))
  const idsOf = (view_: WerewolfEvent[]): Set<string> => new Set(view_.map((e) => e.kind))

  it('terminates with the last wolf exiled (sanity for the fixture)', () => {
    expect(acc.state.phase).toBe('ended')
    expect(evOf(events, 'gameEnded').payload.winner).toBe('good')
  })

  it('wolves see the wolf channel (identity, votes, agreed knife); others never do', () => {
    for (const wolf of ['p7', 'p8', 'p9']) {
      const kindsInView = idsOf(view(wolf))
      expect(kindsInView.has('teammatesRevealed')).toBe(true)
      expect(kindsInView.has('wolfKillVote')).toBe(true)
      expect(kindsInView.has('wolfKillAgreed')).toBe(true)
    }
    for (const good of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
      const kindsInView = idsOf(view(good))
      expect(kindsInView.has('teammatesRevealed')).toBe(false)
      expect(kindsInView.has('wolfKillVote')).toBe(false)
      expect(kindsInView.has('wolfKillAgreed')).toBe(false)
    }
  })

  it('the witch alone sees the knife reveal and her own potion decisions', () => {
    const witchView = idsOf(view('p2'))
    expect(witchView.has('knifeTargetRevealed')).toBe(true)
    expect(witchView.has('witchSaveDecision')).toBe(true)
    expect(witchView.has('witchPoisonDecision')).toBe(true)
    for (const other of ['p1', 'p3', 'p4', 'p5', 'p6', 'p7']) {
      const kindsInView = idsOf(view(other))
      expect(kindsInView.has('knifeTargetRevealed')).toBe(false)
      expect(kindsInView.has('witchSaveDecision')).toBe(false)
      expect(kindsInView.has('witchPoisonDecision')).toBe(false)
    }
  })

  it('the seer alone sees the binary check result; it never carries the exact role', () => {
    const check = evOf(events, 'seerChecked')
    expect(check.payload).toEqual({ targetId: 'p7', result: 'werewolf' })
    expect(idsOf(view('p1')).has('seerChecked')).toBe(true)
    for (const other of ['p2', 'p3', 'p7', 'p9']) {
      expect(idsOf(view(other)).has('seerChecked')).toBe(false)
    }
  })

  it('the hunter alone sees the private shoot permission', () => {
    expect(idsOf(view('p3')).has('hunterShootPermission')).toBe(true)
    for (const other of ['p1', 'p2', 'p4', 'p9']) {
      expect(idsOf(view(other)).has('hunterShootPermission')).toBe(false)
    }
  })

  it('no player ever sees moderator-audience events (settlement facts / causes / seed)', () => {
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']) {
      const leaked = view(id).filter((e) => e.audience.kind === 'moderator')
      expect(leaked).toEqual([])
      expect(idsOf(view(id)).has('nightSettled')).toBe(false)
      expect(idsOf(view(id)).has('randomnessSeed')).toBe(false)
    }
  })

  it('everyone sees all public events (announcements, speeches, votes, last words, reveal)', () => {
    for (const id of ['p1', 'p2', 'p4', 'p6', 'p7']) {
      const kindsInView = idsOf(view(id))
      for (const kind of [
        'matchStarted',
        'phaseEntered',
        'deathsAnnounced',
        'hunterShot',
        'lastWords',
        'speech',
        'voteCast',
        'voteResult',
        'gameEnded',
      ]) {
        expect(kindsInView.has(kind)).toBe(true)
      }
    }
  })

  it('dead players keep their role-based view for replay (wolves channel survives death)', () => {
    // p7 (wolf, poisoned night 1) still sees the wolf channel.
    expect(idsOf(view('p7')).has('wolfKillAgreed')).toBe(true)
  })

  it('the public-only stream never contains role or cause information pre-reveal', () => {
    const ended = evOf(events, 'gameEnded')
    const publicStream = visibleEvents(events, { type: 'public-only' })
    const preReveal = publicStream.filter((e) => e.seq < ended.seq)
    const allowedKinds = new Set([
      'matchStarted',
      'phaseEntered',
      'deathsAnnounced',
      'hunterShot',
      'lastWords',
      'speech',
      'voteCast',
      'voteResult',
    ])
    for (const event of preReveal) {
      expect(allowedKinds.has(event.kind)).toBe(true)
    }
    for (const announce of evsOf(preReveal, 'deathsAnnounced')) {
      expect(Object.keys(announce.payload).sort()).toEqual(['kind', 'seatNumbers'])
    }
    // The final reveal is public but only at the very end (WFR-504).
    expect(publicStream.some((e) => e.kind === 'gameEnded')).toBe(true)
  })

  it('moderator and god viewers see the full stream (WFR-205/206)', () => {
    expect(visibleEvents(events, { type: 'moderator' })).toHaveLength(events.length)
    expect(visibleEvents(events, { type: 'god' })).toHaveLength(events.length)
    expect(visibleEvents(events, { type: 'god' })).toEqual(events)
  })

  it('prefix filtering agrees with full-stream filtering (replay uses the same rule)', () => {
    const prefix = events.slice(0, Math.floor(events.length / 2))
    const prefixSeqs = new Set(prefix.map((e) => e.seq))
    const fromPrefix = visibleEvents(prefix, PLAYER_VIEW('p2')).map((e) => e.seq)
    const expected = visibleEvents(events, PLAYER_VIEW('p2'))
      .filter((e) => prefixSeqs.has(e.seq))
      .map((e) => e.seq)
    expect(fromPrefix).toEqual(expected)
  })
})

describe('eventVisibleTo unit rules', () => {
  const roles = new Map([
    ['w1', 'werewolf'],
    ['v1', 'villager'],
  ] as const)
  const base = { seq: 0, day: 0, actorId: null }

  it('sheriff-audience events are invisible to everyone until M2 grants a badge', () => {
    const event = { ...base, kind: 'sheriffBadgeTransfer', audience: { kind: 'sheriff' }, payload: {} } as unknown as WerewolfEvent
    expect(eventVisibleTo(event, PLAYER_VIEW('v1'), roles, null)).toBe(false)
    expect(eventVisibleTo(event, { type: 'moderator' }, roles, null)).toBe(true)
  })

  it('unknown players see only public events', () => {
    const privateEvent = { ...base, kind: 'seerChecked', audience: { kind: 'role-self', playerId: 'v1' }, payload: {} } as unknown as WerewolfEvent
    expect(eventVisibleTo(privateEvent, PLAYER_VIEW('stranger'), roles, null)).toBe(false)
    const publicEvent = { ...base, kind: 'speech', audience: { kind: 'public' }, payload: {} } as unknown as WerewolfEvent
    expect(eventVisibleTo(publicEvent, PLAYER_VIEW('stranger'), roles, null)).toBe(true)
  })
})
