import type { GameEvent, MatchResult } from '@/lib/core/types'

export type ActionSpec<TAction = unknown> = {
  type: string
  minAmount?: number
  maxAmount?: number
  label?: string
  template?: TAction
}

export type ApplyActionResult<TState> = {
  nextState: TState
  events: GameEvent[]
}

export type BoundaryKind = 'hand-end' | 'round-end' | 'match-end'

/**
 * Pure game engine contract. Implementations must not perform IO and must keep
 * all game-specific branching inside the owning game module.
 */
export interface GameEngine<TState, TAction, TConfig> {
  createInitialState(config: TConfig, agentIds: string[]): TState
  currentActor(state: TState): string | null
  availableActions(state: TState, agentId: string): ActionSpec<TAction>[]
  applyAction(state: TState, agentId: string, action: TAction): ApplyActionResult<TState>
  boundary(prevState: TState, nextState: TState): BoundaryKind | null
  finalize(state: TState): MatchResult
}
