// AC-11 / PFR-204、PFR-205、PFR-302：BB option 与街结束条件 + 唯一行动者或自动推进不变式。

import { describe, expect, it } from 'vitest'
import { applyAction, classifyState, legalActionSet } from '@/games/poker/engine2'
import type { MatchState } from '@/games/poker/engine2'
import { eventsOfKind, expectNoStall, findSeed, mkConfig, newMatch, play, valueOrder } from './testkit'

describe('AC-11 BB option', () => {
  it('preflop 无人加注时 BB 可 check（option），不得被强制 call', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 500, 1, 2), findSeed({ players: 3, button: 0, where: () => true }))
    // p0(按钮/UTG) 平跟 → p1(SB) 补平 → BB option
    const s1 = play(created.state, [
      ['p0', { type: 'call' }],
      ['p1', { type: 'call' }],
    ]).state
    expect(s1.currentActor).toBe('p2')
    const legal = legalActionSet(s1)
    expect(legal?.toCall).toBe(0)
    expect(legal?.actions.map((a) => a.type)).toContain('check')
    expect(legal?.actions.map((a) => a.type)).not.toContain('call')
    // BB 也有加注权（option 的另一半）
    expect(legal?.actions.map((a) => a.type)).toContain('raise')
    // call 声明被拒绝
    const r = applyAction(s1, 'p2', { type: 'call' })
    expect(r.ok).toBe(false)

    // BB check → flop
    const s2 = play(s1, [['p2', { type: 'check' }]]).state
    expect(s2.hand?.street).toBe('flop')
  })

  it('有人加注且 BB 跟注后无 option 二次行动：直接进入下一街', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 500, 1, 2), findSeed({ players: 3, button: 0, where: () => true }))
    const { state } = play(created.state, [
      ['p0', { type: 'raise', toAmount: 8 }],
      ['p1', { type: 'fold' }],
      ['p2', { type: 'call' }], // BB 跟注后行动闭合 → flop
    ])
    expect(state.hand?.street).toBe('flop')
    expect(state.currentActor).toBe('p2') // SB(p1) 已弃 → 按钮左一第一个在手玩家 = BB
  })

  it('街结束条件：有人尚未对最高额行动时不得推进街（PFR-205 验收例）', () => {
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 500, 1, 2), findSeed({ players: 3, button: 0, where: () => true }))
    // 仅 UTG 跟注、SB 尚未行动 → 仍在 preflop
    const s1 = play(created.state, [['p0', { type: 'call' }]]).state
    expect(s1.hand?.street).toBe('preflop')
    expect(s1.hand?.board).toHaveLength(0)
    expect(s1.currentActor).toBe('p1')

    // SB 跟注后 BB 仍未行动 → 仍 preflop
    const s2 = play(s1, [['p1', { type: 'call' }]]).state
    expect(s2.hand?.street).toBe('preflop')
    expect(s2.currentActor).toBe('p2')
  })
})

describe('PFR-302 唯一行动者或自动推进不变式（长序列压力）', () => {
  it('任意动作序列（连续弃牌/全下/跟注混合）逐推进不出现停滞态', () => {
    const seed = findSeed({ players: 3, button: 0, where: () => true })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 50, 1, 2), seed)
    let state: MatchState = created.state
    let steps = 0
    while (state.phase !== 'finished' && steps < 5000) {
      const cls = classifyState(state)
      expect(['awaiting-action', 'finished']).toContain(cls.kind)
      if (cls.kind !== 'awaiting-action') break
      // 确定性混合策略：每 3 步一次全下，其余跟注/过牌（保证摊牌与淘汰持续发生）
      const legal = legalActionSet(state)
      const toCall = legal?.toCall ?? 0
      const action: unknown =
        steps % 3 === 0 ? { type: 'all-in' } : toCall > 0 ? { type: 'call' } : { type: 'check' }
      const r = applyAction(state, state.currentActor as string, action)
      expect(r.ok).toBe(true)
      if (!r.ok) break
      state = r.state
      steps += 1
    }
    expect(state.phase).toBe('finished')
    // 筹码守恒
    const total = state.players.reduce((sum, p) => sum + p.stack, 0)
    expect(total).toBe(150)
    // 单人存活 + 完整排名（1..3）
    const finished = classifyState(state)
    expect(finished.kind).toBe('finished')
    if (finished.kind === 'finished') {
      expect(finished.ranking).toHaveLength(3)
      expect(finished.ranking.map((x) => x.rank)).toEqual([1, 2, 3])
    }
    expectNoStall(state)
  })

  it('大量连续全下：事件流中 run-out 无等待动作状态（PFR-210）', () => {
    // 牌面严格分出胜负（无平局）→ 两家出局 → 自然终局
    const seed = findSeed({ players: 3, button: 0, where: (l1) => valueOrder(l1, [0, 1, 2]) })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 50, 1, 2), seed)
    const { state, events } = play(created.state, [
      ['p0', { type: 'all-in' }],
      ['p1', { type: 'all-in' }],
      ['p2', { type: 'all-in' }],
    ])
    expect(eventsOfKind(events, 'run-out-started')).toHaveLength(1)
    expect(eventsOfKind(events, 'player-eliminated')).toHaveLength(2)
    expect(state.phase).toBe('finished')
    expectNoStall(state)
  })
})
