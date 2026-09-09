// 发牌与夜间情报（AVR-101 板子配置驱动 + AVR-203 知识矩阵全表）：
// 9 种预设合法性 / 自定义板拒绝路径 / 种子确定性（发牌 + 首任队长）/
// 莫甘娜混排 / 奥伯伦单向 / 莫德雷德隐形 / 忠诚仆从零情报。

import { describe, expect, it } from 'vitest'
import {
  AVALON_PRESETS,
  AVALON_PRESET_IDS,
  createMatch,
  createMatchFromSeating,
  resolveBoard,
  validateBoard,
} from '@/games/avalon/engine2'
import type { ResolvedBoard } from '@/games/avalon/engine2'
import {
  IDS10,
  IDS5,
  IDS6,
  SEATING_10,
  SEATING_5,
  SEATING_5_DECEIT,
  SEATING_5_SHADOW,
  SEATING_6,
  SEATING_6_LONE,
  SEED,
  boardOf,
  evsOf,
  startBoard,
  start5,
} from './_helpers'

describe('avalon engine2 — 板子预设（AVR-601/602）', () => {
  it('9 种内置预设全部通过板子校验，人数与阵营配比对齐标准板子表', () => {
    expect(AVALON_PRESET_IDS).toHaveLength(9)
    const expectedSeats: Record<string, number> = {
      'basic-5': 5,
      'deceit-5': 5,
      'shadow-5': 5,
      'basic-6': 6,
      'lone-king-6': 6,
      'base-7': 7,
      'base-8': 8,
      'base-9': 9,
      'base-10': 10,
    }
    for (const id of AVALON_PRESET_IDS) {
      const resolved = resolveBoard({ preset: id })
      expect(resolved.ok, `preset ${id} must resolve`).toBe(true)
      if (!resolved.ok) continue
      const seats = Object.values(resolved.board.roles).reduce((sum, n) => sum + n, 0)
      expect(seats, `preset ${id}`).toBe(expectedSeats[id])
      expect(resolved.board.teamSizes).toHaveLength(5)
      expect(resolved.board.discussionEnabled).toBe(true)
      expect(resolved.board.id).toBe(id)
    }
  })

  it('预设任务人数表与双失败轮逐项对齐 PRD 板子表', () => {
    expect(AVALON_PRESETS['basic-5'].teamSizes).toEqual([2, 3, 2, 3, 3])
    expect(AVALON_PRESETS['basic-5'].doubleFailRounds).toEqual([])
    expect(AVALON_PRESETS['basic-6'].teamSizes).toEqual([2, 3, 4, 3, 4])
    expect(AVALON_PRESETS['basic-6'].doubleFailRounds).toEqual([4])
    expect(AVALON_PRESETS['base-7'].teamSizes).toEqual([2, 3, 3, 4, 4])
    expect(AVALON_PRESETS['base-8'].teamSizes).toEqual([3, 4, 4, 5, 5])
    expect(AVALON_PRESETS['base-9'].teamSizes).toEqual([3, 4, 4, 5, 5])
    expect(AVALON_PRESETS['base-10'].teamSizes).toEqual([3, 4, 4, 5, 5])
    expect(AVALON_PRESETS['base-10'].doubleFailRounds).toEqual([4])
    expect(AVALON_PRESETS['base-10'].roles).toEqual({
      merlin: 1,
      percival: 1,
      loyalServant: 4,
      assassin: 1,
      morgana: 1,
      mordred: 1,
      minion: 1,
    })
  })

  it('未知预设 / 非法自定义组合结构化拒绝（AVR-101 验收 2）', () => {
    expect(resolveBoard({ preset: 'nope-99' }).ok).toBe(false)
    // 人数与角色数不符
    expect(
      resolveBoard({ roles: { merlin: 1, percival: 1, loyalServant: 2, assassin: 1 }, teamSizes: [2, 3, 2, 3, 3] }).ok,
    ).toBe(false)
    // 阵营配比错（5 人板应 3 好 2 坏）
    expect(
      resolveBoard({
        roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1, morgana: 1 },
        teamSizes: [2, 3, 2, 3, 3],
      }).ok,
    ).toBe(false)
    // 未知角色
    expect(
      resolveBoard({ roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, vampire: 1 }, teamSizes: [2, 3, 2, 3, 3] }).ok,
    ).toBe(false)
    // 无梅林
    expect(
      resolveBoard({ roles: { percival: 1, loyalServant: 2, assassin: 1, minion: 1 }, teamSizes: [2, 3, 2, 3, 3] }).ok,
    ).toBe(false)
    // 双梅林
    expect(
      resolveBoard({ roles: { merlin: 2, loyalServant: 1, assassin: 1, minion: 1 }, teamSizes: [2, 3, 2, 3, 3] }).ok,
    ).toBe(false)
    // 参数越域：teamSizes 长度错 / 单轮人数越域 / 双失败轮 = 1
    expect(
      resolveBoard({ roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 }, teamSizes: [2, 3, 2] }).ok,
    ).toBe(false)
    expect(
      resolveBoard({ roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 }, teamSizes: [2, 3, 9, 3, 3] }).ok,
    ).toBe(false)
    expect(
      resolveBoard({
        roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 },
        teamSizes: [2, 3, 2, 3, 3],
        doubleFailRounds: [1],
      }).ok,
    ).toBe(false)
    expect(
      resolveBoard({
        roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 },
        teamSizes: [2, 3, 2, 3, 3],
        doubleFailRounds: [6],
      }).ok,
    ).toBe(false)
  })

  it('合法自定义板（无刺客 → 座位序首名坏人代行刺杀，AVR-OD-1b）可开局', () => {
    const board: ResolvedBoard = {
      id: 'custom-test',
      name: '自定义测试板',
      roles: { merlin: 1, percival: 1, loyalServant: 1, morgana: 1, minion: 1 },
      teamSizes: [2, 3, 2, 3, 3],
      doubleFailRounds: [],
      discussionEnabled: true,
    }
    expect(validateBoard(board).ok).toBe(true)
    const acc = startBoard(board, ['merlin', 'percival', 'loyalServant', 'morgana', 'minion'])
    expect(acc.state.board.id).toBe('custom-test')
  })

  it('预设可覆盖讨论开关（板子参数 9）', () => {
    const board = boardOf('basic-5', { discussionEnabled: false })
    expect(board.discussionEnabled).toBe(false)
    const acc = startBoard(board, SEATING_5)
    expect(acc.state.phase).toBe('proposal') // 关讨论 → 直接提名
  })
})

