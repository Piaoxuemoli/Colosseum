/**
 * Werewolf-specific orchestration hooks.
 *
 * The shared game-master tick does not know about werewolf phase transitions
 * or moderator agents. This module exposes small, pure helpers the GM can
 * call when `match.gameType === 'werewolf'`:
 *
 *   1. `moderatorNarrationEvent` — inspect `prevState` and `nextState`; if
 *      the werewolf phase changed (and the match is still running), return a
 *      public `werewolf/moderator-narrate` event to be appended to the
 *      event log. The narration is a short canned string (≤80 chars).
 *      A later phase will swap this out for a live LLM moderator call.
 *
 *   2. `fallbackNarrationForPhase` — used by the moderator fallback path
 *      (both here and during real moderator failures).
 */

import type { GameEvent } from '@/lib/core/types'
import type { WerewolfPhase, WerewolfState } from '@/games/werewolf/engine/types'

const NARRATION_MAP: Record<WerewolfPhase, string> = {
  'night/werewolfDiscussion': '夜幕降临，狼人睁眼商议。',
  'night/werewolfKill': '狼人拍板，锁定目标。',
  'night/seerCheck': '预言家请睁眼。',
  'night/witchAction': '女巫请抉择救与毒。',
  'day/announce': '天亮了，昨夜战报将至。',
  'day/speak': '请依次发言。',
  'day/vote': '全员投票。',
  'day/execute': '公示出局结果。',
}

export function fallbackNarrationForPhase(phase: WerewolfPhase): string {
  return NARRATION_MAP[phase] ?? '进入下一阶段。'
}

export function moderatorNarrationEvent(
  prev: WerewolfState,
  next: WerewolfState,
): Omit<GameEvent, 'matchId' | 'seq' | 'id'> | null {
  if (prev.phase === next.phase) return null
  if (next.matchComplete) return null

  return {
    gameType: 'werewolf',
    occurredAt: new Date().toISOString(),
    kind: 'werewolf/moderator-narrate',
    actorAgentId: next.moderatorAgentId,
    payload: {
      upcomingPhase: next.phase,
      day: next.day,
      narration: fallbackNarrationForPhase(next.phase),
    },
    visibility: 'public',
    restrictedTo: null,
  }
}
