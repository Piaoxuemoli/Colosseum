import type { Card } from '../engine/card'
import type { PokerActionRecord, PokerState } from '../engine/poker-types'

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

export function synthesizeEpisodic(input: {
  workingLog: Array<{ seq: number; kind: string; actorAgentId: string | null; payload: Record<string, unknown> }>
  finalState: unknown
  observerAgentId: string
  targetAgentId: string
  matchId: string
}): PokerEpisodicEntry | null {
  const state = input.finalState as Partial<PokerState>
  const actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : []
  const targetActions = actionHistory.filter((record): record is PokerActionRecord => record.agentId === input.targetAgentId)
  if (targetActions.length === 0) return null

  const target = Array.isArray(state.players)
    ? state.players.find((player) => player.id === input.targetAgentId)
    : undefined
  const handNumber = typeof state.handNumber === 'number' ? state.handNumber : 0
  const startingChips = typeof state.startingChips === 'number' ? state.startingChips : target?.chips ?? 0
  const actionLabels = targetActions.map((record) => {
    const action = record.action
    const amount = 'amount' in action ? action.amount : 'toAmount' in action ? action.toAmount : undefined
    return `${record.phase}:${action.type}${typeof amount === 'number' ? ` ${amount}` : ''}`
  })
  const actionTypes = targetActions.map((record) => record.action.type)
  const aggressiveCount = actionTypes.filter((type) => type === 'bet' || type === 'raise' || type === 'allIn').length
  const passiveCount = actionTypes.filter((type) => type === 'check' || type === 'call').length
  const folded = target?.status === 'folded' || actionTypes.includes('fold')
  const showdown = state.phase === 'showdown' || (!folded && state.handComplete === true)
  const won = typeof target?.chips === 'number' && target.chips > startingChips

  const tags = [
    aggressiveCount > 0 ? 'aggressive' : null,
    passiveCount > 0 ? 'sticky' : null,
    folded ? 'folded' : null,
    showdown ? 'showdown' : null,
    won ? 'won' : null,
  ].filter((tag): tag is string => Boolean(tag))

  const outcome: PokerEpisodicEntry['outcome'] = won ? 'won' : folded ? 'folded' : showdown ? 'showdown' : 'lost'
  const summary = `${actionLabels.join(', ')}；${outcome === 'won' ? '本手盈利' : outcome === 'folded' ? '中途弃牌' : outcome === 'showdown' ? '摊牌坚持到最后' : '本手未盈利'}`

  return {
    handId: `${input.matchId}:hand:${handNumber}`,
    observer: input.observerAgentId,
    target: input.targetAgentId,
    observedActions: actionLabels,
    outcome,
    targetShowdownHand: showdown && target?.holeCards ? target.holeCards : null,
    summary,
    tags,
    createdAt: new Date().toISOString(),
  }
}

export function formatEpisodicSection(entries: PokerEpisodicEntry[]): string {
  if (entries.length === 0) return '## Opponent episodes\n(none)'
  return `## Opponent episodes\n${entries.map((entry) => `- [${entry.handId} vs ${entry.target}] ${entry.summary}`).join('\n')}`
}
