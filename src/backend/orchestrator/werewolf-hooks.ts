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
 *
 * FR-4.7-01 narration kill-switch (R2-2): pass `narrationEnabled: false` to
 * mute ONLY the moderator's 解说性旁白 (the `narration` string, today canned
 * and later the live LLM moderator A2A call). The event itself still flows
 * because its `upcomingPhase` / `day` / `deaths` payload is the 流程性宣告
 * (procedural announcement) required by the rules and consumed by the
 * spectator store to advance day/phase/deaths — 不可关闭 per PRD.
 */

import type { GameEvent } from '@/platform/core/types'
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
  options?: { narrationEnabled?: boolean },
): Omit<GameEvent, 'matchId' | 'seq' | 'id'> | null {
  if (prev.phase === next.phase) return null
  if (next.matchComplete) return null

  // 公告本轮新出局者：夜间刀/毒在转入白天时结算，投票在转入下一夜时结算。
  // 仅死亡 fact + cause 对观战公开（夜间私动作细节仍 role-restricted 不在此处）。
  const prevAlive = new Set(prev.players.filter((p) => p.alive).map((p) => p.agentId))
  const deaths = next.players
    .filter((p) => !p.alive && prevAlive.has(p.agentId))
    .map((p) => ({ agentId: p.agentId, cause: p.deathCause }))

  // FR-4.7-01：关闭旁白时 narration 置 null（前端 store 对非字符串回退 ''），
  // 流程性字段照发。未来的 LLM 主持人 A2A 调用也应挂在这同一个开关后面。
  const narrationEnabled = options?.narrationEnabled !== false

  return {
    gameType: 'werewolf',
    occurredAt: new Date().toISOString(),
    kind: 'werewolf/moderator-narrate',
    actorAgentId: next.moderatorAgentId,
    payload: {
      upcomingPhase: next.phase,
      day: next.day,
      narration: narrationEnabled ? fallbackNarrationForPhase(next.phase) : null,
      deaths,
    },
    visibility: 'public',
    restrictedTo: null,
  }
}
