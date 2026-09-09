// 流程裁决（AVR-1xx/4xx 全量主体）：讨论 → 提名 → 公开记名表决 → 任务 →
// 连坐 / 双失败轮 / 刺杀环节两分支 / 平票否决 / 重提案跳讨论。

import { describe, expect, it } from 'vitest'
import { MAX_REJECTIONS, resolveBoard } from '@/games/avalon/engine2'
import {
  IDS6,
  SEATING_5,
  SEATING_6,
  boardOf,
  assassinate,
  consultAll,
  evOf,
  evsOf,
  fail,
  playerByRole,
  propose,
  questAll,
  runApprovedQuest,
  speakAll,
  start5,
  startBoard,
  step,
  voteAll,
} from './_helpers'
import type { Acc } from './_helpers'

describe('avalon engine2 — 讨论与提名（AVR-OD-3a / AVR-105）', () => {
  it('轮 1 讨论座位序全员各发言一次，随后进入提名', () => {
    const acc = start5()
    expect(acc.state.phase).toBe('discussion')
    speakAll(acc, ['a', 'b', 'c', 'd', 'e'])
    const statements = evsOf(acc.events, 'statementIssued')
    expect(statements.map((s) => s.payload.speakerId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(statements.map((s) => s.payload.text)).toEqual(['a', 'b', 'c', 'd', 'e'])
    for (const s of statements) expect(s.audience).toEqual({ kind: 'public' })
    expect(acc.state.phase).toBe('proposal')
  })

  it('发言文本越域结构化拒绝（空 / 超 2000 字 → ILLEGAL_CHOICE）', () => {
    const acc = start5()
    expect(fail(acc, { type: 'speak', actorId: 'p1', text: '' }).code).toBe('ILLEGAL_CHOICE')
    expect(fail(acc, { type: 'speak', actorId: 'p1', text: 'x'.repeat(2001) }).code).toBe('ILLEGAL_CHOICE')
    step(acc, { type: 'speak', actorId: 'p1', text: 'x'.repeat(2000) }) // 恰好 2000 合法
  })

  it('非当值发言人 / 错阶段发言被拒（WRONG_ACTOR / WRONG_PHASE）', () => {
    const acc = start5()
    expect(fail(acc, { type: 'speak', actorId: 'p3', text: '抢话' }).code).toBe('WRONG_ACTOR')
    speakAll(acc)
    expect(fail(acc, { type: 'speak', actorId: 'p1', text: '迟到的发言' }).code).toBe('WRONG_PHASE')
  })

  it('板子关讨论 → 整局无讨论阶段（每轮直接提名）', () => {
    const acc = startBoard({ ...boardOf('basic-5'), discussionEnabled: false }, SEATING_5)
    expect(acc.state.phase).toBe('proposal')
    runApprovedQuest(acc, ['p1', 'p2'], true)
    expect(acc.state.round).toBe(2)
    expect(acc.state.phase).toBe('proposal') // 无讨论直达
    expect(evsOf(acc.events, 'phaseEntered').every((e) => e.payload.phase !== 'discussion')).toBe(true)
  })
})

describe('avalon engine2 — 公开记名表决（AVR-107）', () => {
  it('每票都是公共事件（投票人 + 立场）；汇总给计数与结果', () => {
    const acc = start5()
    speakAll(acc)
    propose(acc, ['p1', 'p2'])
    voteAll(acc, [true, true, true, false, false])

    const casts = evsOf(acc.events, 'voteCast')
    expect(casts).toHaveLength(5)
    for (const cast of casts) {
      expect(cast.audience).toEqual({ kind: 'public' })
    }
    expect(casts.map((c) => c.payload.voterId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(casts.map((c) => c.payload.approve)).toEqual([true, true, true, false, false])

    const result = evOf(acc.events, 'voteResult')
    expect(result.payload).toEqual({ round: 1, attempt: 1, approvals: 3, rejections: 2, outcome: 'approved' })
    expect(acc.state.phase).toBe('quest')
  })

  it('平票 = 否决（6 人板 3:3）', () => {
    const acc = startBoard(boardOf('basic-6'), SEATING_6, IDS6)
    speakAll(acc)
    propose(acc, ['p1', 'p2'])
    voteAll(acc, [true, true, true, false, false, false]) // 3:3
    const result = evOf(acc.events, 'voteResult')
    expect(result.payload).toEqual({ round: 1, attempt: 1, approvals: 3, rejections: 3, outcome: 'rejected' })
    expect(acc.state.phase).toBe('proposal')
    expect(acc.state.attempt).toBe(2)
  })

  it('否决后队长轮转下一位重新提案（attempt + 1）', () => {
    const acc = start5()
    speakAll(acc)
    propose(acc, ['p1', 'p2'])
    voteAll(acc, false)
    expect(acc.state.attempt).toBe(2)

    const leaders = evsOf(acc.events, 'leaderAssigned')
    expect(leaders).toHaveLength(2)
    expect(leaders[1].payload.attempt).toBe(2)
    const seats = (id: string): number => acc.state.players.find((p) => p.playerId === id)?.seat ?? 0
    expect(seats(leaders[1].payload.leaderId)).toBe((seats(leaders[0].payload.leaderId) % 5) + 1)
  })

  it('同轮重提案跳过讨论（AVR-OD-3a：仅首次提案前讨论）', () => {
    const acc = start5()
    speakAll(acc) // 轮 1 讨论已完
    propose(acc, ['p1', 'p2'])
    voteAll(acc, false)
    expect(acc.state.phase).toBe('proposal') // attempt 2 直接提名，不再讨论
    expect(evsOf(acc.events, 'phaseEntered').filter((e) => e.payload.phase === 'discussion')).toHaveLength(1)
    expect(evsOf(acc.events, 'statementIssued')).toHaveLength(5)
  })

  it('提案人数不符 / 重复 / 越界 / 非队长结构化拒绝', () => {
    const acc = start5()
    speakAll(acc)
    const leader = acc.state.pendingActor!
    const nonLeader = acc.state.players.find((p) => p.playerId !== leader)!.playerId
    expect(fail(acc, { type: 'proposeTeam', actorId: leader, targetIds: ['p1'] }).code).toBe('ILLEGAL_TARGET')
    expect(fail(acc, { type: 'proposeTeam', actorId: leader, targetIds: ['p1', 'p1'] }).code).toBe('ILLEGAL_TARGET')
    expect(fail(acc, { type: 'proposeTeam', actorId: leader, targetIds: ['p1', 'ghost'] }).code).toBe('ILLEGAL_TARGET')
    expect(fail(acc, { type: 'proposeTeam', actorId: nonLeader, targetIds: ['p1', 'p2'] }).code).toBe('WRONG_ACTOR')
  })
})

describe('avalon engine2 — 任务执行与双失败轮（AVR-401/402/408）', () => {
  it('坏人可出失败牌；结果只公布失败张数不点名', () => {
    const acc = start5()
    speakAll(acc)
    propose(acc, ['p4', 'p5']) // 刺客 + 爪牙
    voteAll(acc, true)
    const minion = playerByRole(acc, 'minion').playerId
    step(acc, { type: 'quest', actorId: 'p4', succeed: false })
    step(acc, { type: 'quest', actorId: minion, succeed: false })

    const result = evOf(acc.events, 'questResult')
    expect(result.payload).toEqual({ round: 1, outcome: 'fail', failVotes: 2, requiredFails: 1 })
    expect(result.audience).toEqual({ kind: 'public' })
    // 公共载荷不点名：无成员字段
    expect(JSON.stringify(result.payload)).not.toContain(minion)
  })

  it('好人提交失败牌被拒（ILLEGAL_CHOICE；座位序逐人抉择）', () => {
    const acc = start5()
    speakAll(acc)
    propose(acc, ['p1', 'p3']) // 两位好人
    voteAll(acc, true)
    expect(acc.state.pendingActor).toBe('p1')
    expect(fail(acc, { type: 'quest', actorId: 'p1', succeed: false }).code).toBe('ILLEGAL_CHOICE')
    step(acc, { type: 'quest', actorId: 'p1', succeed: true })
    expect(acc.state.pendingActor).toBe('p3')
    expect(fail(acc, { type: 'quest', actorId: 'p3', succeed: false }).code).toBe('ILLEGAL_CHOICE')
  })

  it('双失败轮（basic-6 第 4 轮，3 人队阈值 2）：1 张失败牌仍成功、2 张失败牌才判失败', () => {
    // 前三轮推到 2 成功 1 失败 → 轮 4（双失败轮，3 人队）
    const mk = (): Acc => startBoard(boardOf('basic-6'), SEATING_6, IDS6)
    const playToRound4 = (acc: Acc): void => {
      runApprovedQuest(acc, ['p1', 'p2'], true) // R1（2 人）成功
      runApprovedQuest(acc, ['p1', 'p2', 'p6'], [true, true, false]) // R2（3 人）莫甘娜出失败
      runApprovedQuest(acc, ['p1', 'p2', 'p3', 'p4'], true) // R3（4 人）成功
      expect(acc.state.round).toBe(4)
    }

    // 1 张失败牌 < 阈值 2 → 任务成功（第 3 胜）→ 进入刺杀环节
    const one = mk()
    playToRound4(one)
    runApprovedQuest(one, ['p1', 'p2', 'p5'], [true, true, false]) // 刺客单张失败牌
    const oneResult = evsOf(one.events, 'questResult').find((e) => e.payload.round === 4)
    expect(oneResult?.payload).toEqual({ round: 4, outcome: 'success', failVotes: 1, requiredFails: 2 })
    expect(one.state.results.filter((r) => r.outcome === 'success')).toHaveLength(3)
    expect(one.state.phase).toBe('evilConsultation')

    // 2 张失败牌 ≥ 阈值 2 → 失败（好人的第 3 胜被拦）→ 2:2 进轮 5
    const two = mk()
    playToRound4(two)
    runApprovedQuest(two, ['p1', 'p5', 'p6'], [true, false, false]) // 刺客 + 莫甘娜双失败
    const twoResult = evsOf(two.events, 'questResult').find((e) => e.payload.round === 4)
    expect(twoResult?.payload).toEqual({ round: 4, outcome: 'fail', failVotes: 2, requiredFails: 2 })
    expect(two.state.outcome).toBeNull()
    expect(two.state.round).toBe(5)
  })
})

describe('avalon engine2 — 连坐（AVR-403）', () => {
  it('同轮第 5 次提案被拒 → 坏人直接胜：不发 questResult、任务不算失败', () => {
    const acc = start5()
    speakAll(acc)
    for (let i = 1; i <= MAX_REJECTIONS; i++) {
      expect(acc.state.attempt).toBe(i)
      const leader = acc.state.pendingActor!
      propose(acc, [leader, leader === 'p1' ? 'p2' : 'p1'])
      voteAll(acc, false)
      if (i < MAX_REJECTIONS) {
        expect(acc.state.phase).toBe('proposal')
        expect(acc.state.outcome).toBeNull()
      }
    }
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'connective-rejection:round-1' })
    expect(acc.state.phase).toBe('ended')
    // 连坐不进任务阶段、任务不算失败：轮 1 无 questResult、战绩 0:0
    expect(evsOf(acc.events, 'questResult')).toHaveLength(0)
    expect(acc.state.results).toHaveLength(0)
    expect(evsOf(acc.events, 'voteResult')).toHaveLength(5)
    expect(evsOf(acc.events, 'voteResult').every((e) => e.payload.outcome === 'rejected')).toBe(true)
  })

  it('第 4 次拒绝后仍可继续（连坐只在第 5 次）', () => {
    const acc = start5()
    speakAll(acc)
    for (let i = 0; i < 4; i++) {
      const leader = acc.state.pendingActor!
      propose(acc, [leader, leader === 'p1' ? 'p2' : 'p1'])
      voteAll(acc, false)
    }
    expect(acc.state.outcome).toBeNull()
    expect(acc.state.attempt).toBe(5)
    // 第 5 次提案通过 → 正常进任务
    propose(acc, ['p1', 'p2'])
    voteAll(acc, true)
    expect(acc.state.phase).toBe('quest')
  })
})

describe('avalon engine2 — 刺杀环节（AVR-106）', () => {
  function reachAssassination(): Acc {
    const acc = start5()
    runApprovedQuest(acc, ['p1', 'p2'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
    runApprovedQuest(acc, ['p1', 'p2'], true)
    expect(acc.state.phase).toBe('evilConsultation')
    return acc
  }

  it('好人 3 成功 → 不立即获胜，进入坏人合议（座位序）→ 刺杀指认', () => {
    const acc = reachAssassination()
    // 合议仅坏人可行动（座位序：p4 刺客 → p5 爪牙）
    const consultation = acc.state.consultation!
    expect(consultation.queue).toEqual(['p4', 'p5'])
    expect(acc.state.pendingActor).toBe('p4')
    expect(fail(acc, { type: 'consult', actorId: 'p1', text: '好人插话' }).code).toBe('WRONG_ACTOR')

    step(acc, { type: 'consult', actorId: 'p4', text: '梅林是 1 号' })
    expect(acc.state.pendingActor).toBe('p5')
    step(acc, { type: 'consult', actorId: 'p5', text: '同意' })
    expect(acc.state.phase).toBe('assassination')
    // 刺杀权 = 刺客角色
    expect(acc.state.pendingActor).toBe('p4')
  })

  it('分支一：指认梅林 → 坏人翻盘获胜（basis 注明）', () => {
    const acc = reachAssassination()
    consultAll(acc)
    assassinate(acc, 'p1') // 梅林
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'quests:3-0;assassination-hit' })
    const declared = evOf(acc.events, 'assassinationDeclared')
    expect(declared.audience).toEqual({ kind: 'public' })
    expect(declared.payload).toEqual({ assassinId: 'p4', targetId: 'p1' })
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.audience).toEqual({ kind: 'delayed-public' })
    expect(ended.payload.winner).toBe('evil')
    expect(ended.payload.reveal).toHaveLength(5)
    expect(acc.state.assassination).toEqual({ assassinId: 'p4', targetId: 'p1', hitMerlin: true })
  })

  it('分支二：指认非梅林 → 好人获胜', () => {
    const acc = reachAssassination()
    consultAll(acc)
    assassinate(acc, 'p3') // 忠诚仆从
    expect(acc.state.outcome).toEqual({ winner: 'good', basis: 'quests:3-0;assassination-miss' })
    expect(acc.state.assassination).toEqual({ assassinId: 'p4', targetId: 'p3', hitMerlin: false })
  })

  it('指认本人 / 不在名册 / 非持有者结构化拒绝', () => {
    const acc = reachAssassination()
    consultAll(acc)
    expect(fail(acc, { type: 'assassinate', actorId: 'p4', targetId: 'p4' }).code).toBe('ILLEGAL_TARGET')
    expect(fail(acc, { type: 'assassinate', actorId: 'p4', targetId: 'ghost' }).code).toBe('ILLEGAL_TARGET')
    expect(fail(acc, { type: 'assassinate', actorId: 'p5', targetId: 'p1' }).code).toBe('WRONG_ACTOR')
  })

  it('坏人 3 任务失败直接胜：无刺杀环节', () => {
    const acc = start5()
    runApprovedQuest(acc, ['p1', 'p2'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p5'], [true, true, false])
    runApprovedQuest(acc, ['p3', 'p5'], [true, false])
    runApprovedQuest(acc, ['p1', 'p2', 'p4'], [true, true, false])
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'quests:1-3' })
    expect(acc.state.phase).toBe('ended')
    expect(evsOf(acc.events, 'phaseEntered').every((e) => e.payload.phase !== 'evilConsultation')).toBe(true)
    expect(evsOf(acc.events, 'assassinationDeclared')).toHaveLength(0)
    expect(acc.state.assassination).toBeNull()
  })

  it('无刺客自定义板：座位序首名坏人代行刺杀（AVR-OD-1b）', () => {
    const resolved = resolveBoard({
      roles: { merlin: 1, percival: 1, loyalServant: 1, morgana: 1, minion: 1 },
      teamSizes: [2, 3, 2, 3, 3],
      doubleFailRounds: [],
      discussionEnabled: true,
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const acc = startBoard(resolved.board, ['merlin', 'percival', 'loyalServant', 'morgana', 'minion'])
    runApprovedQuest(acc, ['p1', 'p2'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
    runApprovedQuest(acc, ['p1', 'p2'], true)
    // 坏人 = p4 莫甘娜 / p5 爪牙；先合议再进入指认
    consultAll(acc)
    // 座位序首名坏人 = p4 代行刺杀权
    expect(acc.state.phase).toBe('assassination')
    expect(acc.state.pendingActor).toBe('p4')
    assassinate(acc, 'p1') // 命中梅林 → 坏人胜
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'quests:3-0;assassination-hit' })
    expect(acc.state.assassination?.assassinId).toBe('p4')
  })
})

describe('avalon engine2 — 队长轮转（AVR-104）', () => {
  it('每次新提案（新轮或重提）队长 = 上一位队长下一位座位', () => {
    const acc = start5()
    const leaders: string[] = []
    const seatsOf = (id: string): number => acc.state.players.find((p) => p.playerId === id)?.seat ?? 0
    speakAll(acc)
    leaders.push(acc.state.pendingActor!)
    propose(acc, ['p1', 'p2'])
    voteAll(acc, false) // attempt 2
    leaders.push(acc.state.pendingActor!)
    propose(acc, ['p1', 'p3'])
    voteAll(acc, true)
    questAll(acc, true) // 轮 1 结束 → 轮 2（先讨论）
    speakAll(acc)
    leaders.push(acc.state.pendingActor!)
    for (let i = 1; i < leaders.length; i++) {
      expect(seatsOf(leaders[i])).toBe((seatsOf(leaders[i - 1]) % 5) + 1)
    }
    const events = evsOf(acc.events, 'leaderAssigned')
    expect(events.map((e) => e.payload.leaderId)).toEqual(leaders)
  })
})
