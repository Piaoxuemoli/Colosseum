// Werewolf engine v2 — pure logic types & zod schemas.
//
// Requirement source: docs/prd/games/werewolf-engine.md (WFR-*) — this module
// is the type-level backbone of the config-driven engine: board params
// (WFR-101), audience-marked events (WFR-201/502), the action space (WFR-301),
// structured rejections (WFR-302) and the immutable state shape (NFR-W2).
//
// Pure TypeScript + zod only. No React / store / route / DB / Redis / LLM.

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Roles (WFR-103)
// ---------------------------------------------------------------------------

export const roleIdSchema = z.enum([
  // v1-M1
  'villager',
  'werewolf',
  'seer',
  'witch',
  'hunter',
  // v1-M2 (config slots registered; boards cannot enable them in M1)
  'guard',
  'idiot',
  // v2 (pre-registered capability slots only)
  'elder',
  'dreamWeaver',
  'cupid',
  'thief',
  'knight',
  'wolfKing',
  'whiteWolfKing',
])
export type RoleId = z.infer<typeof roleIdSchema>

/** Roles a v1-M1 board may actually enable. */
export const M1_ROLES: readonly RoleId[] = ['villager', 'werewolf', 'seer', 'witch', 'hunter']
/** Roles reserved for v1-M2 (guard / idiot + sheriff flow, WOD-2). */
export const M2_ROLES: readonly RoleId[] = ['guard', 'idiot']
/** Roles pre-registered for v2 (WFR-103 v2 list). */
export const V2_ROLES: readonly RoleId[] = [
  'elder',
  'dreamWeaver',
  'cupid',
  'thief',
  'knight',
  'wolfKing',
  'whiteWolfKing',
]

export const factionSchema = z.enum(['wolves', 'good'])
export type Faction = z.infer<typeof factionSchema>

/** 屠边 edges: gods vs villagers (plus the wolf side). */
export type Camp = 'wolf' | 'god' | 'villager'

// ---------------------------------------------------------------------------
// Board configuration (WFR-101 — the 26-row parameter table)
// ---------------------------------------------------------------------------

export const winConditionSchema = z.enum(['kill-side', 'kill-all', 'kill-all-parity'])
export type WinCondition = z.infer<typeof winConditionSchema>

export const witchSelfSavePolicySchema = z.enum(['never', 'first-night-only', 'always'])
export type WitchSelfSavePolicy = z.infer<typeof witchSelfSavePolicySchema>

export const voteRuleSchema = z.enum(['plurality', 'majority'])
export type VoteRule = z.infer<typeof voteRuleSchema>

export const voteTiePolicySchema = z.enum(['pk-revote-then-nobody', 'nobody-immediately'])
export type VoteTiePolicy = z.infer<typeof voteTiePolicySchema>

export const lastWordsPolicySchema = z.enum(['first-night-and-day', 'day-only', 'all', 'none'])
export type LastWordsPolicy = z.infer<typeof lastWordsPolicySchema>

export const speechOrderPolicySchema = z.enum(['seat', 'from-dead-next', 'sheriff-decides'])
export type SpeechOrderPolicy = z.infer<typeof speechOrderPolicySchema>

export const guardReGuardRuleSchema = z.enum(['no-repeat-target', 'off'])
export const guardSaveConflictSchema = z.enum(['milk-pierce', 'both-save'])
export const idiotFlipPolicySchema = z.enum(['survive-lose-vote', 'off'])
export const roleModeSchema = z.enum(['hidden', 'open'])

/** Roles with a night action phase (WFR-102 / param 15). */
export const nightRoleIdSchema = z.enum(['guard', 'werewolf', 'witch', 'seer'])
export type NightRoleId = z.infer<typeof nightRoleIdSchema>

