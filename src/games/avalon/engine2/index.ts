// Avalon engine v2 public surface — pure logic, zero IO.
//
// 消费方：integration/plugin-v2.ts（GM 插件面）与
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
  CreateMatchResult,
  EventPayloadMap,
  Faction,
  MatchOutcome,
  PhaseId,
  PlayerSlot,
  QuestResultRecord,
  RejectionCode,
  TeamProposal,
  VoteBatch,
  QuestBatch,
} from './types'
export {
  AVALON_BOARD_ID,
  AVALON_BOARD_SEATS,
  MAX_REJECTIONS,
  QUEST_COUNT,
  SMOKE_BOARD_ROLES,
  TEAM_SIZE,
  avalonRoleIdSchema,
  audienceSchema,
  engineActionSchema,
  factionOf,
  factionSchema,
  phaseIdSchema,
  rejectionCodeSchema,
} from './types'

export { eventVisibleTo, visibleEvents, makeEvent, type EventViewer } from './events'

export { createMatch, createMatchFromSeating, seededRng, type CreateMatchArgs } from './setup'

export {
  emitEvent,
  successCount,
  failCount,
  forceEndOutcome,
  finishMatch,
  validateAction,
  seatOf,
  type Ctx,
  type Validation,
} from './phases'

export {
  applyAction,
  applyDefaultAction,
  availableActions,
  currentActor,
  normalizeAction,
  reduceEvents,
  terminateImmediately,
  type ReduceResult,
} from './engine'
