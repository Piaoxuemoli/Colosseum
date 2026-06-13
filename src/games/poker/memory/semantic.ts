import { applyEMA, type RawImpressionScores, type StructuredImpression } from './ema'
import type { PokerEpisodicEntry } from './episodic'

export type PokerSemanticProfile = StructuredImpression & {
  lastUpdatedHandId: string | null
}

export function initSemantic(): PokerSemanticProfile {
  return {
    looseness: 5,
    aggression: 5,
    stickiness: 5,
    honesty: 5,
    note: '',
    handCount: 0,
    lastUpdatedHandId: null,
  }
}

export function updateSemantic(
  current: PokerSemanticProfile | null,
  episodic: PokerEpisodicEntry | null,
): PokerSemanticProfile {
  const base = current ?? initSemantic()
  if (!episodic) return { ...base, handCount: base.handCount + 1 }

  const raw: RawImpressionScores = {
    looseness: base.looseness,
    aggression: base.aggression,
    stickiness: base.stickiness,
    honesty: base.honesty,
    note: base.note,
  }
  const next = applyEMA(base, raw)
  return { ...next, lastUpdatedHandId: episodic.handId }
}

export function formatSemanticSection(profiles: Map<string, PokerSemanticProfile>): string {
  if (profiles.size === 0) return '## Opponent profiles\n(none)'

  const lines = ['## Opponent profiles']
  for (const [targetId, profile] of profiles) {
    lines.push(
      `- ${targetId}: L=${profile.looseness.toFixed(1)} A=${profile.aggression.toFixed(1)} S=${profile.stickiness.toFixed(1)} H=${profile.honesty.toFixed(1)} (${profile.handCount} observed hands)`,
    )
  }
  return lines.join('\n')
}
