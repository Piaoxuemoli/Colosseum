/**
 * Event kinds for the werewolf game and their visibility defaults.
 * The engine already emits these via `applyAction` (see werewolf-engine.ts),
 * but we centralise the vocabulary + visibility rules here so that:
 *   - the moderator / GM layer can filter by kind without string literals
 *   - downstream code (memory, UI) has one place to check visibility
 */

import type { Visibility } from '@/lib/core/types'

export const WEREWOLF_EVENT_KINDS = [
  'werewolf/match-start',
  'werewolf/phase-enter',
  'werewolf/werewolfDiscuss',
  'werewolf/werewolfKill',
  'werewolf/seerCheck',
  'werewolf/witchSave',
  'werewolf/witchPoison',
  'werewolf/day-announce',
  'werewolf/speak',
  'werewolf/vote',
  'werewolf/execute',
  'werewolf/moderator-narrate',
  'werewolf/game-end',
] as const

export type WerewolfEventKind = (typeof WEREWOLF_EVENT_KINDS)[number]

export interface VisibilityContext {
  /** Agent id that produced the action this event describes. Null for system events. */
  actorAgentId: string | null
  /** Agent ids currently assigned the werewolf role (alive or dead). */
  werewolfIds: string[]
}

/**
 * Declarative visibility table. Keeping this separate from the engine lets
 * tests assert the rule without executing any state transitions.
 */
export function visibilityForKind(
  kind: WerewolfEventKind,
  ctx: VisibilityContext,
): { visibility: Visibility; restrictedTo: string[] | null } {
  switch (kind) {
    case 'werewolf/werewolfDiscuss':
    case 'werewolf/werewolfKill':
      return { visibility: 'role-restricted', restrictedTo: ctx.werewolfIds }
    case 'werewolf/seerCheck':
    case 'werewolf/witchSave':
    case 'werewolf/witchPoison':
      return {
        visibility: 'role-restricted',
        restrictedTo: ctx.actorAgentId ? [ctx.actorAgentId] : [],
      }
    default:
      return { visibility: 'public', restrictedTo: null }
  }
}

export function isWerewolfEventKind(k: string): k is WerewolfEventKind {
  return (WEREWOLF_EVENT_KINDS as readonly string[]).includes(k)
}
