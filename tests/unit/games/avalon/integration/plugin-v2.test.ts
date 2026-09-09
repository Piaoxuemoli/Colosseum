// 阿瓦隆 v2 插件面集成测试：createMatch 预设面 / normalizeAction 别名容错 /
// decisionContext 机械量（AVR-202）/ classify 结算（含刺杀 stats）/
// 呈现契约四支柱符合性 / 旁白触发纯函数。

import { describe, expect, it } from 'vitest'
import { avalonPluginV2 } from '@/games/avalon/integration/plugin-v2'
import { avalonNarrationTrigger } from '@/games/avalon/integration/narration'
import { AVALON_PRESETS, requiredFailsOf } from '@/games/avalon/engine2'
import type { AvalonEngineState } from '@/games/avalon/engine2'
import type { V2Event } from '@/platform/engine/contracts-v2'
import {
  boardOf,
  consultAll,
  propose,
  runApprovedQuest,
  scriptedAssassinationHit,
  speakAll,
  start5,
  voteAll,
} from '../engine2/_helpers'

const AGENTS5 = ['agt_a1', 'agt_a2', 'agt_a3', 'agt_a4', 'agt_a5']

function idsOf(state: AvalonEngineState): string[] {
  return state.players.map((p) => p.playerId)
}

describe('plugin-v2 — createMatch（预设面）', () => {
  it('9 种预设全部可经插件合法开局（人数对齐、事件信封合法）', () => {
    for (const [presetId, preset] of Object.entries(AVALON_PRESETS)) {
      const seats = Object.values(preset.roles).reduce((sum, n) => sum + n, 0)
      const agents = Array.from({ length: seats }, (_, i) => `agt_${presetId}_${i}`)
      const created = avalonPluginV2.createMatch({ preset: presetId }, agents, 'seed-x')
      expect(created.ok, `preset ${presetId}`).toBe(true)
      if (!created.ok) continue
      expect(idsOf(created.state)).toEqual(agents)
      expect(created.state.board.id).toBe(presetId)
      expect(created.state.board.teamSizes).toEqual(preset.teamSizes)
      expect(created.events.every((e) => typeof e.kind === 'string' && typeof e.seq === 'number')).toBe(true)
      const started = created.events.find((e) => e.kind === 'matchStarted')
      expect(started?.audience).toEqual({ kind: 'public' })
    }
  })

  it('缺省 preset = basic-5；lifecycle 注入的 moderatorAgentId 等杂键被忽略', () => {
    const created = avalonPluginV2.createMatch({ moderatorAgentId: 'agt_mod' }, AGENTS5)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.state.board.id).toBe('basic-5')
  })

  it('未知 preset 结构化拒绝 INVALID_BOARD', () => {
    const created = avalonPluginV2.createMatch({ preset: 'nope' }, AGENTS5)
    expect(created.ok).toBe(false)
    if (created.ok) return
    expect(created.rejection.code).toBe('INVALID_BOARD')
    expect(created.rejection.message).toContain('nope')
  })

  it('人数与板子不符结构化拒绝', () => {
    const created = avalonPluginV2.createMatch({ preset: 'basic-6' }, AGENTS5)
    expect(created.ok).toBe(false)
    if (created.ok) return
    expect(created.rejection.code).toBe('INVALID_BOARD')
    expect(created.rejection.message).toContain('6')
  })

  it('同 seed 同 agent 列表 → 同状态（确定性）', () => {
    const a = avalonPluginV2.createMatch({ preset: 'deceit-5' }, AGENTS5, 'fixed-seed')
    const b = avalonPluginV2.createMatch({ preset: 'deceit-5' }, AGENTS5, 'fixed-seed')
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.state).toEqual(b.state)
  })
})

