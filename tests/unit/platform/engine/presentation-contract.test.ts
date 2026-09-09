// 品类呈现契约一致性门禁（spec: docs/specs/presentation-contract.md §5）。
//
// assertPresentationContract 是可复用断言器：对任一注册游戏的确定性短局脚本
// 验证四支柱（态势 / 事件流 hints / 阶段模型 / 结算）满足契约。R3-2 / R4-1
// 的新品类接入必须跑通本门禁（FR-4.5-03 + NFR-08 的可执行验证形态）。
//
// 脚本复用 engine2 纯逻辑驱动的既有 fixtures（tests/unit/.../helpers.ts），
// 事件形状与生产落库 payload 一致。

import { describe, expect, it } from 'vitest'
import { createMatch as pokerCreateMatch } from '@/games/poker/engine2'
import { pokerPluginV2 } from '@/games/poker/integration/plugin-v2'
import { werewolfPluginV2 } from '@/games/werewolf/integration/plugin-v2'
import { avalonPluginV2 } from '@/games/avalon/integration/plugin-v2'
import type { GameModuleV2 } from '@/platform/engine/contracts-v2'
import type { PresentationEventCategory } from '@/platform/engine/presentation'
import { SEATING_6, start6 } from '../../games/werewolf/engine2/_helpers'
import { IDS5, scriptedAvalonMatch, start5 } from '../../games/avalon/engine2/_helpers'
import {
  POKER_SEAT_IDS,
  WEREWOLF_PLAYER_IDS,
  scriptedPokerMatch,
  scriptedWerewolfMatch,
} from '../../frontend/store/projections/helpers'

// ---------------------------------------------------------------------------
// 可复用断言器（新品类接入照抄本节调用方式）
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: ReadonlySet<PresentationEventCategory> = new Set([
  'action',
  'speech',
  'vote',
  'phase',
  'reveal',
  'award',
  'death',
  'system',
  'error',
] as const satisfies readonly PresentationEventCategory[])

export interface PresentationContractCase<TState> {
  /** 待验插件（具体泛型形态；registry 侧以 GameModuleV2<unknown, unknown> 存储）。 */
  module: GameModuleV2<TState, unknown>
  /** 开局（未终局）state：④ settlement 必须为 null。 */
  initialState: TState
  /** 终局 state：④ settlement 必须非 null。 */
  finalState: TState
  /** 整场事件流（DB payload 形态 = engine2 事件 JSON）。 */
  fullStream: Record<string, unknown>[]
  /** 完整参赛名册。 */
  rosterAgentIds: string[]
}

