// 德州扑克 v2 投影（src/frontend/store/projections/poker-v2.ts）：
// 以 engine2 真实事件流（脚本整场）验证 spec §6 的消费侧契约——
// 增量 ingest 与批量 derive 等价、god/public 视角剥离、延迟揭示时序、
// 未知 kind 前向兼容。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyState } from '@/games/poker/engine2'
import { deriveMatchView } from '@/frontend/store/match-view-store'
import type { MatchViewProjection } from '@/frontend/store/match-view-store'
import { useMatchViewStore } from '@/frontend/store/match-view-store'
import {
  MATCH_ID,
  POKER_ROSTER,
  indexOfKind,
  pokerEnvelope,
  rawEvent,
  scriptedPokerMatch,
} from './helpers'

const script = scriptedPokerMatch()
const events = script.events.map((event) => pokerEnvelope(event))

function derive(viewMode: 'god' | 'public', upto?: number): MatchViewProjection {
  const slice = upto === undefined ? events : events.slice(0, upto + 1)
  return deriveMatchView(slice, { matchId: MATCH_ID, players: POKER_ROSTER }, viewMode)
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(1_723_000_000_000)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 增量 store ingest 与批量 derive 逐字段等价（live/replay 共用不变量）。 */
function expectStoreMatchesDerived(viewMode: 'god' | 'public'): void {
  useMatchViewStore.getState().reset()
  useMatchViewStore.getState().init({ matchId: MATCH_ID, players: POKER_ROSTER })
  useMatchViewStore.getState().setViewMode(viewMode)
  for (const event of events) useMatchViewStore.getState().ingestEvent(event)
  const live = useMatchViewStore.getState()
  const derived = derive(viewMode)

  expect(live.phase).toBe(derived.phase)
  expect(live.handNumber).toBe(derived.handNumber)
  expect(live.status).toBe(derived.status)
  expect(live.matchComplete).toBe(derived.matchComplete)
  expect(live.winnerAgentId).toBe(derived.winnerAgentId)
  expect(live.pot).toBe(derived.pot)
  expect(live.players).toEqual(derived.players)
  expect(live.chipHistory).toEqual(derived.chipHistory)
  expect(live.streetPots).toEqual(derived.streetPots)
  expect(live.sidePots).toEqual(derived.sidePots)
  expect(live.events.map((e) => e.id)).toEqual(derived.events.map((e) => e.id))
  expect(live.events.map((e) => e.handNumberAt)).toEqual(derived.events.map((e) => e.handNumberAt))
}

describe('poker v2 projection — equivalence', () => {
  it('incremental store ingest === batch derive (god view)', () => {
    expectStoreMatchesDerived('god')
  })

  it('incremental store ingest === batch derive (public view)', () => {
    expectStoreMatchesDerived('public')
  })

  it('feeds every engine2 event into the events list with hand-scoped handNumberAt', () => {
    const derived = derive('god')
    expect(derived.events).toHaveLength(events.length)
    for (const rich of derived.events) {
      expect(rich.handNumberAt).toBeGreaterThan(0)
    }
    // 手 1 事件（含 match-config 之后的）标 1，手 2 事件标 2。
    const handTwoStart = indexOfKind(events, 'poker:v2:hand-started', 1)
    expect(derived.events[handTwoStart - 1].handNumberAt).toBe(1)
    expect(derived.events[handTwoStart].handNumberAt).toBe(2)
  })
})

describe('poker v2 projection — god view', () => {
  it('shows hole cards the moment they are dealt', () => {
    const dealtIndex = indexOfKind(events, 'poker:v2:hole-cards-dealt', 2) // 手 1 第三家底牌
    const midHand = derive('god', dealtIndex)
    expect(midHand.players.every((player) => player.holeCards.length === 2)).toBe(true)
    // 卡面来自 engine2 事件本体。
    const dealt = script.events.find((event) => event.kind === 'hole-cards-dealt' && event.hand === 1)
    expect(dealt).toBeDefined()
    if (!dealt || dealt.kind !== 'hole-cards-dealt') return
    const seat = midHand.players.find((player) => player.agentId === dealt.seatId)
    expect(seat?.holeCards).toEqual(dealt.cards)
  })

  it('derives chips/pot/streetPots from actions and hand-ended authoritative results', () => {
    const final = derive('god')
    // 受控结束不改筹码：三人和恒为 600。
    expect(final.players.reduce((sum, player) => sum + player.chips, 0)).toBe(600)
    // 手 2 过牌到河牌：preflop 30，其余街 0；结算后桌面池归零。
    expect(final.streetPots).toEqual({ preflop: 30, flop: 0, turn: 0, river: 0 })
    expect(final.pot).toBe(0)
    // chipHistory 两手各一条（hand-ended 快照）。
    expect(final.chipHistory.map((snapshot) => snapshot.handNumber)).toEqual([1, 2])
    // hand-ended 的 endStack 是权威值：与引擎终态一致。
    for (const player of final.players) {
      expect(player.chips).toBe(
        script.state.players.find((candidate) => candidate.seatId === player.agentId)?.stack,
      )
    }
  })

  it('maps button/sb/bb seats and resets the board between hands', () => {
    const handTwoStart = indexOfKind(events, 'poker:v2:hand-started', 1)
    const fresh = derive('god', handTwoStart)
    const handStarted = script.events.filter((event) => event.kind === 'hand-started')[1]
    if (handStarted?.kind !== 'hand-started') throw new Error('missing hand-started #2')
    const seat = (physical: number) => POKER_ROSTER[physical].seatIndex
    expect(fresh.dealerIndex).toBe(seat(handStarted.buttonSeat))
    expect(fresh.smallBlindIndex).toBe(seat(handStarted.sbSeat))
    expect(fresh.bigBlindIndex).toBe(seat(handStarted.bbSeat))
    expect(fresh.communityCards).toEqual([])
    expect(fresh.phase).toBe('preflop')
  })

  it('marks folds and showdown reveals', () => {
    // 手 1 弃牌快进：非庄家两家 folded。
    const handOneEnd = indexOfKind(events, 'poker:v2:hand-ended', 0)
    const afterHandOne = derive('god', handOneEnd)
    const folded = afterHandOne.players.filter((player) => player.status === 'folded')
    expect(folded.length).toBe(2)

    // 手 2 河牌完成 → 强制亮牌（cards-revealed，public）→ 状态 showdown。
    const lastReveal = indexOfKind(events, 'poker:v2:cards-revealed')
    const atShowdown = derive('god', lastReveal)
    expect(atShowdown.phase).toBe('showdown')
    const revealed = events[lastReveal]
    const revealedSeat = revealed.payload.seatId as string
    const revealedCards = revealed.payload.cards as Array<{ rank: string; suit: string }>
    expect(atShowdown.players.find((player) => player.agentId === revealedSeat)?.holeCards).toEqual(revealedCards)
  })

  it('settles the match with the champion once match-finished arrives', () => {
    const final = derive('god')
    const finished = classifyState(script.state)
    expect(final.matchComplete).toBe(true)
    expect(final.status).toBe('settled')
    expect(final.winnerAgentId).toBe(finished.kind === 'finished' ? finished.ranking[0].seatId : null)
    expect(final.currentActor).toBeNull()
  })

  it('reflects the stop request', () => {
    const stopIndex = indexOfKind(events, 'poker:v2:stop-requested')
    expect(derive('god', stopIndex).stopRequested).toBe(true)
    expect(derive('god', stopIndex - 1).stopRequested).toBe(false)
  })
})

describe('poker v2 projection — public view stripping', () => {
  it('hides hole cards during the hand and reveals them only after hand-ended (delayed-public)', () => {
    const dealtIndex = indexOfKind(events, 'poker:v2:hole-cards-dealt', 2)
    const handOneEnd = indexOfKind(events, 'poker:v2:hand-ended', 0)
    const handTwoStart = indexOfKind(events, 'poker:v2:hand-started', 1)

    // 手 1 进行中：public 全员牌背。
    const midHand = derive('public', dealtIndex)
    expect(midHand.players.every((player) => player.holeCards.length === 0)).toBe(true)

    // 手 1 结算后：底牌对该手到期，public 可复盘。
    const settled = derive('public', handOneEnd)
    expect(settled.players.every((player) => player.holeCards.length === 2)).toBe(true)

    // 手 2 开局：新一轮发牌回到牌背（延迟揭示按手号判定）。
    const freshHand = derive('public', handTwoStart)
    expect(freshHand.players.every((player) => player.holeCards.length === 0)).toBe(true)
  })

  it('keeps cards-revealed (showdown) visible in public — it is a public fact', () => {
    const lastReveal = indexOfKind(events, 'poker:v2:cards-revealed')
    const atShowdown = derive('public', lastReveal)
    const revealed = events[lastReveal]
    const revealedSeat = revealed.payload.seatId as string
    expect(atShowdown.players.find((player) => player.agentId === revealedSeat)?.holeCards.length).toBe(2)
  })

  it('public view derives the same public facts (chips/pots/history/winner) as god', () => {
    const god = derive('god')
    const pub = derive('public')
    // 公共事实（不含 holeCards）不受视角影响。
    expect(pub.players.map((player) => [player.agentId, player.chips, player.currentBet, player.status])).toEqual(
      god.players.map((player) => [player.agentId, player.chips, player.currentBet, player.status]),
    )
    expect(pub.pot).toBe(god.pot)
    expect(pub.streetPots).toEqual(god.streetPots)
    expect(pub.chipHistory).toEqual(god.chipHistory)
    expect(pub.winnerAgentId).toBe(god.winnerAgentId)
  })
})

describe('poker v2 projection — forward compatibility', () => {
  it('silently ignores unknown v2 kinds (no state change beyond the event log)', () => {
    const unknown = rawEvent('poker', 'poker:v2:quantum-reshuffle', {
      seq: 42,
      hand: 1,
      audience: { kind: 'public' },
      kind: 'quantum-reshuffle',
      entropy: 'max',
    })
    const withUnknown = [...events, unknown]
    const a = deriveMatchView(withUnknown, { matchId: MATCH_ID, players: POKER_ROSTER }, 'god')
    const b = derive('god')

    expect(a.events).toHaveLength(b.events.length + 1)
    expect(a.events.at(-1)?.id).toBe(unknown.id)
    expect(a.events.at(-1)?.kind).toBe('poker:v2:quantum-reshuffle')
    expect(a.phase).toBe(b.phase)
    expect(a.handNumber).toBe(b.handNumber)
    expect(a.players).toEqual(b.players)
    expect(a.pot).toBe(b.pot)
    expect(a.chipHistory).toEqual(b.chipHistory)
    expect(a.werewolf).toEqual(b.werewolf)
  })

  it('ignores unknown kinds mid-stream without disturbing neighbours', () => {
    const midHand = indexOfKind(events, 'poker:v2:hole-cards-dealt', 1)
    const unknown = rawEvent('poker', 'poker:v2:future-kind', { hand: 1, audience: { kind: 'public' } })
    const spliced = [...events.slice(0, midHand + 1), unknown, ...events.slice(midHand + 1)]
    const a = deriveMatchView(spliced, { matchId: MATCH_ID, players: POKER_ROSTER }, 'public')
    const b = derive('public')
    expect(a.events).toHaveLength(b.events.length + 1)
    expect(a.events[midHand + 1].kind).toBe('poker:v2:future-kind')
    expect(a.players).toEqual(b.players)
    expect(a.phase).toBe(b.phase)
    expect(a.chipHistory).toEqual(b.chipHistory)
    expect(a.winnerAgentId).toBe(b.winnerAgentId)
  })
})
