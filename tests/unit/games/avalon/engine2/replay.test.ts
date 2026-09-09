// 确定性与默认驱动：种子入流 → reduceEvents 重放重建同态 state；
// applyDefaultAction（提案=自己+下家 / 表决=赞成 / 任务=成功）可独立把对局
// 驱动到终局（GM 兜底路径的引擎侧前提）。

import { describe, expect, it } from 'vitest'
import { applyDefaultAction, reduceEvents } from '@/games/avalon/engine2'
import {
  evOf,
  evsOf,
  propose,
  runDefaults,
  scriptedAvalonMatch,
  start5,
  step,
  voteAll,
} from './_helpers'

describe('avalon engine2 — 确定性重放', () => {
  it('同脚本两次驱动产生逐字节相同的事件流', () => {
    expect(JSON.stringify(scriptedAvalonMatch().events)).toBe(JSON.stringify(scriptedAvalonMatch().events))
  })

  it('reduceEvents 仅凭事件流重建出同态终局 state', () => {
    const acc = scriptedAvalonMatch()
    expect(acc.state.phase).toBe('ended')
    const replayed = reduceEvents(acc.events)
    expect(replayed.status).toBe('ok')
    if (replayed.status !== 'ok') return
    expect(replayed.state).toEqual(acc.state)
  })

  it('缺 matchStarted 头的事件流重放报错', () => {
    const acc = start5()
    const result = reduceEvents(acc.events.filter((event) => event.kind !== 'matchStarted'))
    expect(result.status).toBe('error')
  })
})

describe('avalon engine2 — 默认动作驱动', () => {
  it('默认链把对局驱动到终局：全赞成 + 全成功 → 好人 2-0', () => {
    const acc = start5()
    const applied = runDefaults(acc, (a) => a.state.phase === 'ended')
    // 每轮 1 提案 + 5 表决 + 2 抉择 = 8 步，两轮 16 步
    expect(applied).toBe(16)
    expect(acc.state.outcome).toEqual({ winner: 'good', basis: 'quests:2-0' })

    // 默认提案 = 队长自己 + 下家
    const proposals = evsOf(acc.events, 'teamProposed')
    expect(proposals[0].payload.teamIds).toEqual(['p1', 'p2'])
    expect(proposals[1].payload.teamIds).toEqual(['p2', 'p3'])

    // 默认产生的事件全部带 isDefault 标记
    for (const kind of ['teamProposed', 'voteCast', 'questChoice'] as const) {
      for (const event of evsOf(acc.events, kind)) {
        expect(event.isDefault).toBe(true)
      }
    }
    // 默认表决 = 赞成
    expect(evOf(acc.events, 'voteResult').payload.outcome).toBe('approved')
  })

  it('默认动作以当前 pendingActor 为行动者；终局后默认动作被拒', () => {
    const acc = start5()
    const outcome = applyDefaultAction(acc.state)
    expect(outcome.status).toBe('accepted')
    if (outcome.status === 'accepted') {
      expect(outcome.state.pendingActor).not.toBeNull()
      expect(outcome.events[0].actorId).toBe('p1')
    }
    runDefaults(acc, (a) => a.state.phase === 'ended')
    expect(applyDefaultAction(acc.state).status).toBe('rejected')
  })

  it('混合驱动（显式 + 默认）后重放仍同态', () => {
    const acc = start5()
    propose(acc, ['p1', 'p3'])
    voteAll(acc, [true, false, true, false, true]) // 3-2 通过
    step(acc, { type: 'quest', actorId: 'p1', succeed: true })
    // 剩余抉择走默认
    runDefaults(acc, (a) => a.state.phase !== 'quest')
    runDefaults(acc, (a) => a.state.phase === 'ended')

    const replayed = reduceEvents(acc.events)
    expect(replayed.status).toBe('ok')
    if (replayed.status !== 'ok') return
    expect(replayed.state).toEqual(acc.state)
  })
})