export const boardConfigSchema = z.object({
  /** Param 1: {角色: 数量}; sum must equal the number of seated players. */
  roles: z.partialRecord(roleIdSchema, z.number().int().nonnegative()),
  /** Param 2: 屠边 / 屠城 / 屠城+parity. */
  winCondition: winConditionSchema.default('kill-all-parity'),
  /** Param 3: 狼刀在先 — simultaneous wolf-win + good-win settles for wolves. */
  wolfPriorityOnSimultaneousWin: z.boolean().default(true),
  /** Param 4: 女巫自救 (WOD-1: default first-night-only). */
  witchSelfSavePolicy: witchSelfSavePolicySchema.default('first-night-only'),
  /** Param 5: 女巫同晚限一瓶. */
  witchOnePotionPerNight: z.boolean().default(true),
  /** Param 6: 计票规则. */
  voteRule: voteRuleSchema.default('plurality'),
  /** Param 7: 平票策略 (WOD-5: full PK). */
  voteTiePolicy: voteTiePolicySchema.default('pk-revote-then-nobody'),
  /** Param 8: 遗言策略 (WFR-105 matrix). */
  lastWordsPolicy: lastWordsPolicySchema.default('first-night-and-day'),
  /** Param 9: 死因公布口径 (default hidden, WFR-203-1). */
  deathCauseRevealed: z.boolean().default(false),
  /** Param 10: 死亡翻牌口径. */
  roleRevealedOnDeath: z.boolean().default(false),
  /** Param 11: 空刀允许. */
  emptyKillAllowed: z.boolean().default(true),
  /** Param 12: 自刀允许. */
  selfKillAllowed: z.boolean().default(true),
  /** Param 13: 发言顺序策略 (WOD-7 covers the first-day fallback). */
  speechOrderPolicy: speechOrderPolicySchema.default('from-dead-next'),
  /** Param 13 supplement: 首日（及平安日）发言起始座位. */
  day1StartSeat: z.number().int().positive().default(1),
  /** Param 14: 防死锁天数上限. */
  maxDays: z.number().int().positive().default(40),
  /** Param 15: 夜间行动顺序声明 (survey default 守卫→狼→女巫→预言家). */
  nightActionOrder: z.array(nightRoleIdSchema).default(['guard', 'werewolf', 'witch', 'seer']),
  /** Param 16: 猎人被毒禁枪. */
  hunterShootOnPoison: z.boolean().default(false),
  /** Param 17: 猎人被奶穿可开枪. */
  hunterShootOnMilkPierce: z.boolean().default(true),
  /** Param 18: 守卫连守禁则 (v1-M2 slot). */
  guardReGuardRule: guardReGuardRuleSchema.default('no-repeat-target'),
  /** Param 19: 同守同救裁决 (v1-M2 slot). */
  guardSaveConflict: guardSaveConflictSchema.default('milk-pierce'),
  /** Param 20: 守护是否挡毒 (v1-M2 slot). */
  guardBlocksPoison: z.boolean().default(false),
  /** Param 21: 白痴翻牌策略 (v1-M2 slot). */
  idiotFlipPolicy: idiotFlipPolicySchema.default('survive-lose-vote'),
  /** Param 22: 警长开关 (v1-M2 slot; M1 boards must keep it off — WOD-2). */
  sheriffEnabled: z.boolean().default(false),
  /** Param 23: 警长票权 (v1-M2 slot). */
  sheriffVoteWeight: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).default(1.5),
  /** Param 24: 自爆允许 (v2 action slot — registered but inert in v1-M1). */
  selfExplodeAllowed: z.boolean().default(true),
  /** Param 25: 明牌局口径 (v2 slot — only "hidden" accepted in v1-M1). */
  roleMode: roleModeSchema.default('hidden'),
  /** Param 26: 扩展角色启用清单 (v2 slot — must stay empty in v1-M1). */
  extendedRoles: z.array(roleIdSchema).default([]),
  /** WOD-4: speech budgets are per-board, engine keeps a global ceiling (2000). */
  speechMaxLength: z.number().int().positive().max(2000).default(200),
  lastWordsMaxLength: z.number().int().positive().max(2000).default(200),
})

export type BoardConfigInput = z.input<typeof boardConfigSchema>
/** A fully parsed, default-filled board configuration (单一真相 for the match). */
export type ResolvedBoard = z.output<typeof boardConfigSchema>

