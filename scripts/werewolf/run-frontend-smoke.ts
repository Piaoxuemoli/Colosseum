/**
 * 狼人杀前端数据层冒烟测试 —— 喂脚本化 werewolf 事件序列进 store reducer，
 * 断言 day/phase/deaths/winner/roleAssignments 推导正确。证明观战数据层
 * （moderator-narrate 携带 deaths、game-end 揭身份）端到端无误。
 *
 * 用法：tsx scripts/werewolf/run-frontend-smoke.ts   （或 npm run check:werewolf-ui）
 * 只 import 纯函数 deriveMatchView，不依赖 React/zustand 运行时。
 */
import { deriveMatchView } from '@/frontend/store/match-view-store'
import type { GameEvent } from '@/platform/core/types'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'

const PLAYERS: PokerUiPlayer[] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id, i) => ({
  agentId: id,
  displayName: `玩家${i + 1}`,
  avatarEmoji: '🐺',
  seatIndex: i,
  chips: 0,
  currentBet: 0,
  status: 'active',
  holeCards: [],
}))

let seq = 0
function ev(input: {
  kind: string
  actorAgentId: string | null
  payload: Record<string, unknown>
  occurredAt?: string
}): GameEvent {
  return {
    id: `e${seq}`,
    matchId: 'm-smoke',
    seq: seq++,
    occurredAt: input.occurredAt ?? '2026-06-16T00:00:00.000Z',
    gameType: 'werewolf',
    kind: input.kind,
    actorAgentId: input.actorAgentId,
    payload: input.payload,
    visibility: 'public',
    restrictedTo: null,
  }
}

const events: GameEvent[] = [
  // 第 1 天黎明：a1 被夜刀
  ev({
    kind: 'werewolf/moderator-narrate',
    actorAgentId: null,
    payload: { day: 1, upcomingPhase: 'day/speak', narration: '天亮了，昨夜战报将至。', deaths: [{ agentId: 'a1', cause: 'werewolfKill' }] },
  }),
  // a2 发言自称预言家
  ev({ kind: 'werewolf/speak', actorAgentId: 'a2', payload: { day: 1, content: '我是预言家，a6 是狼。', claimedRole: 'seer' } }),
  // 进入投票
  ev({ kind: 'werewolf/moderator-narrate', actorAgentId: null, payload: { day: 1, upcomingPhase: 'day/vote', narration: '全员投票。', deaths: [] } }),
  // a3 投 a4
  ev({ kind: 'werewolf/vote', actorAgentId: 'a3', payload: { day: 1, target: 'a4', reason: 'mock' } }),
  // 第 2 天黎明：a4 被票出
  ev({
    kind: 'werewolf/moderator-narrate',
    actorAgentId: null,
    payload: { day: 2, upcomingPhase: 'day/speak', narration: '天亮了，昨夜战报将至。', deaths: [{ agentId: 'a4', cause: 'vote' }] },
  }),
  // 终局：好人胜，揭身份
  ev({
    kind: 'werewolf/game-end',
    actorAgentId: null,
    payload: {
      winner: 'villagers',
      actualRoles: { a1: 'seer', a2: 'witch', a3: 'villager', a4: 'villager', a5: 'werewolf', a6: 'werewolf' },
    },
  }),
]

const view = deriveMatchView(events, { matchId: 'm-smoke', players: PLAYERS })
const ww = view.werewolf

let failures = 0
function assert(name: string, cond: boolean, detail?: string) {
  const ok = cond
  if (!ok) failures++
  console.log(`${ok ? '✓' : '❌'} ${name}${!ok && detail ? '  → ' + detail : ''}`)
}

console.log('Werewolf 前端 reducer 冒烟测试\n')
assert('day 推进到 2', ww.day === 2, `day=${ww.day}`)
assert('phase 为最后 narrate 的 day/speak', ww.phase === 'day/speak', `phase=${ww.phase}`)
assert('deaths 含 a1(夜刀)', ww.deaths.some((d) => d.agentId === 'a1' && d.cause === 'werewolfKill'), JSON.stringify(ww.deaths))
assert('deaths 含 a4(票出)', ww.deaths.some((d) => d.agentId === 'a4' && d.cause === 'vote'), JSON.stringify(ww.deaths))
assert('deaths 去重后共 2 条', ww.deaths.length === 2, `len=${ww.deaths.length}`)
assert('speechLog 含 a2 自称预言家', ww.speechLog.some((s) => s.agentId === 'a2' && s.claimedRole === 'seer'))
assert('voteLog 含 a3→a4', ww.voteLog.some((v) => v.voter === 'a3' && v.target === 'a4'))
assert('moderatorNarration 共 3 条', ww.moderatorNarration.length === 3, `len=${ww.moderatorNarration.length}`)
assert('moderatorNarration 含投票公告', ww.moderatorNarration.some((n) => n.phase === 'day/vote'))
assert('winner = villagers', ww.winner === 'villagers', `winner=${ww.winner}`)
assert('roleAssignments 已揭示', ww.roleAssignments?.a5 === 'werewolf')
assert('matchComplete = true', view.matchComplete === true)
assert('currentActor 清空', view.currentActor === null)

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`)
  process.exit(1)
}
console.log('\n前端 reducer 冒烟测试通过 ✓')