describe('plugin-v2 — normalizeAction（AVR-303 别名容错）', () => {
  it('speak 别名（发言/say/speech）与文本字段别名（content/message/speech）', () => {
    const acc = start5()
    expect(avalonPluginV2.normalizeAction({ type: '发言', content: '我是好人' }, acc.state, 'p1').ok).toBe(true)
    expect(avalonPluginV2.normalizeAction({ type: 'say', message: 'hello' }, acc.state, 'p1').ok).toBe(true)
    const speak = avalonPluginV2.normalizeAction({ type: 'speech', speech: '台词' }, acc.state, 'p1')
    expect(speak.ok).toBe(true)
    if (speak.ok) expect(speak.action).toEqual({ type: 'speak', actorId: 'p1', text: '台词' })
  })

  it('proposeTeam 别名（提名）与名单字段别名（teamIds）；表决中英文词表；语境消歧', () => {
    const acc = start5()
    speakAll(acc)
    const leader = acc.state.pendingActor!
    const team = idsOf(acc.state).slice(0, 2)
    const propose = avalonPluginV2.normalizeAction({ type: '提名', teamIds: team }, acc.state, leader)
    expect(propose.ok).toBe(true)
    if (!propose.ok) return
    expect(propose.action).toEqual({ type: 'proposeTeam', actorId: leader, targetIds: team })

    // 提名阶段提交 vote → 与合法动作集无交集 → UNPARSEABLE（语境消歧）
    const wrongPhase = avalonPluginV2.normalizeAction({ type: '表决', approve: true }, acc.state, leader)
    expect(wrongPhase.ok).toBe(false)

    const applied = avalonPluginV2.applyAction(acc.state, leader, propose.action)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    acc.state = applied.state

    const voter = acc.state.pendingActor!
    const yes = avalonPluginV2.normalizeAction({ type: '表决', choice: '赞成' }, acc.state, voter)
    expect(yes.ok ? yes.action : null).toEqual({ type: 'vote', actorId: voter, approve: true })
    const no = avalonPluginV2.normalizeAction({ type: 'teamvote', vote: 'against' }, acc.state, voter)
    expect(no.ok ? no.action : null).toEqual({ type: 'vote', actorId: voter, approve: false })
  })

  it('quest 词表（mission/失败）：坏人可归一可执行；好人 fail 被 applyAction 拒 ILLEGAL_CHOICE', () => {
    const evilAcc = start5()
    speakAll(evilAcc)
    propose(evilAcc, ['p4', 'p5']) // 双坏队
    voteAll(evilAcc, true)
    expect(evilAcc.state.phase).toBe('quest')
    const evilChooser = evilAcc.state.pendingActor!
    const evilFail = avalonPluginV2.normalizeAction({ type: 'mission', choice: '失败' }, evilAcc.state, evilChooser)
    expect(evilFail.ok).toBe(true)
    if (evilFail.ok) {
      const applied = avalonPluginV2.applyAction(evilAcc.state, evilChooser, evilFail.action)
      expect(applied.ok).toBe(true)
    }

    const goodAcc = start5()
    speakAll(goodAcc)
    propose(goodAcc, ['p1', 'p2']) // 双好队
    voteAll(goodAcc, true)
    const goodChooser = goodAcc.state.pendingActor!
    const words = avalonPluginV2.normalizeAction({ type: 'quest', choice: 'fail' }, goodAcc.state, goodChooser)
    expect(words.ok).toBe(true)
    if (!words.ok) return
    const applied = avalonPluginV2.applyAction(goodAcc.state, goodChooser, words.action)
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.rejection.code).toBe('ILLEGAL_CHOICE')
  })

  it('超长文本：normalize 通过、applyAction 拒 ILLEGAL_CHOICE（默认接管路径）', () => {
    const acc = start5()
    const long = avalonPluginV2.normalizeAction({ type: 'speak', text: '长'.repeat(2500) }, acc.state, 'p1')
    expect(long.ok).toBe(true)
    if (!long.ok) return
    const applied = avalonPluginV2.applyAction(acc.state, 'p1', long.action)
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.rejection.code).toBe('ILLEGAL_CHOICE')
  })

  it('assassinate 别名（kill）与目标字段别名（victim）', () => {
    const acc = start5()
    runApprovedQuest(acc, ['p1', 'p2'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
    runApprovedQuest(acc, ['p1', 'p2'], true)
    consultAll(acc)
    expect(acc.state.phase).toBe('assassination')
    const holder = acc.state.pendingActor!
    const normalized = avalonPluginV2.normalizeAction({ type: 'kill', victim: 'p1' }, acc.state, holder)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    expect(normalized.action).toEqual({ type: 'assassinate', actorId: holder, targetId: 'p1' })
  })
})

