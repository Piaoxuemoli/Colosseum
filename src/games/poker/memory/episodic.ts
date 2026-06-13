import type { Card } from '../engine/card'

export type PokerEpisodicEntry = {
  handId: string
  observer: string
  target: string
  observedActions: string[]
  outcome: 'won' | 'lost' | 'folded' | 'showdown'
  targetShowdownHand: Card[] | null
  summary: string
  tags: string[]
  createdAt: string
}

export function synthesizeEpisodic(_input: {
  workingLog: Array<{ seq: number; kind: string; actorAgentId: string | null; payload: Record<string, unknown> }>
  finalState: unknown
  observerAgentId: string
  targetAgentId: string
  matchId: string
}): PokerEpisodicEntry | null {
  return null
}

export function formatEpisodicSection(entries: PokerEpisodicEntry[]): string {
  if (entries.length === 0) return '## Opponent episodes\n(none)'
  return `## Opponent episodes\n${entries.map((entry) => `- [${entry.handId} vs ${entry.target}] ${entry.summary}`).join('\n')}`
}
