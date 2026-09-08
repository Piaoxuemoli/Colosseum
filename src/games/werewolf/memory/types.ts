// Memory domain types for the werewolf agent layer. Pure TypeScript.
//
// 下方的 v1 引擎遗留类型（WerewolfRole / SpeechRecord / VoteRecord / SeerResult /
// WerewolfState 等）随 v1 引擎删除后在此本地保留：本 memory 栈按 v1 状态形状
// 记账（v2 运行时当前不消费狼人杀 memory；接入时由插件层做形状适配）。

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
  speechQueue: string[]
  werewolfDiscussionQueue: string[]
  currentActor: string | null
  witchPotions: { save: boolean; poison: boolean }
  lastNightKilled: string | null
  lastNightSaved: string | null
  lastNightPoisoned: string | null
  seerCheckResults: SeerResult[]
  speechLog: SpeechRecord[]
  voteLog: VoteRecord[]
  matchComplete: boolean
  winner: WerewolfFaction | 'tie' | null
}

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
