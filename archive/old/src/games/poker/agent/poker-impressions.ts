/**
 * Impression Manager - Handles structured LLM impression updates after each hand
 * Uses 4-dimension scoring (L/A/S/H) with EMA smoothing
 */

import type { Player, StructuredImpression } from '../../../types/player'
import type { APIProfile } from '../../../agent/llm-client'
import { callLLM } from '../../../agent/llm-client'
import type { ChatMessage } from '../../../agent/llm-client'
import { buildSystemMessage, buildImpressionRequest, buildHandSummary } from './poker-context'
import { parseStructuredImpressions } from './poker-parser'
import { applyEMA } from './poker-ema'
import type { GameState } from '../../../types/game'

/**
 * Request structured impression updates for an LLM player after a hand ends.
 * Returns id-keyed map of updated StructuredImpressions (after EMA), or null on failure.
 */
export async function requestImpressionUpdate(
  profile: APIProfile,
  player: Player,
  gameState: GameState,
  currentImpressions: Map<string, StructuredImpression> | undefined,
  timeoutMs: number = 15000,
): Promise<Record<string, StructuredImpression> | null> {
  try {
    const otherPlayers = gameState.players.filter(
      p => p.id !== player.id && p.status !== 'sittingOut'
    )

    if (otherPlayers.length === 0) return null

    const systemMsg = buildSystemMessage(player, gameState, currentImpressions, otherPlayers)
    const handSummary = buildHandSummary(gameState)
    const userMsg = buildImpressionRequest(player, handSummary, currentImpressions, otherPlayers)

    const messages: ChatMessage[] = [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg },
    ]

    const response = await callLLM(profile, messages, timeoutMs)

    const playerNames = otherPlayers.map(p => p.name)
    const parsed = parseStructuredImpressions(response, playerNames)

    if (!parsed) return null

    // Convert name-keyed raw scores to id-keyed StructuredImpressions with EMA
    const result: Record<string, StructuredImpression> = {}
    for (const other of otherPlayers) {
      if (parsed[other.name]) {
        const raw = parsed[other.name]
        const current = currentImpressions?.get(other.id)
        result[other.id] = applyEMA(current, raw)
      }
    }

    return Object.keys(result).length > 0 ? result : null
  } catch (err) {
    // Silent failure — keep old impressions
    console.warn(`Impression update failed for ${player.name}:`, err)
    return null
  }
}

/**
 * Apply structured impression updates to a player's impression map.
 */
export function applyImpressions(
  player: Player,
  updates: Record<string, StructuredImpression>,
): void {
  if (!player.impressions) {
    player.impressions = new Map()
  }
  for (const [playerId, impression] of Object.entries(updates)) {
    player.impressions.set(playerId, impression)
  }
}
