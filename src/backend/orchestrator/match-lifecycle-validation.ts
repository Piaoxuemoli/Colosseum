import { AVALON_PRESETS, AVALON_PRESET_IDS } from '@/games/avalon/engine2'
import type { GameType } from '@/platform/core/types'

/**
 * Thrown by `validateMatchCreate` when the input would create an illegal
 * match. Carries a stable class name so API handlers can surface this as a
 * 400 without also swallowing genuine infrastructure errors (DB / Redis).
 */
export class MatchCreateValidationError extends Error {
  readonly name = 'MatchCreateValidationError'
}

export type ValidateMatchCreateInput = {
  agentIds: string[]
  moderatorAgentId: string | null
  /** engine2 配置（狼人杀板子 boardId 参与人数校验）。 */
  engineConfig?: Record<string, unknown>
}

/** engine2 狼人杀板子座位数（与 games/werewolf/engine2 预设一致）。 */
const WEREWOLF_BOARD_SEATS: Record<string, number> = {
  'base-6': 6,
  '333-9': 9,
}

/**
 * Validates inputs for creating a werewolf match (v2).
 *
 * Invariants:
 * - player count matches the engine2 board preset (base-6 默认 / 333-9)
 * - a moderator agent is required (seeding flow guarantees one)
 * - player agent ids must be unique
 * - moderator cannot double as a player
 */
export function validateWerewolfCreate(input: ValidateMatchCreateInput): void {
  const boardId = typeof input.engineConfig?.boardId === 'string' ? input.engineConfig.boardId : 'base-6'
  const seats = WEREWOLF_BOARD_SEATS[boardId] ?? 6
  if (input.agentIds.length !== seats) {
    throw new MatchCreateValidationError(
      `werewolf board "${boardId}" requires exactly ${seats} player agents, got ${input.agentIds.length}`,
    )
  }
  const dupCheck = new Set<string>()
  for (const id of input.agentIds) {
    if (dupCheck.has(id)) {
      throw new MatchCreateValidationError(`werewolf player agents contain duplicate id: ${id}`)
    }
    dupCheck.add(id)
  }
  if (!input.moderatorAgentId) {
    throw new MatchCreateValidationError('werewolf requires a moderatorAgentId')
  }
  if (dupCheck.has(input.moderatorAgentId)) {
    throw new MatchCreateValidationError(`werewolf moderator cannot also be a player (${input.moderatorAgentId})`)
  }
}

/**
 * Validates inputs for creating a poker match (v2, engine2 支持 2–9 人).
 */
export function validatePokerCreate(input: ValidateMatchCreateInput): void {
  if (input.agentIds.length < 2 || input.agentIds.length > 9) {
    throw new MatchCreateValidationError(
      `poker requires 2-9 player agents (engine2 PFR-102), got ${input.agentIds.length}`,
    )
  }
  const dupCheck = new Set<string>()
  for (const id of input.agentIds) {
    if (dupCheck.has(id)) {
      throw new MatchCreateValidationError(`poker player agents contain duplicate id: ${id}`)
    }
    dupCheck.add(id)
  }
}

/**
 * Validates inputs for creating an avalon match (v2 全量规则：板子预设驱动).
 * 阿瓦隆无 moderator 概念——主持人 Agent 不参与也不要求（旁白可选，AVR-OD-6）。
 */
export function validateAvalonCreate(input: ValidateMatchCreateInput): void {
  const presetId = typeof input.engineConfig?.preset === 'string' ? input.engineConfig.preset : 'basic-5'
  const preset = AVALON_PRESETS[presetId]
  if (!preset) {
    throw new MatchCreateValidationError(
      `avalon board preset "${presetId}" is unknown (available: ${AVALON_PRESET_IDS.join(', ')})`,
    )
  }
  const seats = Object.values(preset.roles).reduce((sum, count) => sum + count, 0)
  if (input.agentIds.length !== seats) {
    throw new MatchCreateValidationError(
      `avalon board "${presetId}" requires exactly ${seats} player agents, got ${input.agentIds.length}`,
    )
  }
  const dupCheck = new Set<string>()
  for (const id of input.agentIds) {
    if (dupCheck.has(id)) {
      throw new MatchCreateValidationError(`avalon player agents contain duplicate id: ${id}`)
    }
    dupCheck.add(id)
  }
}

/** Game-type aware guard. */
export function validateMatchCreate(gameType: GameType, input: ValidateMatchCreateInput): void {
  if (gameType === 'werewolf') validateWerewolfCreate(input)
  if (gameType === 'poker') validatePokerCreate(input)
  if (gameType === 'avalon') validateAvalonCreate(input)
}
