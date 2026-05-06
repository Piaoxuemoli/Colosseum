export interface StructuredImpression {
  looseness: number
  aggression: number
  stickiness: number
  honesty: number
  note: string
  handCount: number
}

export interface RawImpressionScores {
  looseness: number
  aggression: number
  stickiness: number
  honesty: number
  note: string
}

export function applyEMA(
  current: StructuredImpression | undefined,
  raw: RawImpressionScores,
  alpha = 0.3,
): StructuredImpression {
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

  return {
    looseness: roundScore(alpha * clampScore(raw.looseness) + (1 - alpha) * current.looseness),
    aggression: roundScore(alpha * clampScore(raw.aggression) + (1 - alpha) * current.aggression),
    stickiness: roundScore(alpha * clampScore(raw.stickiness) + (1 - alpha) * current.stickiness),
    honesty: roundScore(alpha * clampScore(raw.honesty) + (1 - alpha) * current.honesty),
    note: raw.note.slice(0, 30),
    handCount: current.handCount + 1,
  }
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)))
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10
}
