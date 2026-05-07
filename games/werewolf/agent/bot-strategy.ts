import type { BotStrategy } from '@/lib/core/registry'
import type {
  WerewolfAction,
  WerewolfRole,
  WerewolfState,
} from '../engine/types'

/**
 * Deterministic-ish fallback strategy for werewolf agents. Produces a legal
 * action in every phase. Kept pure + side-effect free so it can be injected
 * as the safety net below the LLM layer.
 *
 * Policy summary:
 *   - werewolfDiscussion  → short stock-phrase speech
 *   - werewolfKill        → random non-werewolf alive target
 *   - seerCheck           → random non-self, non-previously-checked alive target
 *   - witchAction         → never spend potions (`poison` with targetId = null)
 *   - day/speak           → "continuing to observe" stock phrase
 *   - day/vote            → random alive non-self, 30% abstain
 */
export class WerewolfBotStrategy implements BotStrategy {
  constructor(private readonly rng: () => number = Math.random) {}

  decide(gameStateRaw: unknown, _validActionsRaw: unknown[]): WerewolfAction {
    const state = gameStateRaw as WerewolfState
    const actorId = state.currentActor
    if (!actorId) {
      return { type: 'day/speak', content: '' }
    }
    const alive = state.players.filter((p) => p.alive)
    const notSelf = alive.filter((p) => p.agentId !== actorId)

    switch (state.phase) {
      case 'night/werewolfDiscussion':
        return { type: 'day/speak', content: '我先观察一下情况。' }
      case 'night/werewolfKill': {
        const nonWolves = alive.filter(
          (p) => state.roleAssignments[p.agentId] !== ('werewolf' as WerewolfRole),
        )
        const target = this.pickFrom(nonWolves, alive)
        return { type: 'night/werewolfKill', targetId: target.agentId, reasoning: 'bot fallback' }
      }
      case 'night/seerCheck': {
        const already = new Set(state.seerCheckResults.map((r) => r.targetId))
        const unchecked = notSelf.filter((p) => !already.has(p.agentId))
        const target = unchecked[0] ?? notSelf[0]
        if (!target) {
          // Extremely degenerate: no other player alive; pick self anyway, validator will surface it.
          return { type: 'night/seerCheck', targetId: actorId }
        }
        return { type: 'night/seerCheck', targetId: target.agentId }
      }
      case 'night/witchAction':
        return { type: 'night/witchPoison', targetId: null }
      case 'day/speak':
        return { type: 'day/speak', content: '我还在观察，暂不跳身份。' }
      case 'day/vote': {
        if (this.rng() < 0.3) return { type: 'day/vote', targetId: null }
        const pool = notSelf.length > 0 ? notSelf : alive
        const target = pool[Math.floor(this.rng() * pool.length)]
        return { type: 'day/vote', targetId: target?.agentId ?? null }
      }
      default:
        return { type: 'day/speak', content: '' }
    }
  }

  private pickFrom<T>(preferred: T[], fallback: T[]): T {
    const pool = preferred.length > 0 ? preferred : fallback
    return pool[Math.floor(this.rng() * pool.length)]
  }
}
