// 阿瓦隆 v2 投影（src/frontend/store/projections/avalon-v2.ts）：
// 用冻结契约构造的整场事件流（avalon-helpers，不依赖引擎真实代码）验证——
// 15 种事件 kind 的累积、任务板战绩/连坐/赛点派生量、三视角（AVR-205）
// 的可见性剥离（身份 / 密谋 / 知识 / 任务抉择）、未知 kind 静默降级、
// store 分派与增量/批量等价、回放锚点（轮次 + 刺杀环节）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveMatchView, useMatchViewStore } from '@/frontend/store/match-view-store'
import type { MatchViewProjection } from '@/frontend/store/match-view-store'
import {
  AVALON_V2_PREFIX,
  avalonAssassinOf,
  avalonCurrentTeamOf,
  avalonEvilPlayerIdsOf,
  avalonGoodAtMatchPoint,
  avalonPerspectiveOf,
  avalonRejectionCountOf,
  avalonReplayBoundaries,
  avalonScoreOf,
  deriveAvalonView,
  emptyAvalonV2,
  reduceAvalonV2Event,
} from '@/frontend/store/projections/avalon-v2'
import type { GameEvent } from '@/platform/core/types'
import { AVALON_ROSTER, MATCH_ID, avalonEnvelope, scriptedAvalonMatch } from './avalon-helpers'

const events = scriptedAvalonMatch()

function derive(viewMode: 'god' | 'public', upto?: number): MatchViewProjection {
  const slice = upto === undefined ? events : events.slice(0, upto + 1)
  return deriveMatchView(slice, { matchId: MATCH_ID, players: AVALON_ROSTER }, viewMode)
}

function accAt(upto?: number) {
  return events
    .slice(0, upto === undefined ? undefined : upto + 1)
    .reduce(reduceAvalonV2Event, emptyAvalonV2())
}

const indexOfKind = (kind: string, occurrence = 0): number => {
  const indices = events.map((event, index) => (event.kind === `${AVALON_V2_PREFIX}${kind}` ? index : -1)).filter((i) => i >= 0)
  const found = indices[occurrence]
  if (found === undefined) throw new Error(`no ${kind} event (occurrence ${occurrence})`)
  return found
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(1_723_000_000_000)
  useMatchViewStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
  useMatchViewStore.getState().reset()
})