describe('avalon engine2 — 种子确定性与开局事件', () => {
  it('开局进入轮 1 讨论（座位序），首任队长由种子决定且同种子确定', () => {
    const acc = start5()
    expect(acc.state.round).toBe(1)
    expect(acc.state.phase).toBe('discussion')
    expect(acc.state.pendingActor).toBe('p1') // 发言从座位 1 开始
    expect(acc.state.players.map((p) => p.seat)).toEqual([1, 2, 3, 4, 5])
    // 讨论中尚未公布队长（leaderAssigned 在进入提名时发出，AVR-104）
    expect(evsOf(acc.events, 'leaderAssigned')).toHaveLength(0)

    const again = start5()
    expect(again.state.leaderSeat).toBe(acc.state.leaderSeat)
    expect(IDS5).toContain(acc.state.players.find((p) => p.seat === acc.state.leaderSeat)?.playerId)
  })

  it('同种子两次开局事件流逐字节一致；发牌多重集恒等于板子', () => {
    const a = createMatch({ board: boardOf('basic-5'), playerIds: [...IDS5], seed: 42 })
    const b = createMatch({ board: boardOf('basic-5'), playerIds: [...IDS5], seed: 42 })
    expect(a.status).toBe('created')
    if (a.status !== 'created' || b.status !== 'created') return
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
    const roles = a.state.players.map((p) => p.role).sort()
    expect(roles).toEqual([...SEATING_5].sort())
    const c = createMatch({ board: boardOf('basic-5'), playerIds: [...IDS5], seed: 7 })
    if (c.status !== 'created') throw new Error('seed 7 rejected')
    expect(c.state.players.map((p) => p.role)).not.toEqual(a.state.players.map((p) => p.role))
  })

  it('开局名册公共（含板面参数与角色构成）、随机种子延迟公开', () => {
    const acc = start5()
    const started = evsOf(acc.events, 'matchStarted')[0]
    expect(started.audience).toEqual({ kind: 'public' })
    expect(started.payload.seats.map((s) => s.playerId)).toEqual([...IDS5])
    expect(started.payload.questCount).toBe(5)
    expect(started.payload.teamSizes).toEqual([2, 3, 2, 3, 3])
    expect(started.payload.doubleFailRounds).toEqual([])
    expect(started.payload.discussionEnabled).toBe(true)
    expect(started.payload.roles).toEqual({ merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 })
    expect(started.payload.boardId).toBe('basic-5')
    expect(started.payload.boardName).toBe('基础 5 人板')

    const seed = evsOf(acc.events, 'randomnessSeed')[0]
    expect(seed.audience).toEqual({ kind: 'delayed-public' })
    expect(seed.payload.seed).toBe(SEED)
  })

  it('发牌：每人一条 role-self 事件，角色与落座一致', () => {
    const acc = start5()
    const dealt = evsOf(acc.events, 'rolesAssigned')
    expect(dealt).toHaveLength(5)
    const dealtByActor = new Map(dealt.map((event) => [event.actorId ?? '', event]))
    for (const playerId of IDS5) {
      const event = dealtByActor.get(playerId)
      expect(event, `missing rolesAssigned for ${playerId}`).toBeDefined()
      expect(event?.audience).toEqual({ kind: 'role-self', playerId })
      expect(event?.payload.role).toBe(SEATING_5[Number(playerId.slice(1)) - 1])
    }
  })

  it('非法入参结构化拒绝：人数不符 / 重复 id / 落座与板子不符', () => {
    const board = boardOf('basic-5')
    expect(createMatch({ board, playerIds: ['p1', 'p2', 'p3'], seed: 1 }).status).toBe('invalid')
    expect(createMatch({ board, playerIds: ['p1', 'p1', 'p3', 'p4', 'p5'], seed: 1 }).status).toBe('invalid')
    expect(
      createMatchFromSeating({
        board,
        seating: ['merlin', 'percival', 'loyalServant', 'loyalServant', 'minion'],
        playerIds: [...IDS5],
        seed: 1,
      }).status,
    ).toBe('invalid')
  })
})

