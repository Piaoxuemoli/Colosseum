// 决策上下文派生量（PFR-501）：机械量引擎算，策略量 agent 算（PFR-502：不提供 equity/ICM）。
// 只读查询：不改变状态、不产生事件。

import type { Card } from './cards'
import { legalActionSet } from './legal'
import type { LegalActionSet } from './legal'
import type { MatchState, PlayerState, Street } from './types'

export type PositionLabel = 'BTN' | 'BTN/SB' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'MP' | 'LJ' | 'HJ' | 'CO'

export interface DecisionContext {
  actor: string
  hand: number
  street: Street
  board: Card[]
  actorHoleCards: Card[]
  /** 本手全体玩家已投入总额（当前池）。 */
  potTotal: number
  toCall: number
  /** pot odds 口径：跟注后总池与比值（PFR-501）。 */
  potOdds: { toCall: number; potAfterCall: number; ratioNum: number; ratioDen: number; ratio: number }
  /** 最小合法加注/下注"加到额"；null = 当前无加注权。 */
  minRaiseTo: number | null
  maxRaiseTo: number
  /** 有效筹码：行动者与最深在手对手间的最大可对撞额。 */
  effectiveStack: number
  actorStack: number
  position: PositionLabel
  allPositions: Readonly<Record<string, PositionLabel>>
  legalActions: LegalActionSet
}

/**
 * 位置标签（相对按钮的语义标签，逐玩家给出）：
 * - heads-up：按钮 = SB（'BTN/SB'），另一位为 'BB'（PFR-204）；
 * - 3+ 人：BTN / SB / BB，BB 与按钮之间的中间座位自 UTG 起、按钮前一位为 CO。
 */
export function positionLabels(state: MatchState): Record<string, PositionLabel> {
  const alive = state.players.filter((p) => p.status !== 'eliminated')
  const result: Record<string, PositionLabel> = {}
  if (!state.hand) {
    for (const p of alive) result[p.seatId] = 'BTN'
    return result
  }
  const h = state.hand
  const bySeat = (seat: number) => alive.find((p) => p.seat === seat)

  if (alive.length === 2) {
    for (const p of alive) {
      result[p.seatId] = p.seat === h.buttonSeat ? 'BTN/SB' : 'BB'
    }
    return result
  }

  // 中间座位（BB 与按钮之间，顺时针自 BB+1）：首为 UTG、末为 CO，中间取 MP/LJ/HJ 序列
  const middleLabels: PositionLabel[] = ['UTG', 'MP', 'LJ', 'HJ']
  const middle: PlayerState[] = []
  const n = state.players.length
  for (let i = 1; i <= n; i++) {
    const idx = (h.bbSeat + i) % n
    if (idx === h.buttonSeat) break
    const p = bySeat(idx)
    if (p) middle.push(p)
  }
  const m = middle.length
  middle.forEach((p, i) => {
    result[p.seatId] = m === 1 ? 'CO' : i === m - 1 ? 'CO' : middleLabels[Math.min(i, middleLabels.length - 1)]
  })
  const btn = bySeat(h.buttonSeat)
  const sb = bySeat(h.sbSeat)
  const bb = bySeat(h.bbSeat)
  if (btn) result[btn.seatId] = 'BTN'
  if (sb) result[sb.seatId] = 'SB'
  if (bb) result[bb.seatId] = 'BB'
  return result
}

/** 当前行动者的决策上下文；非 awaiting-action 状态返回 null（查询与推进严格分离）。 */
export function decisionContext(state: MatchState): DecisionContext | null {
  const legal = legalActionSet(state)
  if (!legal || state.hand === null) return null
  const h = state.hand
  const actor = state.players.find((p) => p.seatId === legal.actor)
  if (!actor) return null

  const potTotal = state.players.reduce((sum, p) => sum + p.totalCommitted, 0)
  const toCall = legal.toCall
  const potAfterCall = potTotal + toCall

  const inHandOthers = state.players.filter(
    (p) => (p.status === 'active' || p.status === 'all-in') && p.seatId !== actor.seatId,
  )
  const actorRisk = actor.stack + actor.streetBet
  let effectiveStack = actorRisk
  for (const opp of inHandOthers) {
    const oppRisk = opp.stack + opp.streetBet
    if (oppRisk < effectiveStack) effectiveStack = oppRisk
  }

  const positions = positionLabels(state)
  return {
    actor: actor.seatId,
    hand: h.handNumber,
    street: h.street,
    board: [...h.board],
    actorHoleCards: [...actor.holeCards],
    potTotal,
    toCall,
    potOdds: {
      toCall,
      potAfterCall,
      ratioNum: toCall,
      ratioDen: potAfterCall,
      ratio: potAfterCall > 0 ? toCall / potAfterCall : 0,
    },
    minRaiseTo: legal.minRaiseTo,
    maxRaiseTo: legal.maxRaiseTo,
    effectiveStack,
    actorStack: actor.stack,
    position: positions[actor.seatId] ?? 'BTN',
    allPositions: positions,
    legalActions: legal,
  }
}