export function assertPresentationContract<TState>(testCase: PresentationContractCase<TState>): void {
  const { module, initialState, finalState, fullStream, rosterAgentIds } = testCase
  const presentation = module.presentation

  // ── ① 态势视图：确定性 + 名册覆盖 + 焦点合法 ──
  const initialSituation = presentation.situation(initialState)
  expect(presentation.situation(initialState), 'situation 必须是纯函数（两次调用深度相等）').toEqual(initialSituation)
  expect(initialSituation.players.map((row) => row.agentId).sort()).toEqual([...rosterAgentIds].sort())
  if (initialSituation.focusAgentId !== null) {
    expect(rosterAgentIds).toContain(initialSituation.focusAgentId)
  }
  for (const row of initialSituation.players) {
    expect(row.status === 'active' || row.status === 'sidelined' || row.status === 'eliminated').toBe(true)
    for (const resource of row.resources) {
      expect(resource.label.length).toBeGreaterThan(0)
      expect(typeof resource.value).toBe('number')
    }
  }
  for (const common of initialSituation.commons) {
    expect(common.label.length).toBeGreaterThan(0)
    expect(common.value.length).toBeGreaterThan(0)
  }
  // 终局态势仍覆盖名册（淘汰者保留占位，座位稳定）。
  expect(presentation.situation(finalState).players.map((row) => row.agentId).sort()).toEqual(
    [...rosterAgentIds].sort(),
  )

  // ── ② 事件流 hints：脚本流全覆盖 + 形状合法 ──
  const hints = presentation.eventHints()
  const streamKinds = new Set(fullStream.map((event) => String(event.kind)))
  expect(streamKinds.size).toBeGreaterThan(0)
  for (const kind of streamKinds) {
    expect(hints, `eventHints 必须覆盖脚本流中出现的 kind "${kind}"`).toHaveProperty(kind)
  }
  for (const [kind, hint] of Object.entries(hints)) {
    expect(hint.label.length, `hint "${kind}" 需要非空中文 label`).toBeGreaterThan(0)
    expect(VALID_CATEGORIES.has(hint.category), `hint "${kind}" category 非法: ${String(hint.category)}`).toBe(true)
  }

  // ── ③ 阶段模型：current 合法 + 边界单调 + 不依赖流的状态派生 ──
  const phaseModel = presentation.phaseModel(finalState, fullStream)
  expect(phaseModel.phases.length).toBeGreaterThan(0)
  if (phaseModel.current !== null) {
    expect(phaseModel.phases).toContain(phaseModel.current)
  }
  expect(phaseModel.cycle, '终局轮次计数必须推进（≥1）').toBeGreaterThan(0)
  const boundaries = phaseModel.boundaries
  for (let i = 1; i < boundaries.length; i++) {
    expect(boundaries[i].seq, 'boundaries 必须按 seq 严格递增').toBeGreaterThan(boundaries[i - 1].seq)
    expect(boundaries[i].cycle).toBeGreaterThanOrEqual(boundaries[i - 1].cycle)
  }
  for (const boundary of boundaries) {
    expect(phaseModel.phases).toContain(boundary.phase)
  }
  const stateOnly = presentation.phaseModel(finalState)
  expect(stateOnly.current).toBe(phaseModel.current)
  expect(stateOnly.cycle).toBe(phaseModel.cycle)

  // ── ④ 结算结构：未终局 null；终局覆盖名册 + rank 唯一含 1 ──
  expect(presentation.settlement(initialState), '未终局 settlement 必须为 null').toBeNull()
  const settlement = presentation.settlement(finalState)
  expect(settlement).not.toBeNull()
  if (!settlement) return // 供 TS 收窄（上面已断言非空）
  expect(settlement.rows.map((row) => row.agentId).sort()).toEqual([...rosterAgentIds].sort())
  const ranks = settlement.rows.map((row) => row.rank).filter((rank): rank is number => rank !== null)
  expect(new Set(ranks).size, 'rank 必须唯一').toBe(ranks.length)
  expect(ranks).toContain(1)
  expect(settlement.winnerLabel === null || settlement.winnerLabel.length > 0).toBe(true)
  for (const entry of settlement.digest) {
    expect(entry.label.length).toBeGreaterThan(0)
  }
}

// ---------------------------------------------------------------------------
// 两既有游戏的确定性短局脚本
// ---------------------------------------------------------------------------

/** 德扑开局 state（与 scriptedPokerMatch 同配置同种子，手 1 未终局）。 */
function pokerInitialState(): ReturnType<typeof scriptedPokerMatch>['state'] {
  const outcome = pokerCreateMatch(
    { seatIds: [...POKER_SEAT_IDS], startingStack: 200, blinds: { sb: 5, bb: 10 } },
    'engine2-projection-test',
  )
  if (!outcome.ok) throw new Error(outcome.rejection.message)
  return outcome.state
}

// ---------------------------------------------------------------------------
// 门禁执行（新品类接入时在此追加同形 case）
// ---------------------------------------------------------------------------

