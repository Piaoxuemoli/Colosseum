/**
 * Poker Agent 适配层 — 将现有 poker agent 函数包装为 Protocol 接口。
 * 在 Gateway 中使用。
 */

import type {
  ContextBuilder,
  ResponseParser,
  ParseResult,
  BotStrategy,
  AvailableActionInfo,
  AgentPersonality,
  GameEvent,
} from '../../../core/protocols'
import type { GameState } from '../../../types/game'
import type { PlayerAction, ActionType } from '../../../types/action'
import type { StructuredImpression } from '../../../types/player'
import {
  buildSystemMessage,
  buildDecisionRequest,
  buildHandSummary,
} from './poker-context'
import {
  parseThinkingAndAction,
  validateAction as validateParsedAction,
  buildRetryPrompt,
  parseStructuredImpressions,
} from './poker-parser'
import { BotAI } from './poker-bot'

/** 将 Protocol impressions Record<string, Record<string, number>> 转为 Map<string, StructuredImpression> */
function impressionsToMap(
  impressions: Record<string, Record<string, number>>,
): Map<string, StructuredImpression> {
  const map = new Map<string, StructuredImpression>()
  for (const [targetId, dims] of Object.entries(impressions)) {
    map.set(targetId, {
      looseness: dims.looseness ?? 5,
      aggression: dims.aggression ?? 5,
      stickiness: dims.stickiness ?? 5,
      honesty: dims.honesty ?? 5,
      note: '',
      handCount: 0,
    })
  }
  return map
}

/**
 * 德扑上下文拼装器 — 适配 ContextBuilder<GameState, PlayerAction>。
 */
export class PokerContextBuilder implements ContextBuilder<GameState, PlayerAction> {
  buildSystemPrompt(
    personality: AgentPersonality,
    impressions: Record<string, Record<string, number>>,
  ): string {
    // 构造 mock player 和 state 用于调用原 buildSystemMessage
    const player = {
      id: 'current',
      name: personality.name,
      type: 'llm' as const,
      chips: 0,
      status: 'active' as const,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      seatIndex: 0,
      hasActed: false,
      systemPrompt: personality.systemPrompt,
      impressions: impressionsToMap(impressions),
    }
    // 空的 GameState 壳 — buildSystemMessage 只用少量字段
    const state = { players: [], phase: 'preflop' } as unknown as GameState
    const others = Object.keys(impressions).map(id => ({
      id,
      name: id,
      type: 'llm' as const,
      chips: 0,
      status: 'active' as const,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      seatIndex: 0,
      hasActed: false,
    }))
    return buildSystemMessage(player, state, impressionsToMap(impressions), others)
  }

  buildUserPrompt(
    state: GameState,
    playerId: string,
    actions: AvailableActionInfo[],
  ): string {
    const player = state.players.find(p => p.id === playerId)
    if (!player) return ''
    const pokerActions = actions.map(a => ({
      type: a.type as ActionType,
      minAmount: a.constraints?.amount?.min,
      maxAmount: a.constraints?.amount?.max,
    }))
    return buildDecisionRequest(player, state, pokerActions)
  }

  buildImpressionPrompt(
    _state: GameState,
    _events: GameEvent[],
    _currentImpressions: Record<string, Record<string, number>>,
  ): string {
    // Delegated to requestImpressionUpdate in poker-impressions
    return ''
  }

  buildRetryPrompt(error: string, _availableActions: string[]): string {
    return buildRetryPrompt(error)
  }

  buildHandSummary(state: GameState): string {
    return buildHandSummary(state)
  }
}

/**
 * 德扑响应解析器 — 适配 ResponseParser<PlayerAction>。
 */
export class PokerResponseParser implements ResponseParser<PlayerAction> {
  parseAction(raw: string, availableTypes: string[]): ParseResult<PlayerAction> {
    const result = parseThinkingAndAction(raw)
    if (!result || !result.action) {
      return { ok: false, error: 'Failed to parse action from LLM response' }
    }
    const pokerActions = availableTypes.map(t => ({
      type: t as ActionType,
    }))
    const validated = validateParsedAction(result.action, pokerActions)
    if (!validated) {
      return { ok: false, error: `Action "${result.action.type}" not valid. Available: ${availableTypes.join(', ')}` }
    }
    return {
      ok: true,
      action: {
        playerId: '',  // filled by Gateway
        type: validated.type,
        amount: validated.amount || 0,
        timestamp: Date.now(),
      },
    }
  }

  parseImpressions(
    raw: string,
    dimensionKeys: string[],
  ): Record<string, Record<string, number>> | null {
    // Use dimension keys as player names for parsing
    const result = parseStructuredImpressions(raw, dimensionKeys)
    if (!result) return null
    // Convert to generic format
    const generic: Record<string, Record<string, number>> = {}
    for (const [name, scores] of Object.entries(result)) {
      generic[name] = {
        looseness: scores.looseness,
        aggression: scores.aggression,
        stickiness: scores.stickiness,
        honesty: scores.honesty,
      }
    }
    return generic
  }
}

/**
 * 德扑 Bot 策略 — 适配 BotStrategy<GameState, PlayerAction>。
 */
export class PokerBotStrategy implements BotStrategy<GameState, PlayerAction> {
  private botAI = new BotAI()

  chooseAction(state: GameState, playerId: string): PlayerAction {
    const player = state.players.find(p => p.id === playerId)
    if (!player) {
      return { playerId, type: 'fold', amount: 0, timestamp: Date.now() }
    }
    const decision = this.botAI.decide(player, state)
    return {
      playerId,
      type: decision.type,
      amount: decision.amount,
      timestamp: Date.now(),
    }
  }
}