describe('avalon v2 projection — 冻结契约 15 种事件的累积', () => {
  it('1) matchStarted：名册座位 + 板子参数 + 任务槽初始化 + 状态 live', () => {
    const acc = accAt(indexOfKind('matchStarted'))
    expect(acc.seats).toEqual([
      { seat: 1, playerId: 'p1' },
      { seat: 2, playerId: 'p2' },
      { seat: 3, playerId: 'p3' },
      { seat: 4, playerId: 'p4' },
      { seat: 5, playerId: 'p5' },
    ])
    expect(acc.boardId).toBe('deceit-5')
    expect(acc.boardName).toBe('欺瞒 5 人')
    expect(acc.questCount).toBe(5)
    expect(acc.teamSizes).toEqual([2, 3, 2, 3, 3])
    expect(acc.doubleFailRounds).toEqual([])
    expect(acc.discussionEnabled).toBe(true)
    expect(acc.roleCounts).toEqual({ merlin: 1, percival: 1, loyalServant: 1, assassin: 1, morgana: 1 })
    expect(acc.quests.map((quest) => quest.teamSize)).toEqual([2, 3, 2, 3, 3])
    expect(acc.quests.every((quest) => quest.status === 'pending' && quest.requiredFails === 1)).toBe(true)
    expect(acc.status).toBe('live')
  })

  it('2) randomnessSeed：种子累积（delayed-public 真相）', () => {
    const acc = accAt(indexOfKind('randomnessSeed'))
    expect(acc.seed).toBe(20260909)
  })

  it('3) rolesAssigned：role-self 受众的玩家 id 提取与角色累积', () => {
    const acc = accAt(indexOfKind('rolesAssigned', 4))
    expect(acc.roles).toEqual({ p1: 'merlin', p2: 'percival', p3: 'loyalServant', p4: 'assassin', p5: 'morgana' })
  })

  it('4) knowledgeRevealed：夜间知识条目（梅林/派西维尔混排/坏人互识）', () => {
    const acc = accAt(indexOfKind('knowledgeRevealed', 3))
    expect(acc.knowledge).toEqual([
      { playerId: 'p1', insight: 'merlin', playerIds: ['p4', 'p5'] },
      { playerId: 'p2', insight: 'percival', playerIds: ['p1', 'p5'] },
      { playerId: 'p4', insight: 'evil', playerIds: ['p5'] },
      { playerId: 'p5', insight: 'evil', playerIds: ['p4'] },
    ])
  })

  it('5) phaseEntered：阶段推进；quest 阶段标记任务槽进行中；ended 置 settled', () => {
    const questEnter = indexOfKind('phaseEntered', 3) // R1 进入任务阶段
    const atQuest = accAt(questEnter)
    expect(atQuest.phase).toBe('quest')
    expect(atQuest.quests[0].status).toBe('ongoing')
    expect(atQuest.quests[1].status).toBe('pending')

    const final = accAt()
    expect(final.phase).toBe('ended')
    expect(final.status).toBe('settled')
  })

  it('6) leaderAssigned：轮次/提案序/队长/待行动者', () => {
    const acc = accAt(indexOfKind('leaderAssigned', 1)) // R2 第 1 次提名
    expect(acc.round).toBe(2)
    expect(acc.attempt).toBe(1)
    expect(acc.leaderId).toBe('p2')
    expect(acc.pendingActor).toBe('p2')
  })

  it('7) statementIssued：发言史（speakerId + text + 轮次）', () => {
    const acc = accAt(indexOfKind('statementIssued', 4)) // R1 五条发言齐
    const roundOne = acc.statements.filter((statement) => statement.round === 1)
    expect(roundOne).toHaveLength(5)
    expect(roundOne[0]).toMatchObject({ speakerId: 'p1', text: '第 1 轮 p1 的发言', kind: 'discussion' })
  })

  it('8) evilConsulted：密谋发言；坏人组多副本下发去重', () => {
    const acc = accAt(indexOfKind('evilConsulted', 2))
    const consultations = acc.statements.filter((statement) => statement.kind === 'consultation')
    expect(consultations).toHaveLength(2)
    expect(consultations.map((statement) => statement.speakerId)).toEqual(['p4', 'p5'])
  })

  it('9) teamProposed：提案史（轮次/提案序/队长/队伍）', () => {
    const acc = accAt(indexOfKind('teamProposed', 1))
    expect(acc.proposals[1]).toEqual({ round: 2, attempt: 1, leaderId: 'p2', teamIds: ['p2', 'p4', 'p5'] })
  })

  it('10) voteCast：记名投票史', () => {
    const acc = accAt(indexOfKind('voteCast', 2))
    expect(acc.voteRecords.slice(0, 3)).toEqual([
      { round: 1, attempt: 1, voterId: 'p1', approve: true },
      { round: 1, attempt: 1, voterId: 'p2', approve: true },
      { round: 1, attempt: 1, voterId: 'p3', approve: true },
    ])
  })

  it('11) voteResult：汇总（计数 + 结果）；本轮连坐计数派生', () => {
    const acc = accAt(indexOfKind('voteResult', 1)) // R2 第 1 次被拒
    expect(acc.voteTallies[1]).toEqual({ round: 2, attempt: 1, approvals: 2, rejections: 3, outcome: 'rejected' })
    expect(acc.round).toBe(2)
    expect(avalonRejectionCountOf(acc)).toBe(1)
  })

  it('12) questChoice：role-self 抉择累积（playerId 从受众提取）', () => {
    const acc = accAt(indexOfKind('questChoice', 2)) // R2 三张牌
    expect(acc.questChoices).toEqual([
      { playerId: 'p1', round: 1, succeed: true },
      { playerId: 'p3', round: 1, succeed: true },
      { playerId: 'p1', round: 2, succeed: true },
    ])
  })

  it('13) questResult：任务槽结算 + 失败张数 + 比分 3:1', () => {
    const acc = accAt()
    expect(acc.quests.map((quest) => [quest.status, quest.failVotes])).toEqual([
      ['success', 0],
      ['fail', 1],
      ['success', 0],
      ['success', 0],
      ['pending', null],
    ])
    expect(avalonScoreOf(acc)).toEqual({ successes: 3, fails: 1 })
  })

  it('14) assassinationDeclared：刺杀者与目标', () => {
    const acc = accAt(indexOfKind('assassinationDeclared'))
    expect(acc.assassination).toEqual({ assassinId: 'p4', targetId: 'p1' })
  })

  it('15) gameEnded：胜方/依据/reveal 并把身份并入职累', () => {
    const acc = accAt()
    expect(acc.ended?.winner).toBe('evil')
    expect(acc.ended?.basis).toBe('刺杀命中梅林（任务 3:1）')
    expect(acc.ended?.reveal).toHaveLength(5)
    expect(acc.ended?.reveal[0]).toEqual({ playerId: 'p1', seat: 1, role: 'merlin' })
    expect(acc.status).toBe('settled')
    expect(acc.roles).toEqual({ p1: 'merlin', p2: 'percival', p3: 'loyalServant', p4: 'assassin', p5: 'morgana' })
  })

  it('未知 kind：静默忽略（不抛错、不污染已知字段）', () => {
    const before = accAt(indexOfKind('questResult', 0))
    const unknown: GameEvent = avalonEnvelope('someFutureKind', { whatever: true })
    const after = reduceAvalonV2Event(before, unknown)
    expect(after.seats).toEqual(before.seats)
    expect(after.quests).toEqual(before.quests)
    expect(after.statements).toEqual(before.statements)
    expect(after.round).toBe(before.round)
  })

  it('信封平铺回退：载荷字段在信封层（非嵌套 payload）也能读取', () => {
    const flat: GameEvent = {
      ...avalonEnvelope('statementIssued', {}, { actorId: 'p2', round: 1 }),
      payload: { seq: 999, round: 1, audience: { kind: 'public' }, actorId: 'p2', kind: 'statementIssued', speakerId: 'p2', text: '平铺载荷发言' },
    }
    const acc = reduceAvalonV2Event(accAt(indexOfKind('matchStarted')), flat)
    expect(acc.statements.at(-1)).toMatchObject({ speakerId: 'p2', text: '平铺载荷发言', round: 1 })
  })
})