describe('avalon engine2 — 夜间知识矩阵（AVR-203 全表）', () => {
  it('basic-5：梅林看到全部坏人（无莫德雷德）；坏人互识；忠诚仆从零情报', () => {
    const acc = start5()
    const knowledge = evsOf(acc.events, 'knowledgeRevealed')
    const merlin = knowledge.find((e) => e.actorId === 'p1')
    expect(merlin?.audience).toEqual({ kind: 'role-self', playerId: 'p1' })
    expect(merlin?.payload).toEqual({ insight: 'merlin', playerIds: ['p4', 'p5'] })
    const percival = knowledge.find((e) => e.actorId === 'p2')
    expect(percival?.payload).toEqual({ insight: 'percival', playerIds: ['p1'] }) // 无莫甘娜 → 只见梅林
    const assassin = knowledge.find((e) => e.actorId === 'p4')
    const minion = knowledge.find((e) => e.actorId === 'p5')
    expect(assassin?.payload).toEqual({ insight: 'evil', playerIds: ['p5'] })
    expect(minion?.payload).toEqual({ insight: 'evil', playerIds: ['p4'] })
    expect(knowledge.find((e) => e.actorId === 'p3')).toBeUndefined()
    expect(knowledge).toHaveLength(4)
  })

  it('deceit-5：派西维尔看到梅林与莫甘娜混排（无标注，两种顺序都可能出现）', () => {
    // 固定落座下逐种子收集顺序：混排必须真实存在（而非固定先梅林）
    const orders = new Set<string>()
    for (let seed = 0; seed < 200; seed++) {
      const acc = startBoard(boardOf('deceit-5'), SEATING_5_DECEIT, IDS5, seed)
      const percival = evsOf(acc.events, 'knowledgeRevealed').find((e) => e.actorId === 'p2')
      expect(percival?.payload.insight).toBe('percival')
      expect([...percival!.payload.playerIds].sort()).toEqual(['p1', 'p5'])
      orders.add(percival!.payload.playerIds.join(','))
    }
    expect(orders.size).toBe(2) // p1,p5 与 p5,p1 都出现 = 真混排
  })

  it('shadow-5：莫德雷德对梅林隐形；莫德雷德与其余坏人互识', () => {
    const acc = startBoard(boardOf('shadow-5'), SEATING_5_SHADOW)
    const knowledge = evsOf(acc.events, 'knowledgeRevealed')
    const merlin = knowledge.find((e) => e.actorId === 'p1')
    expect(merlin?.payload).toEqual({ insight: 'merlin', playerIds: ['p4'] }) // 只看到刺客
    const mordred = knowledge.find((e) => e.actorId === 'p5')
    const assassin = knowledge.find((e) => e.actorId === 'p4')
    expect(mordred?.payload).toEqual({ insight: 'evil', playerIds: ['p4'] })
    expect(assassin?.payload).toEqual({ insight: 'evil', playerIds: ['p5'] })
  })

  it('lone-king-6：奥伯伦单向（自见全部坏人 / 他人不见他），梅林可见奥伯伦', () => {
    const acc = startBoard(boardOf('lone-king-6'), SEATING_6_LONE, IDS6)
    const knowledge = evsOf(acc.events, 'knowledgeRevealed')
    const merlin = knowledge.find((e) => e.actorId === 'p1')
    expect(merlin?.payload).toEqual({ insight: 'merlin', playerIds: ['p5', 'p6'] }) // 刺客 + 奥伯伦
    const assassin = knowledge.find((e) => e.actorId === 'p5')
    expect(assassin?.payload).toEqual({ insight: 'evil', playerIds: [] }) // 除奥伯伦外无同伙
    const oberon = knowledge.find((e) => e.actorId === 'p6')
    expect(oberon?.payload).toEqual({ insight: 'evil', playerIds: ['p5'] }) // 奥伯伦看到刺客
    // 好人（派西维尔/仆从）无 evil 情报
    expect(knowledge.find((e) => e.actorId === 'p3')).toBeUndefined()
    expect(knowledge.find((e) => e.actorId === 'p4')).toBeUndefined()
    expect(knowledge).toHaveLength(4) // merlin + percival + assassin + oberon
  })

  it('basic-6：派西维尔见 [梅林, 莫甘娜] 混排；刺客与莫甘娜互识', () => {
    const acc = startBoard(boardOf('basic-6'), SEATING_6, IDS6)
    const knowledge = evsOf(acc.events, 'knowledgeRevealed')
    const percival = knowledge.find((e) => e.actorId === 'p2')
    expect([...percival!.payload.playerIds].sort()).toEqual(['p1', 'p6'])
    expect(knowledge.find((e) => e.actorId === 'p5')?.payload).toEqual({ insight: 'evil', playerIds: ['p6'] })
    expect(knowledge.find((e) => e.actorId === 'p6')?.payload).toEqual({ insight: 'evil', playerIds: ['p5'] })
  })

  it('base-10：全矩阵 — 梅林不见莫德雷德、坏人互识含莫德雷德、仆从零情报', () => {
    const acc = startBoard(boardOf('base-10'), SEATING_10, IDS10)
    const knowledge = evsOf(acc.events, 'knowledgeRevealed')
    const merlin = knowledge.find((e) => e.actorId === 'p1')
    // 坏人 = p7 刺客 / p8 莫甘娜 / p9 莫德雷德 / p10 爪牙；梅林只见除莫德雷德外
    expect(merlin?.payload).toEqual({ insight: 'merlin', playerIds: ['p7', 'p8', 'p10'] })
    const percival = knowledge.find((e) => e.actorId === 'p2')
    expect([...percival!.payload.playerIds].sort()).toEqual(['p1', 'p8'])
    // 坏人互识（除奥伯伦外；板无奥伯伦）——莫德雷德对同伙可见，只对梅林隐形
    expect(knowledge.find((e) => e.actorId === 'p7')?.payload).toEqual({ insight: 'evil', playerIds: ['p8', 'p9', 'p10'] })
    expect(knowledge.find((e) => e.actorId === 'p8')?.payload).toEqual({ insight: 'evil', playerIds: ['p7', 'p9', 'p10'] })
    expect(knowledge.find((e) => e.actorId === 'p10')?.payload).toEqual({ insight: 'evil', playerIds: ['p7', 'p8', 'p9'] })
    expect(knowledge.find((e) => e.actorId === 'p9')?.payload).toEqual({ insight: 'evil', playerIds: ['p7', 'p8', 'p10'] })
    // 4 名仆从零情报
    for (const id of ['p3', 'p4', 'p5', 'p6']) {
      expect(knowledge.find((e) => e.actorId === id)).toBeUndefined()
    }
    expect(knowledge).toHaveLength(6) // merlin + percival + 4 evils
  })

  it('knowledge 状态记录与事件同源（决策上下文依据，AVR-202）', () => {
    const acc = startBoard(boardOf('base-10'), SEATING_10, IDS10)
    const events = evsOf(acc.events, 'knowledgeRevealed')
    expect(acc.state.knowledge.map((k) => k.playerId)).toEqual(events.map((e) => e.actorId))
    for (const record of acc.state.knowledge) {
      const event = events.find((e) => e.actorId === record.playerId)
      expect(event?.payload.playerIds).toEqual(record.playerIds)
    }
  })
})