// ---------------------------------------------------------------------------
// Audience & viewers (WFR-201 / WFR-202 / WFR-206)
// ---------------------------------------------------------------------------

export const audienceSchema = z.union([
  z.object({ kind: z.literal('public') }),
  z.object({ kind: z.literal('wolves') }),
  z.object({ kind: z.literal('role-self'), playerId: z.string() }),
  z.object({ kind: z.literal('sheriff') }),
  z.object({ kind: z.literal('moderator') }),
])
export type Audience = z.infer<typeof audienceSchema>

// ---------------------------------------------------------------------------
// Actions (WFR-301 / WFR-303 / WFR-304)
// ---------------------------------------------------------------------------

export const engineActionSchema = z.discriminatedUnion('type', [
  // Night — wolves (WOD-3: per-living-wolf vote; majority decides, tie = 空刀)
  z.object({ type: z.literal('kill'), actorId: z.string(), targetId: z.string().nullable() }),
  // Night — seer
  z.object({ type: z.literal('seerCheck'), actorId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('seerPass'), actorId: z.string() }),
  // Night — witch (two independent questions, WFR-502 #6)
  z.object({ type: z.literal('witchSave'), actorId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('witchSavePass'), actorId: z.string() }),
  z.object({ type: z.literal('witchPoison'), actorId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('witchPoisonPass'), actorId: z.string() }),
  // Day
  z.object({ type: z.literal('speak'), actorId: z.string(), content: z.string() }),
  z.object({ type: z.literal('vote'), actorId: z.string(), targetId: z.string().nullable() }),
  z.object({ type: z.literal('lastWords'), actorId: z.string(), content: z.string() }),
  z.object({ type: z.literal('lastWordsPass'), actorId: z.string() }),
  // Hunter windows
  z.object({ type: z.literal('hunterShoot'), actorId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('hunterPass'), actorId: z.string() }),
])
export type WerewolfAction = z.infer<typeof engineActionSchema>
export type WerewolfActionType = WerewolfAction['type']

// ---------------------------------------------------------------------------
// Structured rejection (WFR-302)
// ---------------------------------------------------------------------------

export const rejectionCodeSchema = z.enum([
  'WRONG_PHASE',
  'WRONG_ACTOR',
  'ILLEGAL_TARGET',
  'EXHAUSTED',
  'PARAM_CONFLICT',
  'UNPARSEABLE',
])
export type RejectionCode = z.infer<typeof rejectionCodeSchema>

export interface ActionRejection {
  code: RejectionCode
  message: string
  context: {
    day: number
    phase: PhaseId
    actorId: string
    actionType: string
  }
}

// ---------------------------------------------------------------------------
// Deaths (WFR-402 / WFR-404 / WFR-105)
// ---------------------------------------------------------------------------

export const deathCauseSchema = z.enum([
  'wolf-kill',
  'poison',
  'shot',
  'exile',
  'milk-pierce',
  'self-explode',
  'lovers',
])
export type DeathCause = z.infer<typeof deathCauseSchema>

export interface DeathRecord {
  /** Day number the death was settled/announced on (night N deaths → day N). */
  settledDay: number
  /** Death-time class — decides last-words eligibility (WFR-105). */
  time: 'night' | 'day'
  /** Only meaningful when time === 'night': which night the death belongs to. */
  nightNumber: number
  /** All causes that applied (knife+poison on the same target → both recorded). */
  causes: readonly DeathCause[]
}

// ---------------------------------------------------------------------------
// Phases (WFR-102)
// ---------------------------------------------------------------------------

export const phaseIdSchema = z.enum([
  'night.guard',
  'night.wolves',
  'night.witch.save',
  'night.witch.poison',
  'night.seer',
  'day.announce',
  'day.hunterWindow',
  'day.lastWords',
  'day.speech',
  'day.vote',
  'day.pkSpeech',
  'day.pkVote',
  'ended',
])
export type PhaseId = z.infer<typeof phaseIdSchema>

// ---------------------------------------------------------------------------
// State (NFR-W2: every step is a pure function of (state, action))
// ---------------------------------------------------------------------------