describe('avalon v2 projection — 派生量', () => {
  it('好人 3 成功即赛点（终局前）；终局后不再警示', () => {
    const atThirdSuccess = accAt(indexOfKind('questResult', 3)) // R4 结算 = 第 3 次成功
    expect(avalonScoreOf(atThirdSuccess).successes).toBe(3)
    expect(avalonGoodAtMatchPoint(atThirdSuccess)).toBe(true)
    expect(avalonGoodAtMatchPoint(accAt())).toBe(false)
  })

  it('当前任务队伍 = 本轮已获批提案；刺杀者 = 刺客角色卡', () => {
    const atQuest2 = accAt(indexOfKind('questChoice', 4)) // R2 队伍执行中
    expect(avalonCurrentTeamOf(atQuest2)).toEqual(['p1', 'p2', 'p4'])
    const final = accAt()
    expect(avalonEvilPlayerIdsOf(final)).toEqual(['p4', 'p5'])
    expect(avalonAssassinOf(final)).toBe('p4')
  })

  it('连坐计数：同一轮 4 次拒绝后达到「再拒一次坏人直接胜」警示线', () => {
    let acc = accAt(indexOfKind('matchStarted'))
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      acc = reduceAvalonV2Event(
        acc,
        avalonEnvelope('leaderAssigned', { round: 1, attempt, leaderId: 'p1' }, { actorId: 'p1', round: 1 }),
      )
      acc = reduceAvalonV2Event(
        acc,
        avalonEnvelope('voteResult', { round: 1, attempt, approvals: 2, rejections: 3, outcome: 'rejected' }, { round: 1 }),
      )
    }
    expect(avalonRejectionCountOf(acc)).toBe(4)
  })
})

