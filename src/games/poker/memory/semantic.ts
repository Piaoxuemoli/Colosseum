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
  if (base.lastUpdatedHandId === episodic.handId) return base

  const raw: RawImpressionScores = {
    looseness: episodic.tags.includes('showdown') || episodic.tags.includes('sticky') ? 7 : episodic.tags.includes('folded') ? 3 : 5,
    aggression: episodic.tags.includes('aggressive') ? 8 : 4,
    stickiness: episodic.tags.includes('sticky') || episodic.tags.includes('showdown') ? 7 : episodic.tags.includes('folded') ? 3 : 5,
    honesty: episodic.tags.includes('showdown') ? 6 : 5,
    note: episodic.summary,
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
