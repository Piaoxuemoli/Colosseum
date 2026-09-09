// 品类呈现契约 · 前端通用兜底投影测试（spec: docs/specs/presentation-contract.md §3/§4）。
//
// - 未知品类（此处以 avalon 为 fixture）的信封流 → 通用视图模型四支柱；
// - 既有两游戏（poker / werewolf）的信封流直接喂通用归约器，验证「通用锚点
//   约定」的跨品类一致性（契约不是只对未来游戏生效）；
// - match-view-store 分派：非 poker/werewolf 的 `*:v2:` 走通用投影且不触碰
//   游戏专属字段。
//
// 注：gameType 的 zod 枚举当前仅 'poker' | 'werewolf'；第三品类接入（R3-2 /
// OD-1）时扩展枚举，届时本文件的 fixture cast 移除。

import { describe, expect, it } from 'vitest'
import type { GameEvent, GameEvent as PlatformGameEvent } from '@/platform/core/types'
import { deriveMatchView } from '@/frontend/store/match-view-store'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'
import {
  genericEngineKindOf,
  genericGameTypeOf,
  isGenericV2Event,
  reduceGenericV2Event,
} from '@/frontend/store/projections/generic-v2'
import {
  MATCH_ID,
  POKER_SEAT_IDS,
  pokerEnvelope,
  scriptedPokerMatch,
  scriptedWerewolfMatch,
  werewolfEnvelope,
} from './helpers'

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const AVALON_IDS = ['a1', 'a2', 'a3', 'a4', 'a5']

function avalonEnvelope(
  seq: number,
  engineKind: string,
  payload: Record<string, unknown>,
  actorAgentId: string | null = null,
  visibility: GameEvent['visibility'] = 'public',
): GameEvent {
  return {
    id: `av_${seq}`,
    matchId: MATCH_ID,
    // 第三品类落地前的 fixture cast（见文件头注）。
    gameType: 'avalon' as PlatformGameEvent['gameType'],
    seq,
    occurredAt: new Date(1_723_000_000_000 + seq).toISOString(),
    kind: `avalon:v2:${engineKind}`,
    actorAgentId,
    payload,
    visibility,
    restrictedTo: visibility === 'public' ? null : ['role-restricted'],
  }
}

function avalonScript(): GameEvent[] {
  return [
    avalonEnvelope(1, 'match-started', { playerIds: AVALON_IDS, day: 0 }),
    avalonEnvelope(2, 'phase-entered', { phase: 'night', day: 1 }),
    avalonEnvelope(3, 'action-made', { targetId: 'a2' }, 'a1'),
    avalonEnvelope(4, 'secret-vote', { day: 1 }, 'a2', 'role-restricted'),
    avalonEnvelope(5, 'forced-action', { isDefault: true, day: 1 }, 'a3'),
    avalonEnvelope(6, 'phase-entered', { phase: 'day', day: 2 }),
    avalonEnvelope(7, 'game-ended', {
      winner: 'resistance',
      day: 2,
      reveal: AVALON_IDS.map((playerId, index) => ({
        playerId,
        role: index === 1 ? 'minion' : 'resistance',
      })),
    }),
  ]
}

function rosterOf(ids: readonly string[]): PokerUiPlayer[] {
  return ids.map((agentId, index) => ({
    agentId,
    displayName: agentId.toUpperCase(),
    avatarEmoji: '🤖',
    seatIndex: index,
    chips: 0,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }))
}

/** 直接以通用归约器归约一条流（绕过 poker/werewolf 专属分派，验证锚点一致性）。 */
function reduceAllGeneric(events: GameEvent[]) {
  return events.reduce(
    (state, event) => reduceGenericV2Event(state, event),
    deriveMatchView([], { matchId: MATCH_ID, players: rosterOf(['a1', 'a2', 'a3', 'a4', 'a5']) }),
  ).genericV2
}

// ---------------------------------------------------------------------------
// 信封识别
// ---------------------------------------------------------------------------

describe('generic-v2 — 信封识别', () => {
  it('识别未知品类的 `*:v2:` 信封，排除 poker/werewolf 与非 v2 流', () => {
    expect(isGenericV2Event({ kind: 'avalon:v2:match-started' })).toBe(true)
    expect(isGenericV2Event({ kind: 'poker:v2:match-config' })).toBe(true) // 前缀本身合法（分派顺序保证优先走专属投影）
    expect(isGenericV2Event({ kind: 'werewolf:v2:speech' })).toBe(true)
    expect(isGenericV2Event({ kind: 'poker/state' })).toBe(false)
    expect(isGenericV2Event({ kind: 'agent/thinking' })).toBe(false)
    expect(isGenericV2Event({ kind: ':v2:orphan' })).toBe(false)
    expect(isGenericV2Event({ kind: 'avalon:v2:' })).toBe(false)
  })

  it('拆解 gameType 与 engine2 kind', () => {
    expect(genericGameTypeOf('avalon:v2:match-started')).toBe('avalon')
    expect(genericEngineKindOf('avalon:v2:match-started')).toBe('match-started')
  })
})

// ---------------------------------------------------------------------------
// 未知品类 → 通用视图模型
// ---------------------------------------------------------------------------

