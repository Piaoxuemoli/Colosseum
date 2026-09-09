// 流程裁决（R3-2 冒烟规则主体）：提案 → 全员表决（拒 3 次判负）→
// 任务执行（好人只能成功 / 坏人任选）→ 结果公布（不点名）→ 2 胜终局两个方向。

import { describe, expect, it } from 'vitest'
import { SEATING_5, evOf, evsOf, fail, playerByRole, propose, questAll, start5, step, voteAll } from './_helpers'

describe('avalon engine2 — 提案与表决', () => {
  it('队长提案 2 人 → 全员表决（座位序逐票）→ 多数赞成进入任务', () => {
    const acc = start5()
    expect(acc.state.pendingActor).toBe('p1')
    propose(acc, ['p1', 'p2'])

    expect(acc.state.phase).toBe('teamVote')
    expect(acc.state.pendingActor).toBe('p1')
    voteAll(acc, [true, true, true, false, false])

    const result = evOf(acc.events, 'voteResult')
    expect(result.audience).toEqual({ kind: 'public' })
    expect(result.payload).toEqual({ round: 1, attempt: 1, approvals: 3, rejections: 2, outcome: 'approved' })
    expect(acc.state.phase).toBe('quest')
    expect(acc.state.pendingActor).toBe('p1') // 队伍座位序（p1, p2）
  })

  it('个人表决选择仅投票人可见（role-self ×5），汇总不点名', () => {
    const acc = start5()
    propose(acc, ['p3', 'p4'])
    voteAll(acc, true)
    const casts = evsOf(acc.events, 'voteCast').filter((event) => event.payload.round === 1 && event.payload.attempt === 1)
    expect(casts).toHaveLength(5)
    for (const cast of casts) {
      expect(cast.audience).toEqual({ kind: 'role-self', playerId: cast.actorId })
    }
  })

  it('多数否决 → 队长轮转重新提案（attempt + 1）', () => {
    const acc = start5()
    propose(acc, ['p1', 'p2'])
    voteAll(acc, [false, false, false, true, true]) // 2 赞成 3 反对

    const result = evOf(acc.events, 'voteResult')
    expect(result.payload.outcome).toBe('rejected')
    expect(acc.state.phase).toBe('proposal')
    expect(acc.state.pendingActor).toBe('p2') // 队长按座位轮转
    expect(acc.state.attempt).toBe(2)

    const leaders = evsOf(acc.events, 'leaderAssigned')
    expect(leaders.map((leader) => leader.payload.leaderId)).toEqual(['p1', 'p2'])
    expect(leaders[1].payload.attempt).toBe(2)
  })

  it('同一轮第 3 次拒绝 → 该任务直接判失败（防死锁），进入下一轮', () => {
    const acc = start5()
    // 三连拒：队长 p1 / p2 / p3 依次提案均被否
    propose(acc, ['p1', 'p2'])
    voteAll(acc, false)
    propose(acc, ['p2', 'p3'])
    voteAll(acc, false)
    propose(acc, ['p3', 'p4'])
    voteAll(acc, false)

    const questResults = evsOf(acc.events, 'questResult')
    expect(questResults).toHaveLength(1)
    expect(questResults[0].payload).toEqual({ round: 1, outcome: 'fail', failVotes: 0, autoFailed: true })
    expect(questResults[0].audience).toEqual({ kind: 'public' })
    expect(acc.state.results[0].autoFailed).toBe(true)
    // 未进入任务阶段，直接轮 2、队长轮转到 p4
    expect(acc.state.round).toBe(2)
    expect(acc.state.phase).toBe('proposal')
    expect(acc.state.pendingActor).toBe('p4')
    expect(acc.state.outcome).toBeNull()
  })
})

