// 动作合法性：合法动作集生成 + 原始动作校验/规范化（PFR-205/206/207/501/503）。
// 关键口径：
// - 最小加注增量 = 本街最近一次完整 bet/raise 的增量（PFR-206）；
// - preflop 盲注视为首个下注（BB 为基准增量）；postflop 无下注时最小 bet = 1 BB；
// - 不足额全下不重开行动（full-bet 口径，OD 显式采用）；
// - 金额越界一律结构化拒绝，绝不静默修正或夹取。

import type { ActionRejection, MatchState, NormalizedAction, PlayerState, Street } from './types'
import { playerActionSchema } from './types'

export type LegalAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call'; amount: number; allIn: boolean }
  | { type: 'bet'; minTo: number; maxTo: number }
  | { type: 'raise'; minTo: number; maxTo: number }
  | { type: 'all-in'; to: number }

export interface LegalActionSet {
  actor: string
  street: Street
  toCall: number
  currentBet: number
  /** 当前合法加注"到额"区间；若 minTo > maxTo，则仅 maxTo（全下）合法。 */
  minRaiseTo: number | null
  maxRaiseTo: number
  actions: readonly LegalAction[]
}

export interface ValidateOk {
  ok: true
  normalized: NormalizedAction
}
export interface ValidateErr {
  ok: false
  rejection: ActionRejection
}
export type ValidateOutcome = ValidateOk | ValidateErr

/** 派生注额口径：postflop 未下注时最小增量回退为 1 BB（PFR-206）。 */
function minIncrement(state: MatchState): number {
  const h = state.hand
  if (!h) return 0
  return h.lastRaiseIncrement > 0 ? h.lastRaiseIncrement : state.blinds.bb
}

/** 生成当前行动者的合法动作集；仅在 awaiting-action 状态非空（PFR-501：与校验同源）。 */
export function legalActionSet(state: MatchState): LegalActionSet | null {
  if (state.phase !== 'awaiting-action' || state.currentActor === null || state.hand === null) return null
  const p = actorOf(state)
  if (!p) return null
  const h = state.hand

  const toCall = Math.max(0, h.currentBet - p.streetBet)
  const actions: LegalAction[] = [{ type: 'fold' }]
  if (toCall === 0) {
    actions.push({ type: 'check' })
  } else {
    actions.push({ type: 'call', amount: Math.min(toCall, p.stack), allIn: p.stack <= toCall })
  }

  const maxTo = p.streetBet + p.stack
  const raiseRight = !p.hasActed
  const minRaiseTo = h.currentBet > 0 ? h.currentBet + minIncrement(state) : state.blinds.bb

  if (h.currentBet === 0) {
    // 街内首个下注：min = 1 BB；筹码不足 BB 时仅剩全下形式（由 all-in 条目表达）
    actions.push({ type: 'bet', minTo: state.blinds.bb, maxTo })
    actions.push({ type: 'all-in', to: maxTo })
  } else {
    if (raiseRight && maxTo > h.currentBet) {
      actions.push({ type: 'raise', minTo: minRaiseTo, maxTo })
    }
    // 全下：不足以超过当前注额时即跟注全下；无加注权时也不提供超过当前注额的全下
    if (maxTo <= h.currentBet || raiseRight) {
      actions.push({ type: 'all-in', to: maxTo })
    }
  }

  return {
    actor: p.seatId,
    street: h.street,
    toCall,
    currentBet: h.currentBet,
    minRaiseTo: h.currentBet > 0 ? minRaiseTo : null,
    maxRaiseTo: maxTo,
    actions,
  }
}

