import type { GameEvent, GameType } from '@/lib/core/types'

export type MemoryContextSnapshot = {
  workingSummary: string
  episodicSection: string
  semanticSection: string
  raw?: Record<string, unknown>
}

export interface MemoryModule<TWorking, TEpisodic, TSemantic> {
  readonly gameType: GameType

  initWorking(matchId: string, agentId: string): TWorking
  updateWorking(previous: TWorking, event: GameEvent): TWorking

  synthesizeEpisodic(input: {
    working: TWorking
    finalState: unknown
    observerAgentId: string
    targetAgentId: string | null
    matchId: string
  }): TEpisodic | null

  updateSemantic(current: TSemantic | null, newEpisodic: TEpisodic): TSemantic

  buildMemoryContext(input: {
    working: TWorking
    allEpisodic: TEpisodic[]
    semanticByTarget: Map<string, TSemantic>
  }): MemoryContextSnapshot

  serialize: {
    working: (working: TWorking) => Record<string, unknown>
    episodic: (episodic: TEpisodic) => Record<string, unknown>
    semantic: (semantic: TSemantic) => Record<string, unknown>
  }
  deserialize: {
    working: (raw: Record<string, unknown>) => TWorking
    episodic: (raw: Record<string, unknown>) => TEpisodic
    semantic: (raw: Record<string, unknown>) => TSemantic
  }
}