describe('avalon v2 projection — 三视角可见性（AVR-205）', () => {
  // 裁到刺杀指认前：身份未揭示、密谋已发生。
  const preReveal = accAt(indexOfKind('assassinationDeclared') - 1)

  it('god 视角：全量身份 + 密谋全文 + 全部知识', () => {
    const view = deriveAvalonView(preReveal, 'god', null)
    expect(Object.keys(view.visibleRoles)).toHaveLength(5)
    expect(view.visibleRoles.p1).toBe('merlin')
    expect(view.statements.every((statement) => !statement.hidden)).toBe(true)
    expect(view.statements.some((statement) => statement.kind === 'consultation')).toBe(true)
    expect(view.knowledge).toHaveLength(4)
    expect(view.seesEvilChannel).toBe(true)
    // AVR-108：任务抉择个体立场连上帝视角也不给（只给计数）。
    expect(view.ownQuestChoices).toEqual([])
  })

  it('public 视角：终局前身份遮蔽 + 密谋占位 + 无知识面板数据', () => {
    const view = deriveAvalonView(preReveal, 'public', null)
    expect(view.visibleRoles).toEqual({})
    expect(view.revealed).toBe(false)
    const consultations = view.statements.filter((statement) => statement.kind === 'consultation')
    expect(consultations.every((statement) => statement.hidden)).toBe(true)
    expect(view.knowledge).toEqual([])
    expect(view.seesEvilChannel).toBe(false)
    // 终局后 reveal 生效：身份对 public 视角揭示。
    const afterEnd = deriveAvalonView(accAt(), 'public', null)
    expect(afterEnd.revealed).toBe(true)
    expect(Object.keys(afterEnd.visibleRoles)).toHaveLength(5)
  })

  it('单玩家视角（好人 p3）：本人身份 + 无密谋 + 无知识（忠诚仆从无夜间情报）', () => {
    const view = deriveAvalonView(preReveal, 'player', 'p3')
    expect(view.visibleRoles).toEqual({ p3: 'loyalServant' })
    expect(view.statements.filter((statement) => statement.kind === 'consultation').every((statement) => statement.hidden)).toBe(true)
    expect(view.seesEvilChannel).toBe(false)
    expect(view.knowledge).toEqual([])
  })

  it('单玩家视角（坏人 p5）：坏人频道可见 + 本人密谋全文', () => {
    const view = deriveAvalonView(preReveal, 'player', 'p5')
    expect(view.visibleRoles).toEqual({ p5: 'morgana' })
    expect(view.seesEvilChannel).toBe(true)
    expect(view.statements.filter((statement) => statement.kind === 'consultation').every((statement) => statement.hidden)).toBe(false)
  })

  it('单玩家视角（梅林 p1）：本人身份 + 本人知识条目 + 本人任务抉择', () => {
    const view = deriveAvalonView(accAt(indexOfKind('questResult', 1)), 'player', 'p1')
    expect(view.visibleRoles).toEqual({ p1: 'merlin' })
    expect(view.knowledge).toEqual([{ playerId: 'p1', insight: 'merlin', playerIds: ['p4', 'p5'] }])
    expect(view.ownQuestChoices).toEqual([
      { playerId: 'p1', round: 1, succeed: true },
      { playerId: 'p1', round: 2, succeed: true },
    ])
  })

  it('待行动者推导：讨论（座位序下一个）/ 表决（未投票者）/ 任务（未出牌者）/ 指认（public 不点名）', () => {
    const atThirdStatement = accAt(indexOfKind('statementIssued', 2))
    expect(deriveAvalonView(atThirdStatement, 'god', null).pendingActors).toEqual(['p4'])

    const atThirdVote = accAt(indexOfKind('voteCast', 2))
    expect(deriveAvalonView(atThirdVote, 'god', null).pendingActors).toEqual(['p4', 'p5'])

    const atFirstChoice = accAt(indexOfKind('questChoice', 0))
    expect(deriveAvalonView(atFirstChoice, 'god', null).pendingActors).toEqual(['p3'])

    const atAssassination = accAt(indexOfKind('phaseEntered', 17)) // assassination 阶段、未指认
    expect(deriveAvalonView(atAssassination, 'god', null).pendingActors).toEqual(['p4'])
    expect(deriveAvalonView(atAssassination, 'public', null).pendingActors).toEqual([])
  })

  it('avalonPerspectiveOf：平台 viewMode + 聚焦玩家 → 三视角', () => {
    expect(avalonPerspectiveOf('god', null)).toBe('god')
    expect(avalonPerspectiveOf('public', null)).toBe('public')
    expect(avalonPerspectiveOf('god', 'p3')).toBe('player')
    expect(avalonPerspectiveOf('public', 'p3')).toBe('public')
  })
})

