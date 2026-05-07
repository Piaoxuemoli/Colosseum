// Memory domain types for the werewolf agent layer. Pure TypeScript.

import type {
  SeerResult,
  SpeechRecord,
  VoteRecord,
  WerewolfRole,
} from '../engine/types'

export interface BeliefEntry {
  werewolf: number
  villager: number
  seer: number
  witch: number
  /** Recent reasoning snippets (most-recent last, capped to 3). */
  reasoning: string[]
  lastUpdatedAt: { day: number; phase: string }
}

export interface DeathRecord {
  day: number
  agentId: string
  cause: 'werewolfKill' | 'witchPoison' | 'vote'
}

/**
 * Working memory — bound to a single match + observer agent. Accumulates
 * public facts + agent-private evidence and carries the externalised
 * beliefState that the response parser will update each turn.
 */
export interface WerewolfWorkingMemory {
  matchId: string
  observerAgentId: string
  ownRole: WerewolfRole | null
  ownPrivateEvidence: {
    seerChecks?: SeerResult[]
    werewolfTeammates?: string[]
    witchPotions?: { save: boolean; poison: boolean }
  }
  speechLog: SpeechRecord[]
  voteLog: VoteRecord[]
  deathLog: DeathRecord[]
  beliefState: Record<string, BeliefEntry>
}

/**
 * Post-match per-observer episodic entry. One row per match/observer pair
 * (target-independent here; the werewolf domain reasons about a whole
 * player set rather than a single target).
 */
export interface WerewolfEpisodicEntry {
  matchId: string
  observerAgentId: string
  actualRoles: Record<string, WerewolfRole>
  winnerFaction: 'werewolves' | 'villagers' | 'tie'
  ownOutcome: 'won' | 'lost' | 'tie'
  beliefAccuracy: Record<
    string,
    {
      finalBelief: { werewolf: number; villager: number; seer: number; witch: number }
      actualRole: WerewolfRole
      mostLikely: WerewolfRole
      correct: boolean
      confidenceCalibration: number
    }
  >
  keyMoments: string[]
  summary: string
  tags: string[]
}

export interface WerewolfSemanticProfile {
  observerAgentId: string
  targetAgentId: string
  actingSkill: number       // 1-10
  reasoningDepth: number    // 1-10
  consistency: number       // 1-10
  /** Role-conditioned style snapshots, populated only when observer has seen the target in that role. */
  asWerewolfStyle: { bluffTendency: number; patience: number; targetingPattern: string } | null
  asSeerStyle: { jumpTiming: 'early' | 'mid' | 'late' | 'varies'; informationReveal: number } | null
  asWitchStyle: { saveTendency: number; poisonTiming: 'early' | 'mid' | 'late' | 'varies' } | null
  asVillagerStyle: { suspicionBias: number; followVoting: number } | null
  /** Free-form short note, ≤30 chars per spec §6.4. */
  note: string
  gamesObserved: number
  /** Per-role win/loss tally: [wins, losses]. */
  winLossRecord: {
    asWerewolf: [number, number]
    asSeer: [number, number]
    asVillager: [number, number]
    asWitch: [number, number]
  }
}
