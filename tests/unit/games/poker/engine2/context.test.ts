// PFR-501：决策上下文派生量——合法动作集（含 min/max）、pot odds、有效筹码、位置标签；
// 查询说合法 ⇔ 校验接受（与 PFR-207 联合验证）；查询只读零副作用。
// PFR-502：引擎不提供 equity/ICM 策略量。

import { describe, expect, it } from 'vitest'
import { applyAction, decisionContext, legalActionSet, positionLabels } from '@/games/poker/engine2'
import type { LegalAction, LegalActionSet, MatchState } from '@/games/poker/engine2'
import { driver, findSeed, mkConfig, newMatch, play } from './testkit'

const SEED_BUTTON0 = () => findSeed({ players: 6, button: 0, where: () => true })

describe('PFR-501 派生量（表驱动手工复核）', () => {
  it('pot odds / min-raise / max：盲注 1/2，UTG 加注到 8 后下一位（MP）的派生量', () => {
    // 6 人局：p0=BTN p1=SB p2=BB p3=UTG p4=MP p5=CO，起始 500
    const created = newMatch(mkConfig(['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], 500, 1, 2), SEED_BUTTON0())
    expect(created.state.currentActor).toBe('p3')
    const s1 = play(created.state, [['p3', { type: 'raise', toAmount: 8 }]]).state
    expect(s1.currentActor).toBe('p4')

    const ctx = decisionContext(s1)
    expect(ctx).not.toBeNull()
    if (!ctx) return
    // 池 = SB 1 + BB 2 + UTG 8 = 11；行动者 toCall 8；跟注后总池 19；odds = 8/19
    expect(ctx.potTotal).toBe(11)
    expect(ctx.toCall).toBe(8)
    expect(ctx.potOdds.potAfterCall).toBe(19)
    expect(ctx.potOdds.ratio).toBeCloseTo(8 / 19, 10)
    expect(ctx.minRaiseTo).toBe(14)
    expect(ctx.maxRaiseTo).toBe(500)
    expect(ctx.actorStack).toBe(500)
    // 位置标签：相对按钮的语义标签
    expect(ctx.allPositions).toEqual({
      p0: 'BTN',
      p1: 'SB',
      p2: 'BB',
      p3: 'UTG',
      p4: 'MP',
      p5: 'CO',
    })
    expect(ctx.position).toBe('MP')
  })

  it('有效筹码：先受自身风险限制，后受 all-in 对手风险封顶（表驱动手工复核）', () => {
    // 手 1（3 人 600，盲注 100/200，按钮 p0）：p0 弃 / p1 SB 补平 / p2 BB check / flop p1 下注 200、p2 弃
    // → 筹码变为 p0 600 / p1 800 / p2 400
    const seed = findSeed({ players: 3, button: 0, where: () => true })
    const d = driver(mkConfig(['p0', 'p1', 'p2'], 600, 100, 200), seed)
    d.step('p0', { type: 'fold' })
    d.step('p1', { type: 'call' })
    d.step('p2', { type: 'check' })
    d.step('p1', { type: 'bet', amount: 200 })
    d.step('p2', { type: 'fold' })
    // 手 1 结束筹码 600/800/400；手 2（按钮 p1，SB=p2、BB=p0）盲注已扣
    expect(d.state.players.map((p) => [p.seatId, p.stack])).toEqual([
      ['p0', 400],
      ['p1', 800],
      ['p2', 300],
    ])

    // 手 2（按钮 p1，SB p2、BB p0、UTG p1）：p1 加注至 500
    d.step('p1', { type: 'raise', toAmount: 500 })
    // p2（SB，post 100 余 300）：自身风险 400 为最小 → effective = 400
    const ctxSb = decisionContext(d.state)
    expect(ctxSb?.actor).toBe('p2')
    expect(ctxSb?.toCall).toBe(400)
    expect(ctxSb?.potTotal).toBe(800) // 100 + 200 + 500
    expect(ctxSb?.potOdds.potAfterCall).toBe(1200)
    expect(ctxSb?.potOdds.ratio).toBeCloseTo(1 / 3, 10)
    expect(ctxSb?.effectiveStack).toBe(400)
    // p2 短码全下跟注（streetBet 400 < 500）后，p0（BB）的有效筹码被 all-in 的 p2 封顶为 400
    d.step('p2', { type: 'call' })
    const ctxBb = decisionContext(d.state)
    expect(ctxBb?.actor).toBe('p0')
    expect(ctxBb?.effectiveStack).toBe(400)
    expect(ctxBb?.minRaiseTo).toBe(800) // 500 + 最近完整加注增量 300
  })

  it('heads-up 位置标签：按钮 = BTN/SB，另一位 = BB（PFR-204）', () => {
    const created = newMatch(mkConfig(['p0', 'p1'], 500, 2, 4), 9)
    const labels = positionLabels(created.state)
    const buttonSeat = created.state.hand?.buttonSeat
    expect(labels[`p${buttonSeat}`]).toBe('BTN/SB')
    expect(labels[`p${buttonSeat === 0 ? 1 : 0}`]).toBe('BB')
  })

  it('短码局面：legal 集反映"仅剩全下"形态（minTo > maxTo 时仅全下额合法）', () => {
    // 起始 3，盲注 2/4：p1=SB post 2 余 1；BB post 3 全下；p0(按钮) 面前 toCall 4、stack 3
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 3, 2, 4), findSeed({ players: 3, button: 0, where: () => true }))
    const legal = legalActionSet(created.state)
    expect(legal?.actor).toBe('p0')
    // toCall 4 > stack 3 → call 即全下；加注不可能（maxTo 3 ≤ currentBet 4）
    expect(legal?.toCall).toBe(4)
    const call = legal?.actions.find((a) => a.type === 'call')
    expect(call && call.type === 'call' ? [call.amount, call.allIn] : null).toEqual([3, true])
    expect(legal?.actions.some((a) => a.type === 'raise')).toBe(false)
    expect(legal?.actions.some((a) => a.type === 'bet')).toBe(false)
    const allIn = legal?.actions.find((a) => a.type === 'all-in')
    expect(allIn && allIn.type === 'all-in' ? allIn.to : null).toBe(3) // 全下即跟注形式
  })
})

describe('PFR-501 合法集 ⇔ 校验一致性（与 PFR-207 联合验证）', () => {
  /** 由合法条目构造一个应被接受的原始动作。 */
  function rawFrom(entry: LegalAction): unknown {
    switch (entry.type) {
      case 'fold':
      case 'check':
      case 'call':
      case 'all-in':
        return { type: entry.type }
      case 'bet':
        return { type: 'bet', amount: entry.minTo <= entry.maxTo ? entry.minTo : entry.maxTo }
      case 'raise':
        return { type: 'raise', toAmount: entry.minTo <= entry.maxTo ? entry.minTo : entry.maxTo }
    }
  }

  /** 收集一组状态下合法集的每一条都被接受。 */
  function assertAllLegalAccepted(state: MatchState): void {
    const legal: LegalActionSet | null = legalActionSet(state)
    expect(legal).not.toBeNull()
    if (!legal) return
    for (const entry of legal.actions) {
      const r = applyAction(state, legal.actor, rawFrom(entry))
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error(`${JSON.stringify(entry)} 应被接受: ${r.rejection.code}`)
    }
  }

  it('多个局面的合法集逐条被引擎接受（含边界值 minTo / maxTo）', () => {
    const seed = findSeed({ players: 3, button: 0, where: () => true })
    const d = driver(mkConfig(['p0', 'p1', 'p2'], 500, 1, 2), seed)
    assertAllLegalAccepted(d.state) // preflop UTG
    d.step('p0', { type: 'raise', toAmount: 8 })
    assertAllLegalAccepted(d.state) // 面对加注的 SB
    d.step('p1', { type: 'call' })
    assertAllLegalAccepted(d.state) // BB 面对加注（toCall 6）
    d.step('p2', { type: 'call' })
    assertAllLegalAccepted(d.state) // flop 首 actor（SB）
    d.step('p1', { type: 'bet', amount: 20 })
    assertAllLegalAccepted(d.state) // 面对下注
    d.step('p2', { type: 'raise', toAmount: 60 })
    assertAllLegalAccepted(d.state) // 面对加注（含重开）
    d.step('p0', { type: 'fold' })
    d.step('p1', { type: 'call' })
    assertAllLegalAccepted(d.state) // turn
  })

  it('非法动作逐条被拒：查询未提供的类型/金额一律拒绝', () => {
    const seed = findSeed({ players: 3, button: 0, where: () => true })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 500, 1, 2), seed)
    const illegal: ReadonlyArray<unknown> = [
      { type: 'check' }, // 面对盲注
      { type: 'bet', amount: 999 }, // 超筹码
      { type: 'bet', amount: 1 }, // 低于最小注且非全下
      { type: 'raise', toAmount: 3 }, // 低于最小加注（4）
      { type: 'raise', toAmount: 600 }, // 超筹码
      { type: 'folding' }, // 未知动作类型
    ]
    for (const action of illegal) {
      const r = applyAction(created.state, 'p0', action)
      expect(r.ok).toBe(false)
    }
    // 非行动者
    expect(applyAction(created.state, 'p1', { type: 'call' }).ok).toBe(false)
  })
})