describe('avalon v2 projection — store 分派与等价性', () => {
  it('avalon:v2 前缀走专属投影：round 分桶、队长为当前行动者、终局收口', () => {
    const derived = derive('god')
    expect(derived.avalonV2.round).toBe(4)
    expect(derived.handNumber).toBe(4)
    expect(derived.avalonV2.leaderId).toBe('p5')
    expect(derived.status).toBe('settled')
    expect(derived.matchComplete).toBe(true)
    expect(derived.currentActor).toBeNull()
    // 不触碰其他游戏投影。
    expect(derived.werewolf.day).toBe(0)
    expect(derived.communityCards).toEqual([])
    expect(derived.genericV2.gameType).toBe(null)
  })

  it('增量 ingest === 批量 derive（god 与 public 两口径）', () => {
    for (const viewMode of ['god', 'public'] as const) {
      useMatchViewStore.getState().reset()
      useMatchViewStore.getState().init({ matchId: MATCH_ID, players: AVALON_ROSTER })
      useMatchViewStore.getState().setViewMode(viewMode)
      for (const event of events) useMatchViewStore.getState().ingestEvent(event)
      const live = useMatchViewStore.getState()
      const derived = derive(viewMode)
      expect(live.avalonV2).toEqual(derived.avalonV2)
      expect(live.events.map((e) => e.id)).toEqual(derived.events.map((e) => e.id))
      expect(live.events.map((e) => e.handNumberAt)).toEqual(derived.events.map((e) => e.handNumberAt))
      expect(live.handNumber).toBe(derived.handNumber)
      expect(live.status).toBe(derived.status)
    }
  })

  it('视角切换不丢进度：avalonV2 全量真相与切换前逐字段一致', () => {
    useMatchViewStore.getState().init({ matchId: MATCH_ID, players: AVALON_ROSTER })
    for (const event of events) useMatchViewStore.getState().ingestEvent(event)
    const before = useMatchViewStore.getState().avalonV2
    useMatchViewStore.getState().setViewMode('public')
    const afterPublic = useMatchViewStore.getState()
    expect(afterPublic.viewMode).toBe('public')
    expect(afterPublic.avalonV2).toEqual(before)
    expect(afterPublic.events).toHaveLength(events.length)
    // 聚焦玩家在视角切换后保持（单玩家第三视角的 store 支撑）。
    useMatchViewStore.getState().setAvalonFocusPlayer('p3')
    useMatchViewStore.getState().setViewMode('god')
    expect(useMatchViewStore.getState().avalonFocusPlayerId).toBe('p3')
  })
})

describe('avalon v2 projection — 回放锚点（FR-4.6-02：轮次 + 刺杀环节）', () => {
  it('4 个轮次锚 + 刺杀合议/指认锚，seekIndex = 边界事件下标 + 1', () => {
    const boundaries = avalonReplayBoundaries(events)
    expect(boundaries.map((boundary) => boundary.label)).toEqual([
      '第 1 轮',
      '第 2 轮',
      '第 3 轮',
      '第 4 轮',
      '刺杀环节 · 密谋',
      '刺杀环节 · 指认',
    ])
    for (const boundary of boundaries) {
      const index = boundary.seekIndex - 1
      expect(events[index].kind.startsWith(AVALON_V2_PREFIX)).toBe(true)
    }
    expect(boundaries.every((boundary) => boundary.kind === 'hand' || boundary.kind === 'phase')).toBe(true)
  })

  it('非 avalon 事件流 → 空锚点列表（不误报）', () => {
    expect(avalonReplayBoundaries([])).toEqual([])
    const foreign: GameEvent = {
      ...avalonEnvelope('leaderAssigned', { round: 1, attempt: 1, leaderId: 'p1' }),
      kind: 'werewolf:v2:leaderAssigned',
    }
    expect(avalonReplayBoundaries([foreign])).toEqual([])
  })
})
