import type { GameEvent } from '@/lib/core/types'
import type { MemoryContextSnapshot, MemoryModule } from '@/lib/memory/contracts'
import type { WerewolfState } from '../engine/types'
import {
  formatEpisodicSection,
  synthesizeEpisodic,
} from './episodic'
import {
  defaultSemanticProfile,
  formatSemanticSection,
  updateSemantic,
} from './semantic'
import type {
  WerewolfEpisodicEntry,
  WerewolfSemanticProfile,
  WerewolfWorkingMemory,
} from './types'
import {
  formatWorkingForPrompt,
  initWorkingMemory,
  updateWorkingMemory,
} from './working'

export class WerewolfMemoryModule
  implements MemoryModule<WerewolfWorkingMemory, WerewolfEpisodicEntry, WerewolfSemanticProfile>
{
  readonly gameType = 'werewolf' as const

  initWorking(matchId: string, agentId: string): WerewolfWorkingMemory {
    return initWorkingMemory(matchId, agentId)
  }

  updateWorking(previous: WerewolfWorkingMemory, event: GameEvent): WerewolfWorkingMemory {
    return updateWorkingMemory(previous, event)
  }

  /**
   * Synthesizes ONE episodic entry per (match, observer) pair. The contract
   * accepts a `targetAgentId` but werewolf reasons about the whole set; we
   * ignore it on synthesize and return the same whole-match entry every time.
   * The orchestrator should call this once per observer, then fan-out the
   * result into the semantic table per-target during finalize.
   */
  synthesizeEpisodic(input: {
    working: WerewolfWorkingMemory
    finalState: unknown
    observerAgentId: string
    targetAgentId: string | null
    matchId: string
  }): WerewolfEpisodicEntry | null {
    const state = input.finalState as WerewolfState | null
    if (!state) return null
    return synthesizeEpisodic({
      working: input.working,
      finalState: state,
      observerAgentId: input.observerAgentId,
      matchId: input.matchId,
    })
  }

  /**
   * Update the semantic row for ONE target using the (freshly synthesised)
   * episodic entry. Callers invoke this N times per observer after
   * `synthesizeEpisodic`, once per other agent in the match.
   *
   * We read the target from the episodic `actualRoles` by matching what's
   * missing — but since current signature doesn't carry the target, we
   * fall back to the first non-observer agent in `actualRoles` if no
   * existing `current` is provided.
   */
  updateSemantic(
    current: WerewolfSemanticProfile | null,
    episodic: WerewolfEpisodicEntry,
  ): WerewolfSemanticProfile {
    const targetId =
      current?.targetAgentId ?? this.inferTargetFromEpisodic(episodic)
    return updateSemantic(current, episodic, targetId)
  }

  buildMemoryContext(input: {
    working: WerewolfWorkingMemory
    allEpisodic: WerewolfEpisodicEntry[]
    semanticByTarget: Map<string, WerewolfSemanticProfile>
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
    working: (w: WerewolfWorkingMemory) => w as unknown as Record<string, unknown>,
    episodic: (e: WerewolfEpisodicEntry) => e as unknown as Record<string, unknown>,
    semantic: (s: WerewolfSemanticProfile) => s as unknown as Record<string, unknown>,
  }

  deserialize = {
    working: (raw: Record<string, unknown>) => raw as unknown as WerewolfWorkingMemory,
    episodic: (raw: Record<string, unknown>) => raw as unknown as WerewolfEpisodicEntry,
    semantic: (raw: Record<string, unknown>) => raw as unknown as WerewolfSemanticProfile,
  }

  private inferTargetFromEpisodic(episodic: WerewolfEpisodicEntry): string {
    const ids = Object.keys(episodic.actualRoles).filter(
      (id) => id !== episodic.observerAgentId,
    )
    return ids[0] ?? '__unknown__'
  }

  /**
   * Helper used by orchestrator finalize: given one observer episodic entry,
   * produce the **full set** of (targetId -> semantic) updates for that
   * observer. Each call returns a fresh default profile merged with the
   * episodic signals for that target.
   */
  buildSemanticUpdates(
    priorByTarget: Map<string, WerewolfSemanticProfile>,
    episodic: WerewolfEpisodicEntry,
  ): Map<string, WerewolfSemanticProfile> {
    const out = new Map<string, WerewolfSemanticProfile>()
    for (const targetId of Object.keys(episodic.actualRoles)) {
      if (targetId === episodic.observerAgentId) continue
      const prior =
        priorByTarget.get(targetId) ??
        defaultSemanticProfile(episodic.observerAgentId, targetId)
      out.set(targetId, updateSemantic(prior, episodic, targetId))
    }
    return out
  }
}
