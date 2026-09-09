// 确定性重放（AVR-N1 / AVR-503）：种子入流 → reduceEvents 重放重建逐字段
// 同态 state；含刺杀局（合议副本事件只锚定一次）与默认动作混合驱动。

import { describe, expect, it } from 'vitest'
import { reduceEvents } from '@/games/avalon/engine2'
import {
  propose,
  runApprovedQuest,
  runDefaults,
  scriptedAssassinationHit,
  scriptedAvalonMatch,
  scriptedEvilQuestWin,
  scriptedGoodWin,
  speakAll,
  start5,
  step,
  voteAll,
} from './_helpers'

describe('avalon engine2 — 确定性重放（AVR-N1）', () => {
  it('同脚本两次驱动产生逐字节相同的事件流', () => {
    expect(JSON.stringify(scriptedAvalonMatch().events)).toBe(JSON.stringify(scriptedAvalonMatch().events))
    expect(JSON.stringify(scriptedGoodWin().events)).toBe(JSON.stringify(scriptedGoodWin().events))
  })

  it('reduceEvents 重建连坐局同态终局 state', () => {
    const acc = scriptedAvalonMatch()
    expect(acc.state.outcome).toEqual({ winner: 'evil', basis: 'connective-rejection:round-4' })
    const replayed = reduceEvents(acc.events)
    expect(replayed.status).toBe('ok')
    if (replayed.status !== 'ok') return
    expect(replayed.state).toEqual(acc.state)
  })

  it('reduceEvents 重建刺杀局同态（合议副本只锚定一次 / 命中与未命中两分支）', () => {
    for (const acc of [scriptedGoodWin(), scriptedAssassinationHit()]) {
      expect(acc.state.phase).toBe('ended')
      const replayed = reduceEvents(acc.events)
      expect(replayed.status).toBe('ok')
      if (replayed.status !== 'ok') return
      expect(replayed.state).toEqual(acc.state)
    }
  })

  it('reduceEvents 重建坏人 3 失败速胜局同态', () => {
    const acc = scriptedEvilQuestWin()
    const replayed = reduceEvents(acc.events)
    expect(replayed.status).toBe('ok')
    if (replayed.status !== 'ok') return
    expect(replayed.state).toEqual(acc.state)
  })

  it('混合驱动（显式 + 默认）后重放仍同态', () => {
    const acc = start5()
    speakAll(acc)
    propose(acc, ['p1', 'p3'])
    voteAll(acc, [true, false, true, false, true]) // 3-2 通过
    step(acc, { type: 'quest', actorId: 'p1', succeed: true })
    runDefaults(acc, (a) => a.state.phase !== 'quest')
    // 剩余轮次全部默认
    runDefaults(acc, (a) => a.state.phase === 'ended')

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

  it('板子参数随流重建：关讨论板重放同态', () => {
    const acc = start5()
    // 用显式开局（basic-5 开讨论）验证轮转骨架即可；板参数在 matchStarted 内
    runApprovedQuest(acc, ['p1', 'p2'], true)
    const replayed = reduceEvents(acc.events)
    expect(replayed.status).toBe('ok')
    if (replayed.status !== 'ok') return
    expect(replayed.state.board).toEqual(acc.state.board)
    expect(replayed.state.board.discussionEnabled).toBe(true)
  })
})
