import type { GameEvent } from '@/lib/core/types'
import type { MemoryContextSnapshot, MemoryModule } from '@/lib/memory/contracts'
import { formatEpisodicSection, synthesizeEpisodic, type PokerEpisodicEntry } from './episodic'
import { formatSemanticSection, updateSemantic, type PokerSemanticProfile } from './semantic'
import { formatWorkingForPrompt, initWorking, updateWorking, type PokerWorkingMemory } from './working'

export class PokerMemoryModule implements MemoryModule<PokerWorkingMemory, PokerEpisodicEntry, PokerSemanticProfile> {
  readonly gameType = 'poker' as const

  initWorking(_matchId: string, _agentId: string): PokerWorkingMemory {
    return initWorking()
  }

  updateWorking(previous: PokerWorkingMemory, event: GameEvent): PokerWorkingMemory {
    return updateWorking(previous, event)
  }

  synthesizeEpisodic(input: {
    working: PokerWorkingMemory
    finalState: unknown
    observerAgentId: string
    targetAgentId: string | null
    matchId: string
  }): PokerEpisodicEntry | null {
    if (!input.targetAgentId) return null
    return synthesizeEpisodic({
      workingLog: input.working.matchActionsLog,
      finalState: input.finalState,
      observerAgentId: input.observerAgentId,
      targetAgentId: input.targetAgentId,
      matchId: input.matchId,
    })
  }

  updateSemantic(current: PokerSemanticProfile | null, episodic: PokerEpisodicEntry): PokerSemanticProfile {
    return updateSemantic(current, episodic)
  }

  buildMemoryContext(input: {
    working: PokerWorkingMemory
    allEpisodic: PokerEpisodicEntry[]
    semanticByTarget: Map<string, PokerSemanticProfile>
  }): MemoryContextSnapshot {
    return {
      workingSummary: formatWorkingForPrompt(input.working),
      episodicSection: formatEpisodicSection(input.allEpisodic),
      semanticSection: formatSemanticSection(input.semanticByTarget),
      raw: {
        working: input.working as unknown as Record<string, unknown>,
      },
    }
  }

  serialize = {
    working: (working: PokerWorkingMemory) => working as unknown as Record<string, unknown>,
    episodic: (episodic: PokerEpisodicEntry) => episodic as unknown as Record<string, unknown>,
    semantic: (semantic: PokerSemanticProfile) => semantic as unknown as Record<string, unknown>,
  }

  deserialize = {
    working: (raw: Record<string, unknown>) => raw as unknown as PokerWorkingMemory,
    episodic: (raw: Record<string, unknown>) => raw as unknown as PokerEpisodicEntry,
    semantic: (raw: Record<string, unknown>) => raw as unknown as PokerSemanticProfile,
  }
}
