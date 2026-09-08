// Werewolf engine v2 public surface — pure logic, zero IO (see types.ts for
// the WFR requirement map). Consumed by the (future) engine2 orchestrator
// adapter; tests live at tests/unit/games/werewolf/engine2/.

export type {
  ActionOption,
  ActionRejection,
  ApplyOutcome,
  Audience,
  BoardConfigInput,
  BoardIssue,
  Camp,
  CreateMatchResult,
  DeathCause,
  DeathRecord,
  EventPayloadMap,
  Faction,
  LastWordsPolicy,
  MatchOutcome,
  NightRoleId,
  PhaseId,
  PlayerSlot,
  ResolvedBoard,
  RejectionCode,
  RoleId,
  VoteRecord,
  WerewolfAction,
  WerewolfActionType,
  WerewolfEngineState,
  WerewolfEvent,
  WerewolfEventKind,
  WinCondition,
} from './types'
export {
  M1_ROLES,
  M2_ROLES,
  V2_ROLES,
  audienceSchema,
  boardConfigSchema,
  deathCauseSchema,
  engineActionSchema,
  factionSchema,
  lastWordsPolicySchema,
  nightRoleIdSchema,
  phaseIdSchema,
  rejectionCodeSchema,
  roleIdSchema,
  speechOrderPolicySchema,
  voteRuleSchema,
  voteTiePolicySchema,
  winConditionSchema,
  witchSelfSavePolicySchema,
} from './types'

export {
  BOARD_PRESET_6P_BASE,
  BOARD_PRESET_9P_333,
  parseBoard,
  presetBoard,
  type BoardParseResult,
  type BoardPreset,
} from './board'

export { factionOf, campOf, playerById, alivePlayers, aliveWolves, aliveByRole } from './roles'

export {
  eventVisibleTo,
  visibleEvents,
  makeEvent,
  type EventViewer,
} from './events'

export {
  resolveNight,
  evaluateWin,
  hunterCanShoot,
  lastWordsEligible,
  type NightActionSet,
  type NightResolution,
  type WinEvaluation,
} from './settlement'

export { createMatch, createMatchFromSeating, seededRng, type CreateMatchArgs } from './setup'
export { validateAction, type Validation } from './validator'

export {
  applyAction,
  applyDefaultAction,
  availableActions,
  currentActor,
  normalizeAction,
  reduceEvents,
  type ReduceResult,
} from './engine'