describe('plugin-v2 — decisionContext（AVR-202 机械量投影）', () => {
  it('包含板面参数 / 战绩 / 阈值 / 连坐余量 / 该玩家自己的情报 / 公开投票史', () => {
    const acc = start5()
    runApprovedQuest(acc, ['p1', 'p2'], true) // 1-0
    const ctx = avalonPluginV2.decisionContext(acc.state, 'p1')
    const scoreboard = ctx.scoreboard as { successes: number; fails: number; results: unknown[] }
    const voteHistory = ctx.voteHistory as Array<{ round: number; cast: unknown[] }>
    const statements = ctx.statements as { recent: string[]; total: number }
    expect(ctx.round).toBe(2)
    expect(scoreboard).toMatchObject({ successes: 1, fails: 0 })
    expect(scoreboard.results).toEqual([{ round: 1, outcome: 'success', failVotes: 0, requiredFails: 1 }])
    expect(ctx.teamSize).toBe(3) // 轮 2 三人队
    expect(ctx.requiredFails).toBe(1)
    expect(ctx.isDoubleFailRound).toBe(false)
    expect(ctx.rejectionsRemaining).toBe(4) // attempt 1 → 5-1
    expect(ctx.board).toMatchObject({ boardId: 'basic-5', seats: 5, questCount: 5, winsRequired: 3, maxRejections: 5 })
    // 梅林的情报只有自己的 merlin 洞见（basic-5 无莫德雷德 → 见全部坏人）
    expect(ctx.knowledge).toEqual([{ insight: 'merlin', playerIds: ['p4', 'p5'] }])
    // 公开投票史与发言摘要
    expect(voteHistory).toHaveLength(1)
    expect(voteHistory[0].cast).toHaveLength(5)
    expect(statements.total).toBe(5)
  })

  it('双失败轮阈值（basic-6：轮 3=1 / 轮 4=2 / 轮 5=1）', () => {
    const board = boardOf('basic-6')
    expect(requiredFailsOf(board, 3)).toBe(1)
    expect(requiredFailsOf(board, 4)).toBe(2)
    expect(requiredFailsOf(board, 5)).toBe(1)
  })

  it('consultationQueue 仅对坏人可见（AVR-204 无越权）', () => {
    const acc = start5()
    runApprovedQuest(acc, ['p1', 'p2'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
    runApprovedQuest(acc, ['p1', 'p2'], true)
    expect(acc.state.phase).toBe('evilConsultation')
    const evilCtx = avalonPluginV2.decisionContext(acc.state, 'p4')
    const goodCtx = avalonPluginV2.decisionContext(acc.state, 'p1')
    expect((evilCtx.consultationQueue as string[]).sort()).toEqual(['p4', 'p5'])
    expect(goodCtx.consultationQueue).toBeNull()
    // 好人的 knowledge 不含 evil 洞见
    expect((goodCtx.knowledge as Array<{ insight: string }>).every((k) => k.insight !== 'evil')).toBe(true)
  })
})

describe('plugin-v2 — classify 结算（AVR-404）', () => {
  it('刺杀命中局：stats 带刺杀事实，排名 = 胜方全员前段（组内座位序）', () => {
    const acc = scriptedAssassinationHit()
    const classification = avalonPluginV2.classify(acc.state)
    expect(classification.kind).toBe('finished')
    if (classification.kind !== 'finished') return
    expect(classification.result.winnerFaction).toBe('evil')
    expect(classification.result.stats).toMatchObject({
      basis: 'quests:3-0;assassination-hit',
      successes: 3,
      fails: 0,
      rounds: 3,
    })
    expect(classification.result.stats?.assassination).toEqual({
      assassinId: 'p4',
      targetId: 'p1',
      hitMerlin: true,
    })
    const ranking = classification.result.ranking
    expect(ranking.map((row) => row.agentId)).toEqual(['p4', 'p5', 'p1', 'p2', 'p3'])
    expect(ranking.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5])
    expect(ranking.every((row) => typeof row.extra?.role === 'string')).toBe(true)
  })

  it('进行中：awaiting-action 指向 pendingActor', () => {
    const acc = start5()
    expect(avalonPluginV2.classify(acc.state)).toEqual({ kind: 'awaiting-action', actorAgentId: 'p1' })
  })
})

describe('plugin-v2 — 呈现契约四支柱（presentation-contract spec）', () => {
  const VALID_CATEGORIES = new Set([
    'action',
    'speech',
    'vote',
    'phase',
    'reveal',
    'award',
    'death',
    'system',
    'error',
  ])

  it('eventHints 覆盖全部 15 个权威 kind 且形状合法', () => {
    const hints = avalonPluginV2.presentation.eventHints()
    for (const kind of [
      'matchStarted',
      'randomnessSeed',
      'rolesAssigned',
      'knowledgeRevealed',
      'phaseEntered',
      'leaderAssigned',
      'statementIssued',
      'evilConsulted',
      'teamProposed',
      'voteCast',
      'voteResult',
      'questChoice',
      'questResult',
      'assassinationDeclared',
      'gameEnded',
    ]) {
      expect(hints, `hint 缺失 ${kind}`).toHaveProperty(kind)
    }
    for (const [kind, hint] of Object.entries(hints)) {
      expect(hint.label.length, `hint ${kind} label 非空`).toBeGreaterThan(0)
      expect(VALID_CATEGORIES.has(hint.category), `hint ${kind} category 非法`).toBe(true)
    }
    // 口径：voteCast 公开记名 → 非 godOnly；合议/抉择受限
    expect(hints.voteCast?.godOnly).toBeUndefined()
    expect(hints.evilConsulted?.godOnly).toBe(true)
    expect(hints.questChoice?.godOnly).toBe(true)
  })

  it('situation 纯函数 + 名册覆盖 + 焦点合法；settlement 未终局 null / 终局全覆盖', () => {
    const initial = start5().state
    const final = scriptedAssassinationHit().state
    const situation = avalonPluginV2.presentation.situation(initial)
    expect(avalonPluginV2.presentation.situation(initial)).toEqual(situation)
    expect(situation.players.map((row) => row.agentId).sort()).toEqual([...idsOf(initial)].sort())
    expect(situation.focusAgentId).toBe('p1')
    expect(avalonPluginV2.presentation.settlement(initial)).toBeNull()

    const settlement = avalonPluginV2.presentation.settlement(final)
    expect(settlement).not.toBeNull()
    if (!settlement) return
    expect(settlement.winnerLabel).toBe('坏人阵营')
    expect(settlement.rows.map((row) => row.agentId).sort()).toEqual([...idsOf(final)].sort())
    const ranks = settlement.rows.map((row) => row.rank)
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(ranks).toContain(1)
    expect(settlement.digest.some((entry) => entry.label === '刺杀裁决')).toBe(true)
  })

  it('phaseModel：7 阶段全集、cycle = 轮次、边界单调', () => {
    const acc = scriptedAssassinationHit()
    const model = avalonPluginV2.presentation.phaseModel(
      acc.state,
      acc.events as unknown as Record<string, unknown>[],
    )
    expect(model.phases).toEqual([
      'discussion',
      'proposal',
      'teamVote',
      'quest',
      'evilConsultation',
      'assassination',
      'ended',
    ])
    expect(model.current).toBe('ended')
    expect(model.cycle).toBe(3)
    expect(model.boundaries.length).toBeGreaterThan(0)
    for (let i = 1; i < model.boundaries.length; i++) {
      expect(model.boundaries[i].seq).toBeGreaterThan(model.boundaries[i - 1].seq)
      expect(model.boundaries[i].cycle).toBeGreaterThanOrEqual(model.boundaries[i - 1].cycle)
    }
  })
})

describe('integration/narration — 旁白触发纯函数（AVR-OD-6）', () => {
  function envelopeOf(event: { kind: string; seq: number; audience: { kind: string }; actorId: string | null }): V2Event {
    return {
      kind: event.kind,
      seq: event.seq,
      actorAgentId: event.actorId,
      isDefault: false,
      audience: event.audience as V2Event['audience'],
      raw: event as unknown as Record<string, unknown>,
    }
  }

  it('任务结算触发；digest 仅由公开事件渲染（种子/发牌/抉择不入 digest）', () => {
    const acc = start5()
    runApprovedQuest(acc, ['p1', 'p2'], true)
    const batch = acc.events
      .filter((e) => e.kind === 'questResult')
      .map(envelopeOf)
    const context = acc.events.map((e) => ({ ...e }) as unknown as Record<string, unknown>)

    const trigger = avalonNarrationTrigger(acc.state, batch, context)
    expect(trigger).not.toBeNull()
    if (!trigger) return
    expect(trigger.focusKinds).toEqual(['questResult'])
    expect(trigger.publicDigest.some((line) => line.includes('任务成功'))).toBe(true)
    // 受众过滤：种子 / 发牌 / 个人抉择事件绝不渲染
    expect(trigger.publicDigest.every((line) => !line.includes('种子'))).toBe(true)
    expect(trigger.publicDigest.every((line) => !line.includes('身份分发'))).toBe(true)
  })

  it('终局（含连坐）与刺杀揭晓触发；非关键批返回 null', () => {
    const ended = scriptedAssassinationHit()
    const context = ended.events.map((e) => ({ ...e }) as unknown as Record<string, unknown>)

    const endedBatch = ended.events.filter((e) => e.kind === 'gameEnded').map(envelopeOf)
    const endedTrigger = avalonNarrationTrigger(ended.state, endedBatch, context)
    expect(endedTrigger?.focusKinds).toEqual(['gameEnded'])
    expect(endedTrigger?.publicDigest.some((line) => line.includes('终局'))).toBe(true)

    const declaredBatch = ended.events.filter((e) => e.kind === 'assassinationDeclared').map(envelopeOf)
    const declaredTrigger = avalonNarrationTrigger(ended.state, declaredBatch, [])
    expect(declaredTrigger?.focusKinds).toEqual(['assassinationDeclared'])
    expect(declaredTrigger?.publicDigest.some((line) => line.includes('指认'))).toBe(true)

    const quiet = start5()
    const quietBatch = quiet.events.filter((e) => e.kind === 'matchStarted').map(envelopeOf)
    expect(avalonNarrationTrigger(quiet.state, quietBatch, [])).toBeNull()
  })
})
