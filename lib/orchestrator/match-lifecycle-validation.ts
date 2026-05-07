import type { GameType } from '@/lib/core/types'

/**
 * Thrown by `validateMatchCreate` when the input would create an illegal
 * match. Carries a stable class name so API handlers can surface this as a
 * 400 without also swallowing genuine infrastructure errors (DB / Redis).
 */
export class MatchCreateValidationError extends Error {
  readonly name = 'MatchCreateValidationError'
}

export type ValidateWerewolfCreateInput = {
  agentIds: string[]
  moderatorAgentId: string | null
}

/**
 * Validates inputs for creating a werewolf match.
 *
 * Invariants:
 * - exactly 6 player agents
 * - a moderator agent is required (the GM calls it on every phase boundary)
 * - player agent ids must be unique
 * - moderator cannot double as a player
 */
export function validateWerewolfCreate(input: ValidateWerewolfCreateInput): void {
  if (input.agentIds.length !== 6) {
    throw new MatchCreateValidationError(
      `werewolf requires exactly 6 player agents, got ${input.agentIds.length}`,
    )
  }
  const dupCheck = new Set<string>()
  for (const id of input.agentIds) {
    if (dupCheck.has(id)) {
      throw new MatchCreateValidationError(
        `werewolf player agents contain duplicate id: ${id}`,
      )
    }
    dupCheck.add(id)
  }
  if (!input.moderatorAgentId) {
    throw new MatchCreateValidationError('werewolf requires a moderatorAgentId')
  }
  if (dupCheck.has(input.moderatorAgentId)) {
    throw new MatchCreateValidationError(
      `werewolf moderator cannot also be a player (${input.moderatorAgentId})`,
    )
  }
}

/** Game-type aware guard; no-op for games without special validation. */
export function validateMatchCreate(
  gameType: GameType,
  input: ValidateWerewolfCreateInput,
): void {
  if (gameType === 'werewolf') validateWerewolfCreate(input)
}