describe('PFR-501/502 查询只读与能力边界', () => {
  it('只读查询任意次调用不改变状态、不产生事件（查询与推进严格分离）', () => {
    const seed = findSeed({ players: 3, button: 0, where: () => true })
    const created = newMatch(mkConfig(['p0', 'p1', 'p2'], 500, 1, 2), seed)
    const snapshot = JSON.stringify(created.state)
    for (let i = 0; i < 5; i++) {
      legalActionSet(created.state)
      decisionContext(created.state)
      positionLabels(created.state)
    }
    expect(JSON.stringify(created.state)).toBe(snapshot)
  })

  it('终局状态查询返回 null/不再提供行动上下文；引擎能力不含 equity/ICM（PFR-502）', () => {
    const seed = findSeed({ players: 2, button: 0, where: () => true })
    const created = newMatch(mkConfig(['p0', 'p1'], 1, 2, 4), seed) // 盲注全下 → 终局
    expect(created.state.phase).toBe('finished')
    expect(legalActionSet(created.state)).toBeNull()
    expect(decisionContext(created.state)).toBeNull()
    // 筹码与名次事实完整可得（PFR-502：策略量留给上层）
    expect(created.state.finish?.ranking).toHaveLength(2)
    expect(created.state.players.every((p) => typeof p.rank === 'number')).toBe(true)
  })
})