/** 原始动作 → 规范化动作或结构化拒绝（PFR-207/503；拒绝零副作用）。 */
export function validateAction(state: MatchState, seatId: string, raw: unknown): ValidateOutcome {
  if (state.phase === 'finished') {
    return {
      ok: false,
      rejection: { code: 'MATCH_ALREADY_FINISHED', message: '对局已终局，不接受任何动作' },
    }
  }
  if (state.phase !== 'awaiting-action' || state.currentActor === null || state.hand === null) {
    return {
      ok: false,
      rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: '当前状态不接受玩家动作（引擎自动推进中）' },
    }
  }
  const legal = legalActionSet(state)
  if (!legal) {
    return { ok: false, rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: '无当前行动者' } }
  }
  const base = { currentActor: legal.actor, legalActions: legal.actions }
  if (seatId !== legal.actor) {
    return {
      ok: false,
      rejection: { code: 'NOT_CURRENT_ACTOR', message: `非当前行动者（当前：${legal.actor}）`, ...base },
    }
  }
  const p = actorOf(state)
  const h = state.hand
  if (!p || !h) {
    return { ok: false, rejection: { code: 'NOT_CURRENT_ACTOR', message: '座位不存在', ...base } }
  }

  const parsed = playerActionSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      rejection: { code: 'INVALID_AMOUNT', message: '动作结构或金额非法（金额须为正整数）', ...base },
    }
  }
  const action = parsed.data
  const toCall = legal.toCall
  const maxTo = p.streetBet + p.stack

  switch (action.type) {
    case 'fold':
      return { ok: true, normalized: { type: 'fold', seatId } }

    case 'check': {
      if (toCall !== 0) {
        return {
          ok: false,
          rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: `面临下注（需跟 ${toCall}），不能 check`, ...base },
        }
      }
      return { ok: true, normalized: { type: 'check', seatId } }
    }

    case 'call': {
      if (toCall === 0) {
        return {
          ok: false,
          rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: '无注可跟，应 check', ...base },
        }
      }
      const paid = Math.min(toCall, p.stack)
      return { ok: true, normalized: { type: 'call', seatId, paid, allIn: paid < toCall || p.stack === toCall } }
    }

    case 'all-in': {
      const to = maxTo
      if (to < h.currentBet) {
        // 短全下跟注（PFR-205）
        return { ok: true, normalized: { type: 'call', seatId, paid: p.stack, allIn: true } }
      }
      if (to === h.currentBet) {
        return { ok: true, normalized: { type: 'call', seatId, paid: p.stack, allIn: true } }
      }
      if (h.currentBet === 0) {
        return {
          ok: true,
          normalized: { type: 'bet', seatId, to, paid: p.stack, allIn: true, reopens: to >= state.blinds.bb },
        }
      }
      if (p.hasActed) {
        return {
          ok: false,
          rejection: {
            code: 'ACTION_TYPE_UNAVAILABLE',
            message: '不足额全下未重开行动权：只能跟平差额或弃牌（PFR-206）',
            ...base,
          },
        }
      }
      const increment = to - h.currentBet
      return {
        ok: true,
        normalized: {
          type: 'raise',
          seatId,
          to,
          paid: p.stack,
          increment,
          allIn: true,
          reopens: increment >= minIncrement(state),
        },
      }
    }

    case 'bet': {
      if (h.currentBet !== 0) {
        return {
          ok: false,
          rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: '当前已有下注，应使用 raise / all-in', ...base },
        }
      }
      if (action.amount > p.stack) {
        return {
          ok: false,
          rejection: {
            code: 'AMOUNT_ABOVE_MAX',
            message: `下注额 ${action.amount} 超过剩余筹码 ${p.stack}`,
            ...base,
            minTo: state.blinds.bb,
            maxTo: p.stack,
          },
        }
      }
      const isAllInBet = action.amount === p.stack
      if (action.amount < state.blinds.bb && !isAllInBet) {
        return {
          ok: false,
          rejection: {
            code: 'AMOUNT_BELOW_MIN',
            message: `下注额低于最小注 ${state.blinds.bb} 且非全下`,
            ...base,
            minTo: state.blinds.bb,
            maxTo: p.stack,
          },
        }
      }
      return {
        ok: true,
        normalized: {
          type: 'bet',
          seatId,
          to: action.amount,
          paid: action.amount,
          allIn: isAllInBet,
          reopens: action.amount >= state.blinds.bb,
        },
      }
    }

    case 'raise': {
      if (h.currentBet === 0) {
        return {
          ok: false,
          rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: '当前无下注，应使用 bet', ...base },
        }
      }
      if (p.hasActed) {
        return {
          ok: false,
          rejection: {
            code: 'ACTION_TYPE_UNAVAILABLE',
            message: '不足额全下未重开行动权：只能跟平差额或弃牌（PFR-206）',
            ...base,
          },
        }
      }
      if (maxTo <= h.currentBet) {
        return {
          ok: false,
          rejection: { code: 'ACTION_TYPE_UNAVAILABLE', message: '筹码不足以加注，只能跟注/弃牌', ...base },
        }
      }
      const minTo = h.currentBet + minIncrement(state)
      if (action.toAmount > maxTo) {
        return {
          ok: false,
          rejection: {
            code: 'AMOUNT_ABOVE_MAX',
            message: `加注至 ${action.toAmount} 超过全下额 ${maxTo}`,
            ...base,
            minTo,
            maxTo,
          },
        }
      }
      if (action.toAmount <= h.currentBet) {
        return {
          ok: false,
          rejection: { code: 'AMOUNT_BELOW_MIN', message: `加注额未超过当前注额 ${h.currentBet}`, ...base, minTo, maxTo },
        }
      }
      const isAllIn = action.toAmount === maxTo
      if (action.toAmount < minTo && !isAllIn) {
        return {
          ok: false,
          rejection: {
            code: 'BELOW_MIN_RAISE_NOT_ALL_IN',
            message: `低于最小加注额 ${minTo} 且非全下（PFR-206）`,
            ...base,
            minTo,
            maxTo,
          },
        }
      }
      return {
        ok: true,
        normalized: {
          type: 'raise',
          seatId,
          to: action.toAmount,
          paid: action.toAmount - p.streetBet,
          increment: action.toAmount - h.currentBet,
          allIn: isAllIn,
          reopens: action.toAmount >= minTo,
        },
      }
    }
  }
}

function actorOf(state: MatchState): PlayerState | null {
  const seatId = state.currentActor
  if (seatId === null) return null
  return state.players.find((p) => p.seatId === seatId) ?? null
}
