import type {
  WerewolfEpisodicEntry,
  WerewolfWorkingMemory,
} from './types'
import type { WerewolfRole, WerewolfState } from '../engine/types'

/**
 * Post-match episodic synthesis. One entry per (match, observer).
 *
 * Captures:
 *   - actual role assignments (now public)
 *   - key deaths and a short 150-char natural-language summary
 *   - the match outcome from the observer's perspective
 */
export function synthesizeEpisodic(input: {
  working: WerewolfWorkingMemory
  finalState: WerewolfState
  observerAgentId: string
  matchId: string
}): WerewolfEpisodicEntry {
  const { working, finalState, observerAgentId, matchId } = input
  const actualRoles = finalState.roleAssignments
  const ownRole = actualRoles[observerAgentId]
  const winner = finalState.winner ?? 'tie'
  const ownOutcome = determineOutcome(ownRole, winner)

  const keyMoments = working.deathLog
    .slice(-5)
    .map((d) => `Day${d.day} ${d.agentId} ${d.cause}`)

  const summary = buildSummary(ownRole, winner, finalState)

  return {
    matchId,
    observerAgentId,
    actualRoles,
    winnerFaction: winner,
    ownOutcome,
    keyMoments,
    summary,
    tags: tagsFor(ownOutcome, ownRole),
  }
}

export function formatEpisodicSection(entries: WerewolfEpisodicEntry[]): string {
  if (entries.length === 0) return ''
  return entries
    .slice(-5)
    .map((e) => `- [${e.winnerFaction} 胜｜我 ${e.ownOutcome}] ${e.summary}`)
    .join('\n')
}

function determineOutcome(
  ownRole: WerewolfRole | undefined,
  winner: 'werewolves' | 'villagers' | 'tie',
): 'won' | 'lost' | 'tie' {
  if (winner === 'tie') return 'tie'
  if (!ownRole) return 'lost'
  const ownFaction = ownRole === 'werewolf' ? 'werewolves' : 'villagers'
  return ownFaction === winner ? 'won' : 'lost'
}

function buildSummary(
  ownRole: WerewolfRole | undefined,
  winner: 'werewolves' | 'villagers' | 'tie',
  state: WerewolfState,
): string {
  const roleText = ownRole ?? '未知'
  const days = state.day
  const aliveCount = state.players.filter((p) => p.alive).length
  const s = `身份 ${roleText}，持续 ${days} 天，终局活 ${aliveCount} 人，${winner} 胜。`
  return s.slice(0, 150)
}

function tagsFor(outcome: 'won' | 'lost' | 'tie', role: WerewolfRole | undefined): string[] {
  const tags: string[] = [outcome]
  if (role) tags.push(`role:${role}`)
  return tags
}
