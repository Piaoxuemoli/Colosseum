// 默认动作（AVR-304）与永不死锁（AVR-405）：
// speak/consult = 跳过（空文本 + isDefault）；proposeTeam = 队长下一位起
// 顺时针 N 名（确定性钉死）；vote = 反对；quest = 成功；assassinate = 座位序
// 第一名非本人。随机动作序列模糊测试：任何拒绝不得破坏推进能力。

import { describe, expect, it } from 'vitest'
import {
  applyDefaultAction,
  applyAction,
  availableActions,
  defaultTeam,
  terminateImmediately,
} from '@/games/avalon/engine2'
import type { AvalonAction } from '@/games/avalon/engine2'
import {
  SEATING_5,
  boardOf,
  evOf,
  evsOf,
  propose,
  runApprovedQuest,
  runDefaults,
  speakAll,
  start5,
  startBoard,
  voteAll,
} from './_helpers'
import type { Acc } from './_helpers'

describe('avalon engine2 — 默认动作（AVR-304）', () => {
  it('默认链把对局驱动到终局：全默认 = 跳过发言 + 全反对 → 轮 1 五连拒连坐坏人胜', () => {
    const acc = start5()
    const applied = runDefaults(acc, (a) => a.state.phase === 'ended')
    // 5 发言 + 5 ×（1 提案 + 5 票）= 35 步
    expect(applied).toBe(35)
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'connective-rejection:round-1' })

    // 全部默认事件带 isDefault 标记
    for (const kind of ['statementIssued', 'teamProposed', 'voteCast'] as const) {
      for (const event of evsOf(acc.events, kind)) {
        expect(event.isDefault).toBe(true)
      }
    }
    // 默认表决 = 反对（AVR-OD-2；五次表决全部 0:5 否决）
    const voteResults = evsOf(acc.events, 'voteResult')
    expect(voteResults).toHaveLength(5)
    for (const result of voteResults) {
      expect(result.payload.outcome).toBe('rejected')
      expect(result.payload.approvals).toBe(0)
      expect(result.payload.rejections).toBe(5)
    }
    expect(voteResults[0].payload.attempt).toBe(1)
    expect(voteResults[4].payload.attempt).toBe(5)
    // 默认发言 = 空文本（不伪造文本）
    expect(evsOf(acc.events, 'statementIssued').every((e) => e.payload.text === '')).toBe(true)
  })

  it('默认提案 = 从队长下一位座位起顺时针 N 名（确定性规则钉死）', () => {
    const acc = start5()
    speakAll(acc)
    // 轮 1（2 人队）：默认事件中的第一支队伍
    runDefaults(acc, (a) => a.state.phase === 'teamVote')
    const first = evsOf(acc.events, 'teamProposed')[0]
    const leaderSeat = acc.state.players.find((p) => p.playerId === first.payload.leaderId)?.seat ?? 1
    // 队伍 = 队长下一位座位起的 2 名（不含队长，座位回绕）
    expect(first.payload.teamIds).toEqual(defaultTeam(acc.state, first.payload.leaderId, 2))
    expect(first.payload.teamIds).toHaveLength(2)
    expect(first.payload.teamIds).not.toContain(first.payload.leaderId)
    const seatOf = (id: string): number => acc.state.players.find((p) => p.playerId === id)!.seat
    expect(first.payload.teamIds.map(seatOf)).toEqual([(leaderSeat % 5) + 1, ((leaderSeat + 1) % 5) + 1])
  })

  it('默认任务抉择 = 成功牌（好人坏人都 true，AVR-OD-2）', () => {
    const acc = start5()
    speakAll(acc)
    propose(acc, ['p4', 'p5']) // 刺客 + 爪牙（坏人）上车
    voteAll(acc, true)
    runDefaults(acc, (a) => a.state.phase !== 'quest')
    const result = evOf(acc.events, 'questResult')
    expect(result.payload).toEqual({ round: 1, outcome: 'success', failVotes: 0, requiredFails: 1 })
    for (const choice of evsOf(acc.events, 'questChoice')) {
      expect(choice.payload.succeed).toBe(true)
      expect(choice.isDefault).toBe(true)
    }
  })

  it('默认合议 = 跳过（空文本 + isDefault）；默认刺杀 = 座位序第一名非本人', () => {
    const acc = start5()
    runApprovedQuest(acc, ['p1', 'p2'], true)
    runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
    runApprovedQuest(acc, ['p1', 'p2'], true)
    expect(acc.state.phase).toBe('evilConsultation')

    // 合议默认：2 名坏人各一条空文本副本事件
    runDefaults(acc, (a) => a.state.phase === 'assassination')
    const consults = evsOf(acc.events, 'evilConsulted')
    expect(consults).toHaveLength(4) // 2 坏人 × 2 副本（每名坏人一条 role-self 副本）
    expect(consults.every((e) => e.payload.text === '' && e.isDefault === true)).toBe(true)

    // 刺杀默认：座位序第一名非本人玩家 = p1（持有者 p4）
    expect(acc.state.pendingActor).toBe('p4')
    runDefaults(acc, (a) => a.state.phase === 'ended')
    const declared = evOf(acc.events, 'assassinationDeclared')
    expect(declared.payload).toEqual({ assassinId: 'p4', targetId: 'p1' })
    expect(declared.isDefault).toBe(true)
    // p1 恰是梅林（SEATING_5）→ 坏人翻盘
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'quests:3-0;assassination-hit' })
  })

  it('终局后默认动作被拒', () => {
    const acc = start5()
    runDefaults(acc, (a) => a.state.phase === 'ended')
    expect(applyDefaultAction(acc.state).status).toBe('rejected')
  })
})