describe('avalon engine2 — 任务执行与裁决', () => {
  it('队伍成员秘密抉择：好人只能成功，坏人可任选；结果公布不点名', () => {
    const acc = start5()
    const minion = playerByRole(acc, 'minion').playerId // p5
    propose(acc, ['p4', 'p5']) // 莫德雷德 + 爪牙
    voteAll(acc, true)
    questAll(acc, [true, false]) // p4 成功、p5（爪牙）失败

    const choices = evsOf(acc.events, 'questChoice')
    expect(choices).toHaveLength(2)
    for (const choice of choices) {
      expect(choice.audience).toEqual({ kind: 'role-self', playerId: choice.actorId })
    }
    const result = evOf(acc.events, 'questResult')
    expect(result.payload).toEqual({ round: 1, outcome: 'fail', failVotes: 1, autoFailed: false })
    // 公共载荷不点名：无成员/投票人字段
    expect(JSON.stringify(result.payload)).not.toContain(minion)
  })

  it('好人提交「失败」被结构化拒绝（ILLEGAL_CHOICE）', () => {
    const acc = start5()
    propose(acc, ['p1', 'p3']) // 两位好人
    voteAll(acc, true)
    const rejection = fail(acc, { type: 'quest', actorId: 'p1', succeed: false })
    expect(rejection.code).toBe('ILLEGAL_CHOICE')
    // 坏人提交失败合法
    const acc2 = start5()
    propose(acc2, ['p4', 'p1'])
    voteAll(acc2, true)
    step(acc2, { type: 'quest', actorId: 'p1', succeed: true })
    step(acc2, { type: 'quest', actorId: 'p4', succeed: false })
    expect(evOf(acc2.events, 'questResult').payload.outcome).toBe('fail')
  })

  it('非法动作拒绝：非队长提案 / 重复成员 / 错阶段 / 非当值行动者', () => {
    const acc = start5()
    expect(fail(acc, { type: 'proposeTeam', actorId: 'p2', targetIds: ['p2', 'p3'] }).code).toBe('WRONG_ACTOR')
    expect(fail(acc, { type: 'proposeTeam', actorId: 'p1', targetIds: ['p1', 'p1'] }).code).toBe('ILLEGAL_TARGET')
    expect(fail(acc, { type: 'proposeTeam', actorId: 'p1', targetIds: ['p1', 'ghost'] }).code).toBe('ILLEGAL_TARGET')
    expect(fail(acc, { type: 'vote', actorId: 'p1', approve: true }).code).toBe('WRONG_PHASE')
    expect(fail(acc, { type: 'quest', actorId: 'p1', succeed: true }).code).toBe('WRONG_PHASE')

    propose(acc, ['p1', 'p2'])
    expect(fail(acc, { type: 'vote', actorId: 'p3', approve: true }).code).toBe('WRONG_ACTOR')
    expect(fail(acc, { type: 'proposeTeam', actorId: 'p2', targetIds: ['p2', 'p3'] }).code).toBe('WRONG_PHASE')
  })
})

describe('avalon engine2 — 2 胜终局（两个方向）', () => {
  it('好人 2 任务成功 → 好人胜，全员揭示（delayed-public）', () => {
    const acc = start5()
    // 轮 1：队长 p1 提 [p1,p2]，全赞成，双双成功
    propose(acc, ['p1', 'p2'])
    voteAll(acc, true)
    questAll(acc, true)
    // 轮 2：队长 p2 提 [p1,p2]，全赞成，双双成功
    propose(acc, ['p1', 'p2'])
    voteAll(acc, true)
    questAll(acc, true)

    expect(acc.state.phase).toBe('ended')
    expect(acc.state.outcome).toEqual({ winner: 'good', basis: 'quests:2-0' })
    const ended = evOf(acc.events, 'gameEnded')
    expect(ended.audience).toEqual({ kind: 'delayed-public' })
    expect(ended.payload.winner).toBe('good')
    expect(ended.payload.reveal).toHaveLength(5)
    expect(ended.payload.reveal.map((row) => row.role).sort()).toEqual([...SEATING_5].sort())
    expect(acc.state.pendingActor).toBeNull()
  })

  it('坏人 2 任务失败 → 坏人胜（2-1，第三轮定胜负）', () => {
    const acc = start5()
    // 轮 1：好人队伍成功
    propose(acc, ['p1', 'p2'])
    voteAll(acc, true)
    questAll(acc, true)
    // 轮 2：爪牙上车投失败
    propose(acc, ['p4', 'p5'])
    voteAll(acc, true)
    questAll(acc, [true, false])
    expect(acc.state.outcome).toBeNull() // 1-1 未终局
    // 轮 3：爪牙再次上车投失败 → 1-2 坏人胜
    propose(acc, ['p3', 'p5'])
    voteAll(acc, true)
    questAll(acc, [true, false])

    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'quests:1-2' })
    expect(acc.state.results.map((result) => result.outcome)).toEqual(['success', 'fail', 'fail'])
    expect(evOf(acc.events, 'gameEnded').payload.winner).toBe('evil')
  })

  it('连续三轮拒决也能分出胜负（3 次自动判负 → 坏人 2 胜）', () => {
    const acc = start5()
    for (let round = 0; round < 2; round++) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const leader = acc.state.pendingActor
        if (!leader) throw new Error('no leader pending')
        const seat = acc.state.players.find((player) => player.playerId === leader)?.seat ?? 1
        const nextSeat = (seat % 5) + 1
        const nextId = acc.state.players.find((player) => player.seat === nextSeat)?.playerId
        if (!nextId) throw new Error('no next seat')
        propose(acc, [leader, nextId])
        voteAll(acc, false)
      }
    }
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'quests:0-2' })
    expect(acc.state.results.every((result) => result.autoFailed)).toBe(true)
  })
})
