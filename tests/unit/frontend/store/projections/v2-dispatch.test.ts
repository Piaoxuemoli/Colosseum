// v2 分派与切换期共存（spec §6）：
// - `poker:v2:` / `werewolf:v2:` 前缀分派，legacy kind 仍走 v1 路径；
// - legacy + v2 混流不串味（v1 事件照旧、v2 事件只进 v2 投影）；
// - 视角切换（setViewMode）基于已存事件重投影，无需重新拉取；
// - 回放（replay-store）经同一分派消费 v2 流，seek/rewind 与批量一致。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveMatchView, useMatchViewStore } from '@/frontend/store/match-view-store'
import { useReplayStore } from '@/frontend/store/replay-store'
import {
  MATCH_ID,
  POKER_ROSTER,
  WEREWOLF_ROSTER,
  indexOfKind,
  pokerEnvelope,
  rawEvent,
  scriptedPokerMatch,
  scriptedWerewolfMatch,
  werewolfEnvelope,
} from './helpers'

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(1_723_000_000_000)
  useMatchViewStore.getState().reset()
  useReplayStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  useMatchViewStore.getState().reset()
  useReplayStore.getState().reset()
})

const pokerEvents = scriptedPokerMatch().events.map((event) => pokerEnvelope(event))
const werewolfEvents = scriptedWerewolfMatch().events.map((event) => werewolfEnvelope(event))

describe('v2 dispatch — prefix routing', () => {
  it('routes poker:v2: kinds to the poker projection and nothing else', () => {
    const derived = deriveMatchView(pokerEvents, { matchId: MATCH_ID, players: POKER_ROSTER }, 'god')
    expect(derived.events).toHaveLength(pokerEvents.length)
    expect(derived.handNumber).toBeGreaterThan(1)
    // v2 扑克流不触碰狼人投影。
    expect(derived.werewolf.day).toBe(0)
    expect(derived.werewolf.speechLog).toEqual([])
    expect(derived.werewolfV2.roles).toEqual({})
  })

  it('routes werewolf:v2: kinds to the werewolf projection and nothing else', () => {
    const derived = deriveMatchView(werewolfEvents, { matchId: MATCH_ID, players: WEREWOLF_ROSTER }, 'god')
    expect(derived.werewolf.winner).toBe('werewolves')
    // v2 狼人流不触碰扑克投影。
    expect(derived.communityCards).toEqual([])
    expect(derived.pot).toBe(0)
    expect(derived.pokerV2.seatIds).toEqual([])
  })

  it('forwards legacy kinds to the v1 reducer while v2 kinds flow in parallel', () => {
    const legacy = rawEvent('poker', 'settlement', { winnerId: 'agent-b' })
    const mixed = [...pokerEvents, legacy]
    const derived = deriveMatchView(mixed, { matchId: MATCH_ID, players: POKER_ROSTER }, 'god')
    // v1 settlement kind 依旧生效。
    expect(derived.matchComplete).toBe(true)
    expect(derived.status).toBe('settled')
    expect(derived.winnerAgentId).toBe('agent-b')
    // v2 事件贡献的字段不受 legacy 事件影响。
    expect(derived.chipHistory.map((snapshot) => snapshot.handNumber)).toEqual([1, 2])
  })

  it('mixed v1 + v2 werewolf stream contributes through both paths without duplication', () => {
    const legacyNarrate = rawEvent(
      'werewolf',
      'werewolf/moderator-narrate',
      { day: 1, upcomingPhase: 'day', narration: 'legacy 旁白', deaths: [] },
      null,
    )
    const legacySpeak = rawEvent(
      'werewolf',
      'werewolf/speak',
      { day: 1, content: 'legacy 发言' },
      'p6',
    )
    // v2 前缀事件（matchStarted 之前插入 legacy 事件，模拟切换期混流）。
    const firstPublic = Math.min(
      indexOfKind(werewolfEvents, 'werewolf:v2:matchStarted'),
      indexOfKind(werewolfEvents, 'werewolf:v2:phaseEntered'),
    )
    const mixed = [
      ...werewolfEvents.slice(0, firstPublic + 1),
      legacyNarrate,
      legacySpeak,
      ...werewolfEvents.slice(firstPublic + 1),
    ]
    const derived = deriveMatchView(mixed, { matchId: MATCH_ID, players: WEREWOLF_ROSTER }, 'god')

    const legacySpeech = derived.werewolf.speechLog.filter((entry) => entry.content === 'legacy 发言')
    expect(legacySpeech).toEqual([{ day: 1, agentId: 'p6', content: 'legacy 发言', claimedRole: undefined }])
    const v2Speeches = derived.werewolf.speechLog.filter((entry) => entry.content === '我是好人')
    expect(v2Speeches.length).toBe(5)
    expect(derived.werewolf.moderatorNarration.some((entry) => entry.narration === 'legacy 旁白')).toBe(true)
    // v2 流的终局结论保持。
    expect(derived.werewolf.winner).toBe('werewolves')
  })

  it('cross-game envelopes in one stream do not contaminate each other', () => {
    // 防御性场景：同一 store 同时收到两种游戏的信封（错误接线也不串味）。
    const interleaved = pokerEvents.flatMap((event, index) => {
      const werewolf = werewolfEvents[index]
      return werewolf ? [event, werewolf] : [event]
    })
    const derived = deriveMatchView(interleaved, { matchId: MATCH_ID, players: POKER_ROSTER }, 'god')
    expect(derived.events).toHaveLength(interleaved.length)
    expect(derived.handNumber).toBe(2)
    expect(derived.winnerAgentId).not.toBeNull()
    expect(derived.werewolf.winner).toBe('werewolves')
  })
})

