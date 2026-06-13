/**
 * Player Adapter - Unified decision interface for Human/Bot/LLM players
 */

import type { Player } from '../types/player'
import type { GameState } from '../types/game'
import type { ActionType } from '../types/action'
import type { AvailableAction } from '../games/poker/engine/poker-engine'
import type { APIProfile, ChatMessage } from './llm-client'
import { callLLM, callLLMStreaming } from './llm-client'
import { buildSystemMessage, buildDecisionRequest } from '../games/poker/agent/poker-context'
import { parseThinkingAndAction, validateAction, buildRetryPrompt } from '../games/poker/agent/poker-parser'
import type { BotAI } from '../games/poker/agent/poker-bot'

export interface DecisionResult {
  type: ActionType
  amount: number
  /** LLM thinking content (CoT) */
  thinking?: string
  /** Error message if decision failed */
  error?: string
}

/**
 * Interface for all player adapters.
 */
export interface PlayerAdapter {
  decide(
    player: Player,
    gameState: GameState,
    validActions: AvailableAction[],
  ): Promise<DecisionResult>
}

/**
 * Bot adapter - wraps BotAI.decide() synchronously.
 */
export class BotAdapter implements PlayerAdapter {
  private botAI: BotAI

  constructor(botAI: BotAI) {
    this.botAI = botAI
  }

  async decide(
    player: Player,
    gameState: GameState,
    _validActions: AvailableAction[],
  ): Promise<DecisionResult> {
    const decision = this.botAI.decide(player, gameState)
    return { type: decision.type, amount: decision.amount }
  }
}

/**
 * LLM adapter - calls LLM API via prompt-builder + response-parser.
 * Uses a single global AbortController per decide() call to enforce total timeout.
 * timeoutMs === 0 means unlimited (no timeout).
 */
export class LLMAdapter implements PlayerAdapter {
  private getProfile: (profileId: string) => APIProfile | undefined
  private timeoutMs: number
  private onThinkingUpdate?: (playerId: string, content: string) => void

  constructor(
    getProfile: (profileId: string) => APIProfile | undefined,
    timeoutMs: number = 30000,
    onThinkingUpdate?: (playerId: string, content: string) => void,
  ) {
    this.getProfile = getProfile
    this.timeoutMs = timeoutMs
    this.onThinkingUpdate = onThinkingUpdate
  }

  async decide(
    player: Player,
    gameState: GameState,
    validActions: AvailableAction[],
  ): Promise<DecisionResult> {
    const profileId = player.profileId
    if (!profileId) {
      console.warn(`LLM player ${player.name} has no profileId, folding`)
      return { type: 'fold', amount: 0 }
    }

    const profile = this.getProfile(profileId)
    if (!profile) {
      console.warn(`API profile ${profileId} not found for ${player.name}, folding`)
      return { type: 'fold', amount: 0 }
    }

    const otherPlayers = gameState.players.filter(
      p => p.id !== player.id && p.status !== 'sittingOut' && p.status !== 'eliminated'
    )

    const systemMsg = buildSystemMessage(player, gameState, player.impressions, otherPlayers)
    const userMsg = buildDecisionRequest(player, gameState, validActions)

    const messages: ChatMessage[] = [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg },
    ]

    // Track last known thinking for timeout recovery
    let lastThinking: string | undefined

    // Global AbortController for total timeout (0 = unlimited)
    const globalController = new AbortController()
    let globalTimeoutId: ReturnType<typeof setTimeout> | null = null
    if (this.timeoutMs > 0) {
      globalTimeoutId = setTimeout(() => globalController.abort('LLM total timeout'), this.timeoutMs)
    }

    try {
      // Extract thinking content from partial text for streaming updates
      const extractThinking = (text: string): string | null => {
        const match = text.match(/<thinking>([\s\S]*?)(?:<\/thinking>|$)/)
        return match ? match[1].trim() : null
      }

      // Streaming onChunk callback
      const onChunk = (_delta: string, fullText: string) => {
        if (this.onThinkingUpdate) {
          const thinking = extractThinking(fullText)
          if (thinking) {
            lastThinking = thinking
            this.onThinkingUpdate(player.id, thinking)
          }
        }
      }

      // First attempt — use streaming with the global signal
      const response = await callLLMStreaming(profile, messages, onChunk, this.timeoutMs, globalController.signal)
      const parsed = parseThinkingAndAction(response)

      if (parsed) {
        const validated = validateAction(parsed.action, validActions)
        if (validated) {
          return {
            type: validated.type,
            amount: validated.amount,
            thinking: parsed.thinking,
          }
        }
      }

      // Retry once with error prompt (also under global timeout)
      const retryMsg = buildRetryPrompt('无法解析你的操作决策。')
      messages.push({ role: 'assistant', content: response })
      messages.push({ role: 'user', content: retryMsg })

      const retryResponse = await callLLM(profile, messages, this.timeoutMs, globalController.signal)
      const retryParsed = parseThinkingAndAction(retryResponse)

      if (retryParsed) {
        const retryValidated = validateAction(retryParsed.action, validActions)
        if (retryValidated) {
          return {
            type: retryValidated.type,
            amount: retryValidated.amount,
            thinking: retryParsed.thinking,
          }
        }
      }

      // Fallback to fold
      console.warn(`LLM ${player.name} failed to produce valid action after retry, folding`)
      return { type: 'fold', amount: 0, thinking: parsed?.thinking }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn(`LLM ${player.name} call failed:`, err)
      return { type: 'fold', amount: 0, thinking: lastThinking, error: errMsg }
    } finally {
      if (globalTimeoutId) clearTimeout(globalTimeoutId)
    }
  }
}

/**
 * Human adapter - returns a Promise that is resolved when the UI submits an action.
 */
export class HumanAdapter implements PlayerAdapter {
  private resolver: ((result: DecisionResult) => void) | null = null

  async decide(
    _player: Player,
    _gameState: GameState,
    _validActions: AvailableAction[],
  ): Promise<DecisionResult> {
    return new Promise<DecisionResult>((resolve) => {
      this.resolver = resolve
    })
  }

  /**
   * Called by the UI when the human player submits an action.
   */
  resolveAction(type: ActionType, amount: number = 0): void {
    if (this.resolver) {
      this.resolver({ type, amount })
      this.resolver = null
    }
  }

  /**
   * Check if we're currently waiting for human input.
   */
  isWaiting(): boolean {
    return this.resolver !== null
  }
}