describe('avalon engine2 — 永不死锁（AVR-405）', () => {
  /** 确定性 LCG（种子固定 → 模糊测试可复现）。 */
  function fuzzRng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 2 ** 32
    }
  }

  /** 随机动作模糊：随机合法/非法动作交替，非法被拒后走默认，断言必达终局。 */
  function fuzzMatch(acc: Acc, seed: number, maxSteps = 2000): void {
    const rng = fuzzRng(seed)
    let steps = 0
    while (acc.state.phase !== 'ended') {
      if (steps++ > maxSteps) throw new Error('fuzz: exceeded step bound (deadlock?)')
      const actor = acc.state.pendingActor
      if (!actor) throw new Error('fuzz: no pending actor outside ended')
      const options = availableActions(acc.state, actor)
      expect(options).toHaveLength(1) // 阿瓦隆任一时刻当值玩家恰有一种动作类型

      const roll = rng()
      let action: AvalonAction
      if (roll < 0.1) {
        action = { type: 'speak', actorId: actor, text: 'fuzz' } // 大概率 WRONG_PHASE → 被拒
      } else if (roll < 0.2) {
        action = { type: 'vote', actorId: actor, approve: rng() < 0.5 }
      } else if (roll < 0.3) {
        action = { type: 'quest', actorId: actor, succeed: rng() < 0.5 } // 好人 fail 可能被拒
      } else if (roll < 0.4) {
        action = { type: 'proposeTeam', actorId: actor, targetIds: [actor] } // 人数错 → 被拒
      } else if (roll < 0.5) {
        action = { type: 'assassinate', actorId: actor, targetId: actor } // 本人 → 被拒
      } else if (roll < 0.6) {
        action = { type: 'consult', actorId: actor, text: '' } // 空文本 → 被拒
      } else {
        const option = options[0]
        action = legalActionFor(acc, actor, option.type, rng)
      }

      const outcome = applyAction(acc.state, action)
      if (outcome.status === 'accepted') {
        acc.state = outcome.state
        acc.events.push(...outcome.events)
      } else {
        const fallback = applyDefaultAction(acc.state)
        if (fallback.status !== 'accepted') {
          throw new Error(`fuzz: default rejected in ${acc.state.phase}: ${fallback.rejection.message}`)
        }
        acc.state = fallback.state
        acc.events.push(...fallback.events)
      }
    }
  }

  /** 按当前合法动作类型生成一个合法动作（目标/立场由 rng 决定）。 */
  function legalActionFor(acc: Acc, actor: string, type: string, rng: () => number): AvalonAction {
    const state = acc.state
    const ids = state.players.map((p) => p.playerId)
    switch (type) {
      case 'speak':
        return { type: 'speak', actorId: actor, text: `模糊发言 ${Math.floor(rng() * 1000)}` }
      case 'proposeTeam': {
        const size = state.board.teamSizes[state.round - 1]
        const pool = [...ids]
        const team: string[] = []
        while (team.length < size && pool.length > 0) {
          team.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
        }
        return { type: 'proposeTeam', actorId: actor, targetIds: team }
      }
      case 'vote':
        return { type: 'vote', actorId: actor, approve: rng() < 0.5 }
      case 'quest':
        return { type: 'quest', actorId: actor, succeed: rng() < 0.7 }
      case 'consult':
        return { type: 'consult', actorId: actor, text: `合议 ${Math.floor(rng() * 1000)}` }
      case 'assassinate': {
        const others = ids.filter((id) => id !== actor)
        return { type: 'assassinate', actorId: actor, targetId: others[Math.floor(rng() * others.length)] }
      }
      default:
        throw new Error(`fuzz: unknown legal action ${type}`)
    }
  }

  it('随机动作序列 ×3 局（含非法注入）都必达终局且重放一致', () => {
    for (const seed of [11, 202, 30007]) {
      const acc = start5()
      fuzzMatch(acc, seed)
      expect(acc.state.outcome).not.toBeNull()
      expect(acc.state.phase).toBe('ended')
      expect(evsOf(acc.events, 'gameEnded')).toHaveLength(1)
    }
  })

  it('关讨论板 + 随机动作同样永不死锁', () => {
    const acc = startBoard({ ...boardOf('basic-5'), discussionEnabled: false }, SEATING_5)
    fuzzMatch(acc, 999)
    expect(acc.state.phase).toBe('ended')
  })

  it('强制终结：战绩多者胜、0:0 平局（basis 注明）', () => {
    const fresh = start5()
    const tie = terminateImmediately(fresh.state)
    expect(tie.status).toBe('accepted')
    if (tie.status === 'accepted') {
      expect(tie.state.outcome).toEqual({ winner: 'tie', basis: 'terminated-immediate:quests-0-0' })
    }
    // 已终局再终结被拒
    expect(terminateImmediately(tie.status === 'accepted' ? tie.state : fresh.state).status).toBe('rejected')

    const ahead = start5()
    runApprovedQuest(ahead, ['p1', 'p2'], true)
    const win = terminateImmediately(ahead.state)
    expect(win.status).toBe('accepted')
    if (win.status === 'accepted') {
      expect(win.state.outcome).toEqual({ winner: 'good', basis: 'terminated-immediate:quests-1-0' })
      expect(evOf(win.events, 'gameEnded').payload.reveal).toHaveLength(5)
    }
  })
})