describe('view mode toggle — re-projection without refetch', () => {
  it('defaults to god view for both games', () => {
    useMatchViewStore.getState().init({ matchId: MATCH_ID, players: POKER_ROSTER })
    expect(useMatchViewStore.getState().viewMode).toBe('god')
  })

  it('toggles god → public → god by re-deriving the stored stream (no new events)', () => {
    useMatchViewStore.getState().init({ matchId: MATCH_ID, players: POKER_ROSTER })
    const midHand = indexOfKind(pokerEvents, 'poker:v2:hole-cards-dealt', 2)
    // 喂到手 1「已发牌未结算」的中间态。
    for (const event of pokerEvents.slice(0, midHand + 1)) {
      useMatchViewStore.getState().ingestEvent(event)
    }
    expect(useMatchViewStore.getState().players.every((player) => player.holeCards.length === 2)).toBe(true)

    useMatchViewStore.getState().setViewMode('public')
    const pub = useMatchViewStore.getState()
    expect(pub.viewMode).toBe('public')
    expect(pub.players.every((player) => player.holeCards.length === 0)).toBe(true)
    // 事件数不变（无重新拉取），仅重投影。
    expect(pub.events).toHaveLength(midHand + 1)

    useMatchViewStore.getState().setViewMode('god')
    const backToGod = useMatchViewStore.getState()
    expect(backToGod.players.every((player) => player.holeCards.length === 2)).toBe(true)
    expect(backToGod.events).toHaveLength(midHand + 1)
  })

  it('preserves UI state (tab/expanded hands) across the toggle', () => {
    useMatchViewStore.getState().init({ matchId: MATCH_ID, players: WEREWOLF_ROSTER })
    useMatchViewStore.getState().setRightPanelTab('thinking')
    useMatchViewStore.getState().ensureActionHandExpanded(7)
    for (const event of werewolfEvents.slice(0, 5)) useMatchViewStore.getState().ingestEvent(event)

    useMatchViewStore.getState().setViewMode('public')
    const state = useMatchViewStore.getState()
    expect(state.rightPanelTab).toBe('thinking')
    expect(state.expandedActionHands).toEqual([7])
  })

  it('ingest continues in the switched mode after toggling (live path)', () => {
    useMatchViewStore.getState().init({ matchId: MATCH_ID, players: POKER_ROSTER })
    useMatchViewStore.getState().setViewMode('public')
    const handTwoStart = indexOfKind(pokerEvents, 'poker:v2:hand-started', 1)
    for (const event of pokerEvents.slice(0, handTwoStart + 1)) {
      useMatchViewStore.getState().ingestEvent(event)
    }
    // public 增量流：新手牌底牌保持牌背。
    expect(useMatchViewStore.getState().players.every((player) => player.holeCards.length === 0)).toBe(true)
    // 与同视角批量投影一致。
    const derived = deriveMatchView(
      pokerEvents.slice(0, handTwoStart + 1),
      { matchId: MATCH_ID, players: POKER_ROSTER },
      'public',
    )
    expect(useMatchViewStore.getState().players).toEqual(derived.players)
  })
})