export interface PlayerSlot {
  playerId: string
  /** 1-based seat number; seats are contiguous 1..N. */
  seat: number
  role: RoleId
  alive: boolean
  death: DeathRecord | null
}

export interface NightState {
  nightNumber: number
  /** Night steps still to walk this night, in declared order (dead actors skipped). */
  steps: readonly NightRoleId[]
  /** v1-M2 slot (guard boards are rejected in M1, so this stays null). */
  guardTarget: string | null
  wolfVotes: Array<{ voterId: string; targetId: string | null }>
  knifeTarget: string | null
  witchSaveTarget: string | null
  witchPoisonTarget: string | null
  /** Filled by the night settlement, consumed by the dawn announcement. */
  resolvedDeaths: Array<{ playerId: string; causes: readonly DeathCause[] }>
}

export interface VoteRecord {
  voterId: string
  /** null = abstain (弃票). */
  targetId: string | null
  weight: number
}

export interface VoteRoundState {
  round: 'main' | 'pk'
  /** null for the main round; the tied player list for a PK revote. */
  candidates: string[] | null
  votes: VoteRecord[]
  /** PK speeches still pending (main-round speeches use state.speechQueue). */
  pkSpeechQueue: string[]
}

export interface DeathSettlementState {
  /** Hunters (already dead) whose shoot windows are pending, seat order. */
  hunterWindows: string[]
  /** Players who still owe last words, in processing order. */
  lastWordsQueue: string[]
}

export interface MatchOutcome {
  winner: 'wolves' | 'good' | 'tie'
  basis: string
}

export interface WerewolfEngineState {
  engineVersion: 2
  board: ResolvedBoard
  players: PlayerSlot[]
  /** 0 during the first night; k during day k (day k follows night k). */
  day: number
  phase: PhaseId
  pendingActor: string | null
  night: NightState | null
  witchPotions: { save: boolean; poison: boolean }
  hunterShotsUsed: string[]
  /** Remaining day speakers (head = current speaker). */
  speechQueue: string[]
  /** 1-based speech turn counter within the current day. */
  speechTurn: number
  voteRound: VoteRoundState | null
  settlement: DeathSettlementState | null
  /** Where the day flow resumes once the death settlement queues drain. */
  postSettlement: 'speech' | 'night'
  outcome: MatchOutcome | null
  nextSeq: number
}

// ---------------------------------------------------------------------------
// Events (WFR-5xx — the 19-event minimal set + operational events)
// ---------------------------------------------------------------------------

