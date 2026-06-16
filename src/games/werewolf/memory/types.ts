// Memory domain types for the werewolf agent layer. Pure TypeScript.

import type {
  SeerResult,
  SpeechRecord,
  VoteRecord,
  WerewolfRole,
} from '../engine/types'

export interface DeathRecord {
  day: number
  agentId: string
  cause: 'werewolfKill' | 'witchPoison' | 'vote'
}

/**
 * Working memory — bound to a single match + observer agent. Accumulates
 * public facts + agent-private evidence.
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