describe('replay — v2 streams through the shared reducer dispatch', () => {
  function projectAfterReplay() {
    const view = useMatchViewStore.getState()
    return {
      players: view.players,
      werewolf: view.werewolf,
      handNumber: view.handNumber,
      pot: view.pot,
      status: view.status,
      events: view.events,
    }
  }

  it('stepwise tickOne through the full v2 poker match matches batch derive', () => {
    useReplayStore.getState().load(pokerEvents, { matchId: MATCH_ID, players: POKER_ROSTER })
    while (useReplayStore.getState().cursor < pokerEvents.length) {
      useReplayStore.getState().tickOne()
    }
    const replayed = projectAfterReplay()
    const derived = deriveMatchView(pokerEvents, { matchId: MATCH_ID, players: POKER_ROSTER }, 'god')

    expect(replayed.players).toEqual(derived.players)
    expect(replayed.pot).toBe(derived.pot)
    expect(replayed.handNumber).toBe(derived.handNumber)
    expect(replayed.status).toBe(derived.status)
    expect(replayed.events.map((e) => e.id)).toEqual(derived.events.map((e) => e.id))
    expect(replayed.events.map((e) => e.handNumberAt)).toEqual(derived.events.map((e) => e.handNumberAt))
  })

  it('seek/rewind stays coherent (backward seek replays from scratch)', () => {
    useReplayStore.getState().load(pokerEvents, { matchId: MATCH_ID, players: POKER_ROSTER })
    useReplayStore.getState().seekTo(20)
    expect(useReplayStore.getState().cursor).toBe(20)
    useReplayStore.getState().seekTo(5)
    expect(useReplayStore.getState().cursor).toBe(5)
    const atFive = projectAfterReplay()
    const derivedFive = deriveMatchView(
      pokerEvents.slice(0, 5),
      { matchId: MATCH_ID, players: POKER_ROSTER },
      'god',
    )
    expect(atFive.events).toHaveLength(5)
    expect(atFive.handNumber).toBe(derivedFive.handNumber)

    // 从回退点继续播完，终态与批量一致（事件即真相）。
    while (useReplayStore.getState().cursor < pokerEvents.length) {
      useReplayStore.getState().tickOne()
    }
    expect(projectAfterReplay().players).toEqual(
      deriveMatchView(pokerEvents, { matchId: MATCH_ID, players: POKER_ROSTER }, 'god').players,
    )
  })

  it('replays v2 werewolf matches and honors a public-view session', () => {
    useReplayStore.getState().load(werewolfEvents, { matchId: MATCH_ID, players: WEREWOLF_ROSTER })
    while (useReplayStore.getState().cursor < werewolfEvents.length) {
      useReplayStore.getState().tickOne()
    }
    const derived = deriveMatchView(werewolfEvents, { matchId: MATCH_ID, players: WEREWOLF_ROSTER }, 'god')
    expect(projectAfterReplay().werewolf).toEqual(derived.werewolf)

    // 切到 public 再回退：seek 的重投影沿用当前视角（身份回隐）。
    useMatchViewStore.getState().setViewMode('public')
    useReplayStore.getState().seekTo(0)
    useReplayStore.getState().seekTo(Math.floor(werewolfEvents.length / 2))
    expect(useMatchViewStore.getState().viewMode).toBe('public')
    expect(useMatchViewStore.getState().werewolf.roleAssignments).toBeNull()
    expect(useMatchViewStore.getState().werewolf.winner).toBeNull()
  })
})
