/**
 * Poker-specific EMA utilities for structured impression scoring (L/A/S/H).
 * Moved from engine/llm/ema.ts
 */

import type { StructuredImpression } from '../../../types/player'

/** LLM 原始评分（每手结束后 LLM 返回的 raw scores） */
export interface RawImpressionScores {
  looseness: number
  aggression: number
  stickiness: number
  honesty: number
  note: string
}

/**
 * Apply Exponential Moving Average (EMA) to merge raw scores into existing impression.
 *
 * - Cold start (handCount === 0): directly use raw scores
 * - Otherwise: new = α × raw + (1 - α) × old
 * - note always takes the latest value
 *
 * @param current - Existing impression (undefined for first observation)
 * @param raw - New raw scores from LLM
 * @param alpha - EMA smoothing factor (default 0.3)
 */
export function applyEMA(
  current: StructuredImpression | undefined,
  raw: RawImpressionScores,
  alpha: number = 0.3,
): StructuredImpression {
  // Cold start: no prior data, use raw directly
  if (!current || current.handCount === 0) {
    return {
      looseness: clampScore(raw.looseness),
      aggression: clampScore(raw.aggression),
      stickiness: clampScore(raw.stickiness),
      honesty: clampScore(raw.honesty),
      note: raw.note.slice(0, 30),
      handCount: 1,
    }
  }

  // EMA: new = α × raw + (1 - α) × old
  return {
    looseness: roundScore(alpha * clampScore(raw.looseness) + (1 - alpha) * current.looseness),
    aggression: roundScore(alpha * clampScore(raw.aggression) + (1 - alpha) * current.aggression),
    stickiness: roundScore(alpha * clampScore(raw.stickiness) + (1 - alpha) * current.stickiness),
    honesty: roundScore(alpha * clampScore(raw.honesty) + (1 - alpha) * current.honesty),
    note: raw.note.slice(0, 30),
    handCount: current.handCount + 1,
  }
}

/** Clamp score to [1, 10] */
function clampScore(v: number): number {
  return Math.max(1, Math.min(10, Math.round(v)))
}

/** Round to 1 decimal place */
function roundScore(v: number): number {
  return Math.round(v * 10) / 10
}