describe('generic-v2 — 未知品类四支柱', () => {
  it('avalon 合成流归约出名册/阶段/日志/结算', () => {
    const view = reduceAllGeneric(avalonScript())
    expect(view.gameType).toBe('avalon')
    expect(view.status).toBe('settled')

    // ① 名册锚（playerIds）+ 活动度。
    expect(view.roster.map((row) => row.agentId)).toEqual(AVALON_IDS)
    expect(view.roster.find((row) => row.agentId === 'a1')?.actionCount).toBe(1)
    expect(view.roster.find((row) => row.agentId === 'a4')?.actionCount).toBe(0)
    expect(view.roster.find((row) => row.agentId === 'a5')?.lastActionSeq).toBeNull()

    // ③ 阶段锚（day + phase）→ 轮次计数与边界条带。
    expect(view.cycle).toBe(2)
    expect(view.phase).toBe('day')
    expect(view.boundaries).toEqual([
      { seq: 2, cycle: 1, phase: 'night' },
      { seq: 6, cycle: 2, phase: 'day' },
    ])

    // ② 通用动作日志：全量留痕 + 受限/兜底标记。
    expect(view.log).toHaveLength(7)
    expect(view.log.find((entry) => entry.seq === 4)?.restricted).toBe(true)
    expect(view.log.find((entry) => entry.seq === 4)?.engineKind).toBe('secret-vote')
    expect(view.log.find((entry) => entry.seq === 5)?.isDefault).toBe(true)
    expect(view.log.find((entry) => entry.seq === 3)?.text).toContain('A1')

    // ④ 结算锚（reveal + winner）。
    expect(view.settlement?.winnerLabel).toBe('resistance')
    expect(view.settlement?.rows).toHaveLength(5)
    expect(view.settlement?.rows.find((row) => row.agentId === 'a2')?.role).toBe('minion')
    // rank 缺失时以数组序兜底且唯一。
    const ranks = view.settlement?.rows.map((row) => row.rank) ?? []
    expect(new Set(ranks).size).toBe(5)
    expect(ranks).toContain(1)
  })
})

// ---------------------------------------------------------------------------
// 既有两游戏的锚点一致性（契约回归）
// ---------------------------------------------------------------------------

describe('generic-v2 — 既有两游戏信封满足通用锚点约定', () => {
  it('poker 信封流可被通用归约（seatIds/hand/street/ranking 锚）', () => {
    const script = scriptedPokerMatch()
    const view = reduceAllGeneric(script.events.map((event) => pokerEnvelope(event)))
    expect(view.gameType).toBe('poker')
    expect(view.roster.map((row) => row.agentId)).toEqual([...POKER_SEAT_IDS])
    expect(view.cycle).toBe(script.state.handNumber)
    expect(view.cycle).toBeGreaterThanOrEqual(2)
    expect(view.phase).toBeTypeOf('string')
    expect(view.status).toBe('settled')
    expect(view.settlement?.rows).toHaveLength(POKER_SEAT_IDS.length)
    const champion = view.settlement?.rows.find((row) => row.rank === 1)
    expect(view.settlement?.winnerLabel).toBe(champion?.agentId ?? null)
    expect(view.log).toHaveLength(script.events.length)
  })

  it('werewolf 信封流可被通用归约（seats/day/phase/reveal+winner 锚）', () => {
    const script = scriptedWerewolfMatch()
    const view = reduceAllGeneric(script.events.map((event) => werewolfEnvelope(event)))
    expect(view.gameType).toBe('werewolf')
    expect(view.roster.map((row) => row.agentId)).toHaveLength(6)
    expect(view.cycle).toBe(script.state.day)
    expect(view.phase).toBe('ended')
    expect(view.settlement?.winnerLabel).toBe('wolves')
    expect(view.settlement?.rows.every((row) => typeof row.role === 'string')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// store 分派（未知品类不触碰游戏专属字段）
// ---------------------------------------------------------------------------

describe('generic-v2 — match-view-store 分派', () => {
  it('avalon 流进入 genericV2，poker/werewolf 投影零污染', () => {
    const derived = deriveMatchView(avalonScript(), { matchId: MATCH_ID, players: rosterOf(AVALON_IDS) })
    expect(derived.genericV2.gameType).toBe('avalon')
    expect(derived.genericV2.settlement?.winnerLabel).toBe('resistance')
    expect(derived.events).toHaveLength(7)
    // handNumberAt 以轮次计数分桶。
    expect(derived.events.at(-1)?.handNumberAt).toBe(2)
    // 游戏专属字段零触碰。
    expect(derived.pokerV2.seatIds).toEqual([])
    expect(derived.werewolfV2.roles).toEqual({})
    expect(derived.communityCards).toEqual([])
    expect(derived.pot).toBe(0)
  })

  it('poker 流仍走专属投影（分派优先级不回归）', () => {
    const script = scriptedPokerMatch()
    const derived = deriveMatchView(script.events.map((event) => pokerEnvelope(event)), {
      matchId: MATCH_ID,
      players: rosterOf(POKER_SEAT_IDS),
    })
    expect(derived.pokerV2.seatIds).toEqual([...POKER_SEAT_IDS])
    // 专属分派优先：通用投影不接手既有两游戏。
    expect(derived.genericV2.gameType).toBeNull()
    expect(derived.genericV2.log).toEqual([])
  })
})