describe('presentation contract — assertPresentationContract（R3-2 新品类复用）', () => {
  it('poker 插件满足四支柱契约', () => {
    const script = scriptedPokerMatch()
    assertPresentationContract({
      module: pokerPluginV2,
      initialState: pokerInitialState(),
      finalState: script.state,
      fullStream: script.events as unknown as Record<string, unknown>[],
      rosterAgentIds: [...POKER_SEAT_IDS],
    })
  })

  it('werewolf 插件满足四支柱契约', () => {
    const script = scriptedWerewolfMatch()
    assertPresentationContract({
      module: werewolfPluginV2,
      initialState: start6(SEATING_6).state,
      finalState: script.state,
      fullStream: script.events as unknown as Record<string, unknown>[],
      rosterAgentIds: [...WEREWOLF_PLAYER_IDS],
    })
  })

  // R3-2 新品类冒烟：简化阿瓦隆经同一门禁（FR-4.5-03 后半 + NFR-08）。
  it('avalon 插件满足四支柱契约', () => {
    const script = scriptedAvalonMatch()
    assertPresentationContract({
      module: avalonPluginV2,
      initialState: start5().state,
      finalState: script.state,
      fullStream: script.events as unknown as Record<string, unknown>[],
      rosterAgentIds: [...IDS5],
    })
  })

  it('avalon 四支柱语义抽查（阵营/轮次/任务战绩/揭示）', () => {
    const script = scriptedAvalonMatch()
    // 终局后无 pendingActor → focus 为空
    expect(avalonPluginV2.presentation.situation(script.state).focusAgentId).toBeNull()
    expect(
      avalonPluginV2.presentation.situation(script.state).commons.some(
        (common) => common.label === '任务战绩' && common.value === '1成功 / 2失败',
      ),
    ).toBe(true)
    expect(avalonPluginV2.presentation.phaseModel(script.state).cycle).toBe(script.state.round)
    const settlement = avalonPluginV2.presentation.settlement(script.state)
    expect(settlement?.winnerLabel).toBe('坏人阵营')
    expect(settlement?.rows.every((row) => typeof row.role === 'string')).toBe(true)
    const hints = avalonPluginV2.presentation.eventHints()
    expect(hints['knowledgeRevealed']?.godOnly).toBe(true)
    expect(hints['questChoice']?.godOnly).toBe(true)
    expect(hints['questResult']?.category).toBe('award')
  })

  it('德扑四支柱语义抽查（筹码/手数/街/冠军）', () => {
    const script = scriptedPokerMatch()
    const situation = pokerPluginV2.presentation.situation(script.state)
    expect(situation.players.every((row) => row.resources[0]?.label === '筹码')).toBe(true)
    expect(pokerPluginV2.presentation.phaseModel(script.state).current).toBe('finished')
    expect(pokerPluginV2.presentation.phaseModel(script.state).cycle).toBe(script.state.handNumber)
    const settlement = pokerPluginV2.presentation.settlement(script.state)
    expect(settlement?.winnerLabel).toBe(settlement?.rows.find((row) => row.rank === 1)?.agentId ?? null)
    const hints = pokerPluginV2.presentation.eventHints()
    expect(hints['hole-cards-dealt']?.godOnly).toBe(true)
    expect(hints['player-eliminated']?.category).toBe('death')
  })

  it('狼人杀四支柱语义抽查（存活/身份/阵营胜利）', () => {
    const script = scriptedWerewolfMatch()
    const situation = werewolfPluginV2.presentation.situation(script.state)
    // 终局后无 pendingActor → focus 为空。
    expect(situation.focusAgentId).toBeNull()
    expect(situation.commons.some((common) => common.label === '存活')).toBe(true)
    const settlement = werewolfPluginV2.presentation.settlement(script.state)
    expect(settlement?.winnerLabel).toBe('狼人阵营')
    expect(settlement?.rows.every((row) => typeof row.role === 'string')).toBe(true)
    const hints = werewolfPluginV2.presentation.eventHints()
    expect(hints['speech']?.category).toBe('speech')
    expect(hints['deathsAnnounced']?.category).toBe('death')
    expect(hints['rolesAssigned']?.godOnly).toBe(true)
  })

  it('registry 存储：两游戏 presentation 可无断言注册读取（无 gameType 分支）', async () => {
    const { registerAllGames } = await import('@/platform/core/register-games')
    const registry = await import('@/platform/core/registry')
    // registerAllGames 幂等（Map.set）；不 clear，保持与生产惰性初始化同态。
    registerAllGames()
    for (const gameType of ['poker', 'werewolf', 'avalon'] as const) {
      const module: GameModuleV2<unknown, unknown> = registry.getGameV2(gameType)
      expect(module.presentation).toBeDefined()
      expect(typeof module.presentation.situation).toBe('function')
      expect(typeof module.presentation.eventHints).toBe('function')
      expect(typeof module.presentation.phaseModel).toBe('function')
      expect(typeof module.presentation.settlement).toBe('function')
    }
  })
})
