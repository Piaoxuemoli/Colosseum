// Werewolf core types. Pure TypeScript, zero React / Next.js / DB imports.

export type WerewolfRole = 'werewolf' | 'seer' | 'witch' | 'villager'
export type WerewolfFaction = 'werewolves' | 'villagers'

export type WerewolfPhase =
  | 'night/werewolfDiscussion'
  | 'night/werewolfKill'
  | 'night/seerCheck'
  | 'night/witchAction'
  | 'day/announce'
  | 'day/speak'
  | 'day/vote'
  | 'day/execute'

export type WerewolfDeathCause = 'werewolfKill' | 'witchPoison' | 'vote'

export interface WerewolfPlayerState {
  agentId: string
  name: string
  alive: boolean
  seatOrder: number
  deathDay: number | null
  deathCause: WerewolfDeathCause | null
}

export type WerewolfAction =
  | { type: 'night/werewolfKill'; targetId: string; reasoning: string }
  | { type: 'night/seerCheck'; targetId: string }
  | { type: 'night/witchSave' }
  | { type: 'night/witchPoison'; targetId: string | null }
  | { type: 'day/speak'; content: string; claimedRole?: WerewolfRole }
  | { type: 'day/vote'; targetId: string | null; reason?: string }

export interface SpeechRecord {
  day: number
  agentId: string
  content: string
  claimedRole?: WerewolfRole
  at: number
}

export interface VoteRecord {
  day: number
  voter: string
  target: string | null
  reason?: string
  at: number
}

export interface SeerResult {
  day: number
  targetId: string
  role: WerewolfRole
}

export interface WerewolfState {
  day: number
  phase: WerewolfPhase
  players: WerewolfPlayerState[]
  roleAssignments: Record<string, WerewolfRole>
  moderatorAgentId: string | null
  /**
   * Agents queued to speak in the current `day/speak` phase (front is next).
   * When empty we advance to `day/vote`.
   */
  speechQueue: string[]
  /**
   * Agents queued to discuss in the current `night/werewolfDiscussion` phase
   * (wolves only). When empty we advance to `night/werewolfKill`.
   */
  werewolfDiscussionQueue: string[]
  currentActor: string | null
  witchPotions: { save: boolean; poison: boolean }
  /** Agent id targeted by werewolves on the current night, resolved at end of night. */
  lastNightKilled: string | null
  /** Agent id saved by the witch on the current night (if any). */
  lastNightSaved: string | null
  /** Agent id poisoned by the witch on the current night (if any). */
  lastNightPoisoned: string | null
  seerCheckResults: SeerResult[]
  speechLog: SpeechRecord[]
  voteLog: VoteRecord[]
  matchComplete: boolean
  winner: WerewolfFaction | 'tie' | null
}

export interface WerewolfEngineConfig {
  /** Optional deterministic seed (0-1 generator) for role assignment. Defaults to Math.random. */
  seed?: number
  /** Agents in seat order. Must be exactly 6 player agents for MVP. */
  agentNames?: Record<string, string>
  /** Moderator agent id (non-player). Optional — Phase 3-3 wires this in. */
  moderatorAgentId?: string | null
}
