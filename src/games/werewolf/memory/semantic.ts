import type {
  WerewolfEpisodicEntry,
  WerewolfSemanticProfile,
} from './types'
import type { WerewolfRole } from '../engine/types'

/**
 * Per-observer long-term profile of other agents. Updates only the target
 * tracked by a given episodic entry. Uses a simple running-average
 * recalibration — good enough for MVP; Phase 5 can swap in EMA.
 */

export function defaultSemanticProfile(
  observerAgentId: string,
  targetAgentId: string,
): WerewolfSemanticProfile {
  return {
    observerAgentId,
    targetAgentId,
    actingSkill: 5,
    reasoningDepth: 5,
    consistency: 5,
    asWerewolfStyle: null,
    asSeerStyle: null,
    asWitchStyle: null,
    asVillagerStyle: null,
    note: '',
    gamesObserved: 0,
    winLossRecord: {
      asWerewolf: [0, 0],
      asSeer: [0, 0],
      asVillager: [0, 0],
      asWitch: [0, 0],
    },
  }
}

/**
 * Merge a new post-match episodic into the observer's semantic profile of a
 * single target agent. Cumulative calibration feedback nudges
 * reasoningDepth / consistency; role-conditioned win-loss counts update the
 * per-role tally.
 */
export function updateSemantic(
  prior: WerewolfSemanticProfile | null,
  episodic: WerewolfEpisodicEntry,
  targetAgentId: string,
): WerewolfSemanticProfile {
  const base = prior ?? defaultSemanticProfile(episodic.observerAgentId, targetAgentId)
  const actualRole = episodic.actualRoles[targetAgentId]
  if (!actualRole) {
    // target not in this match — count games observed but no other updates
    return { ...base, gamesObserved: base.gamesObserved + 1 }
  }

  // win-loss tally for this actual role
  const wl = { ...base.winLossRecord }
  const roleKey = roleToKey(actualRole)
  const prev = wl[roleKey]
  const targetWon = winnerMatchesRole(actualRole, episodic.winnerFaction)
  wl[roleKey] = targetWon ? [prev[0] + 1, prev[1]] : [prev[0], prev[1] + 1]

  return {
    ...base,
    winLossRecord: wl,
    gamesObserved: base.gamesObserved + 1,
    note: (episodic.summary.slice(0, 28) || base.note).slice(0, 30),
  }
}

export function formatSemanticSection(
  semanticByTarget: Map<string, WerewolfSemanticProfile>,
): string {
  if (semanticByTarget.size === 0) return ''
  const lines: string[] = []
  for (const [targetId, p] of semanticByTarget.entries()) {
    lines.push(
      `- ${targetId}: 演技${p.actingSkill}/10 推理${p.reasoningDepth}/10 obs=${p.gamesObserved} note:${p.note}`,
    )
  }
  return lines.join('\n')
}

function roleToKey(role: WerewolfRole): keyof WerewolfSemanticProfile['winLossRecord'] {
  switch (role) {
    case 'werewolf':
      return 'asWerewolf'
    case 'seer':
      return 'asSeer'
    case 'witch':
      return 'asWitch'
    default:
      return 'asVillager'
  }
}

function winnerMatchesRole(
  role: WerewolfRole,
  winnerFaction: 'werewolves' | 'villagers' | 'tie',
): boolean {
  if (winnerFaction === 'tie') return false
  const roleFaction = role === 'werewolf' ? 'werewolves' : 'villagers'
  return roleFaction === winnerFaction
}
