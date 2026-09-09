// Avalon engine v2 public surface — pure logic, zero IO.
//
// 消费方：integration/plugin-v2.ts（GM 插件面）、
// backend/orchestrator/match-lifecycle-validation.ts（板子人数校验）与
// tests/unit/games/avalon/engine2/*（纯逻辑单测）。

export type {
  ActionOption,
  ActionRejection,
  ApplyOutcome,
  Audience,
  AvalonAction,
  AvalonActionType,
  AvalonEngineState,
  AvalonEvent,
  AvalonEventKind,
  AvalonRoleId,
  AssassinationRecord,
  ConsultationBatch,
  CreateMatchResult,
  DiscussionBatch,
  EventPayloadMap,
  Faction,
  KnowledgeRecord,
  MatchOutcome,
  PhaseId,
  PlayerSlot,
  QuestBatch,
  QuestResultRecord,
  ResolvedBoard,
  RejectionCode,
  TeamProposal,
  VoteBatch,
  VoteHistoryEntry,
} from './types'
export {
  MAX_REJECTIONS,
  MAX_SEATS,
  MIN_SEATS,
  QUEST_COUNT,
  STANDARD_BOARD_TABLE,
  TEXT_MAX_LENGTH,
  TEXT_MIN_LENGTH,
  WINS_REQUIRED,
  avalonRoleIdSchema,
  audienceSchema,
  engineActionSchema,
  factionOf,
  factionSchema,
  phaseIdSchema,
  rejectionCodeSchema,
} from './types'

export type { BoardIssue, ResolvedBoardResult } from './board'
export type { BoardPreset } from './types'
export {
  AVALON_PRESETS,
  AVALON_PRESET_IDS,
  requiredFailsOf,
  resolveBoard,
  validateBoard,
} from './board'

export { eventVisibleTo, visibleEvents, makeEvent, type EventViewer } from './events'

export {
  createMatch,
  createMatchFromSeating,
  computeKnowledge,
  seededRng,
  type CreateMatchArgs,
  type CreateMatchFromSeatingArgs,
} from './setup'

export {
  emitEvent,
  successCount,
  failCount,
  forceEndOutcome,
  finishMatch,
  validateAction,
  seatOf,
  assassinationHolderId,
  evilPlayers,
  playerById,
  type Ctx,
  type Validation,
  type ValidateOptions,
} from './phases'

export {
  applyAction,
  applyDefaultAction,
  availableActions,
  currentActor,
  defaultTeam,
  normalizeAction,
  reduceEvents,
  terminateImmediately,
  type ReduceResult,
} from './engine'