export interface EventPayloadMap {
  /** #1-a 开局配置（公共事实：板子规则与座位）。 */
  matchStarted: { board: ResolvedBoard; seats: Array<{ playerId: string; seat: number }> }
  /** Randomness provenance (WFR-503) — moderator-audience so it cannot leak roles. */
  randomnessSeed: { seed: number }
  /** #1 开局发牌结果 — one event per player, audience = 该玩家本人. */
  rolesAssigned: { role: RoleId }
  /** WFR-203-5 狼队互识（首夜起）. */
  teammatesRevealed: { wolfIds: string[] }
  /** #2 阶段进入 — every phase switch. */
  phaseEntered: { phase: PhaseId }
  /** #3 守护选择 (v1-M2 slot — kind reserved in the contract). */
  guardTargetChosen: { targetId: string | null }
  /** Individual wolf kill vote (WOD-3 deliberation), wolves-only. */
  wolfKillVote: { targetId: string | null }
  /** #4 狼队刀口商定 — resolved majority / 空刀. */
  wolfKillAgreed: { targetId: string | null; tally: Array<{ targetId: string | null; votes: number }> }
  /** #5 刀口告知 — must precede any witch potion decision (AC-3). */
  knifeTargetRevealed: { nightNumber: number; targetId: string | null }
  /** #6 女巫两问 — save question (explicit or auto confirmation). */
  witchSaveDecision: {
    used: boolean
    targetId: string | null
    auto: boolean
    autoReason: string | null
  }
  /** #6 女巫两问 — poison question. */
  witchPoisonDecision: {
    used: boolean
    targetId: string | null
    auto: boolean
    autoReason: string | null
  }
  /** #7 查验请求与结果 — binary, private. */
  seerChecked: { targetId: string; result: 'good' | 'werewolf' }
  /** Seer default/skip confirmation (WFR-304). */
  seerSkipped: { nightNumber: number }
  /** #8 夜间结算事实 —死因/奶穿/毒穿, moderator only. */
  nightSettled: {
    nightNumber: number
    deaths: Array<{ playerId: string; causes: readonly DeathCause[] }>
    facts: readonly string[]
  }
  /** #9 死讯公告 — 平安夜/单死/双死, seats only unless params 9/10 are on. */
  deathsAnnounced: {
    kind: 'peaceful' | 'single' | 'double'
    seatNumbers: number[]
    causes?: DeathCause[][]
    roles?: RoleId[]
  }
  /** #10 猎人开枪许可 — private; absent entirely when poisoned (AC-4). */
  hunterShootPermission: { canShoot: boolean }
  /** #11 开枪与目标出局. */
  hunterShot: { hunterId: string; targetId: string }
  /** Hunter 憋枪 confirmation — private. */
  hunterDeclined: { hunterId: string }
  /** #12 遗言 — content null = declined. */
  lastWords: { playerId: string; content: string | null }
  /** #13 发言. */
  speech: { playerId: string; content: string; order: number }
  /** #14 逐票. */
  voteCast: { round: 'main' | 'pk'; voterId: string; targetId: string | null; weight: number }
  /** #14 计票结果（含平票处理）. */
  voteResult: {
    round: 'main' | 'pk'
    tally: Array<{ targetId: string | null; votes: number }>
    outcome: 'exile' | 'tie-pk' | 'no-exile' | 'no-exile-after-pk' | 'no-majority'
    exiledId?: string
  }
  /** #15 警长竞选各环节 (v1-M2 slot). */
  sheriffCampaign: { slot: 'v1-M2' }
  /** #16 警徽移交/撕徽 (v1-M2 slot). */
  sheriffBadgeTransfer: { slot: 'v1-M2' }
  /** #17 白痴翻牌 (v1-M2 slot). */
  idiotFlipped: { slot: 'v1-M2' }
  /** #18 自爆 (v2 slot). */
  selfExplode: { slot: 'v2' }
  /** #19 终局揭示 — delayed-public full reveal. */
  gameEnded: {
    winner: 'wolves' | 'good' | 'tie'
    basis: string
    reveal: Array<{
      playerId: string
      seat: number
      role: RoleId
      death: DeathRecord | null
    }>
  }
}

export type WerewolfEventKind = keyof EventPayloadMap

/**
 * Append-only fact log entry (WFR-501/504). `action` is set on events that
 * directly mirror a submitted action — that anchor is what makes
 * `reduceEvents` replay possible (WFR-503).
 */
export type WerewolfEvent = {
  seq: number
  day: number
  audience: Audience
  actorId: string | null
  isDefault?: boolean
  action?: WerewolfAction
} & {
  [K in keyof EventPayloadMap]: { kind: K; payload: EventPayloadMap[K] }
}[keyof EventPayloadMap]

// ---------------------------------------------------------------------------
// Engine results
// ---------------------------------------------------------------------------

export type ApplyOutcome =
  | { status: 'accepted'; state: WerewolfEngineState; events: WerewolfEvent[] }
  | { status: 'rejected'; rejection: ActionRejection }

export interface BoardIssue {
  field: string
  code: string
  message: string
}

export type CreateMatchResult =
  | { status: 'created'; state: WerewolfEngineState; events: WerewolfEvent[] }
  | { status: 'invalid'; issues: BoardIssue[] }

/** WFR-303 action-contract surface (machine-readable, for upstream adapters). */
export interface ActionOption {
  type: WerewolfActionType
  label: string
  /** Legal non-null targets (empty when the action takes no target). */
  targetIds: string[]
  /** Whether the null/pass variant is legal here (空刀 / 弃票 / pass). */
  allowNone: boolean
}
