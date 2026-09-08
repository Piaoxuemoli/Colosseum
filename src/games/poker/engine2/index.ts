// 德州扑克引擎 v2 公共 API（需求权威：docs/prd/games/poker-engine.md，PFR 全条目已代决）。
// 纯逻辑模块：无 React / store / route / DB / Redis / LLM 依赖。

export {
  SUITS,
  RANKS,
  cardCode,
  cardCodes,
  createOrderedDeck,
  dealLayout,
  parseCard,
  parseCards,
  rankValue,
} from './cards'
export type { Card, Rank, Suit } from './cards'

export { hashSeed, handSeedFrom, mulberry32, shuffled, firstButtonSeat, mix32 } from './rng'
export type { Rng, RngSeed } from './rng'

export {
  CATEGORY_NAME,
  CATEGORY_RANK,
  HAND_CATEGORIES,
  compareEvaluations,
  evaluate5,
  evaluateBest,
} from './evaluator'
export type { HandCategory, HandEvaluation } from './evaluator'

export { computePots, awardPots } from './pots'
export type { Contribution, PotAwardResult, PotLayer, PotWinnerShare } from './pots'

export {
  applyAction,
  applyNormalizedAction,
  classifyState,
  createMatch,
  createMatchFromMaster,
  requestStopAfterCurrentHand,
  terminateImmediately,
  EngineError,
} from './engine'
export type { ApplyActionOutcome, CommandOutcome, CreateMatchOutcome, StateClassification } from './engine'

export { legalActionSet, validateAction } from './legal'
export type { LegalAction, LegalActionSet, ValidateOutcome } from './legal'

export { decisionContext, positionLabels } from './context'
export type { DecisionContext, PositionLabel } from './context'

export { filterEvents } from './events'
export type { EventAudience, EventAudienceSelector, EventDraft, PokerEvent } from './events'

export { reduceEvents } from './replay'
export type { ReplayResult } from './replay'

export { levelForHand, resolveConfig } from './config'
export type { ConfigOutcome } from './types'
export type {
  ActionRejection,
  BlindLevel,
  BlindSchedule,
  ConfigRejection,
  ConfigRejectionCode,
  MatchConfigInput,
  MatchFinish,
  MatchFinishReason,
  MatchPhase,
  MatchState,
  NormalizedAction,
  PlayerAction,
  PlayerState,
  PlayerStatus,
  RejectionCode,
  ResolvedMatchConfig,
  Street,
  HandFrame,
} from './types'
export { blindLevelSchema, blindScheduleSchema, matchConfigSchema, normalizedActionSchema, playerActionSchema } from './types'
