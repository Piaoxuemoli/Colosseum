// 阿瓦隆 v2 投影测试脚手架：按「冻结契约」（avalon-engine PRD AVR-5xx 的
// 前端口径）手工构造信封事件——kind = `avalon:v2:${kind}`，payload 为引擎
// 事件本体逐字段平铺（seq/round/audience/actorId/kind + 嵌套 payload），
// visibility/restrictedTo 由 audience 映射（与 werewolfEnvelope 同构）。
// 不 import src/games/avalon（前端红线：投影测试不依赖引擎真实代码）。

import type { GameEvent } from '@/platform/core/types'
import type { PokerUiPlayer } from '@/frontend/store/match-view-store'

export const MATCH_ID = 'match_avalon_projection'
export const AVALON_IDS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const
export type AvalonTestId = (typeof AVALON_IDS)[number]

/** 欺瞒 5 人板（莫甘娜在场 → 派西维尔混排可测）：p1 梅林 / p2 派西维尔 /
 * p3 忠诚仆从 / p4 刺客 / p5 莫甘娜。 */
export const AVALON_ROLES: Record<AvalonTestId, string> = {
  p1: 'merlin',
  p2: 'percival',
  p3: 'loyalServant',
  p4: 'assassin',
  p5: 'morgana',
}

export function uiPlayer(agentId: string, displayName: string, seatIndex: number): PokerUiPlayer {
  return {
    agentId,
    displayName,
    avatarEmoji: '🛡',
    seatIndex,
    chips: 0,
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }
}

export const AVALON_ROSTER: PokerUiPlayer[] = AVALON_IDS.map((id, index) => uiPlayer(id, id.toUpperCase(), index))

export type AvalonAudience =
  | { kind: 'public' }
  | { kind: 'delayed-public' }
  | { kind: 'role-self'; playerId: string }

let seqCounter = 0

export function resetAvalonSeq(): void {
  seqCounter = 0
}

export function avalonEnvelope(
  kind: string,
  payload: Record<string, unknown>,
  options: { audience?: AvalonAudience; actorId?: string | null; round?: number; seq?: number } = {},
): GameEvent {
  const audience = options.audience ?? { kind: 'public' }
  const actorId = options.actorId ?? null
  const seq = options.seq ?? ++seqCounter
  const round = options.round ?? 0
  const restrictedTo =
    audience.kind === 'public'
      ? null
      : audience.kind === 'delayed-public'
        ? ['delayed-public']
        : [`role-self:${audience.playerId}`]
  return {
    id: `av_${seq}_${kind}`,
    matchId: MATCH_ID,
    gameType: 'avalon',
    seq,
    occurredAt: new Date(1_723_000_000_000 + seq).toISOString(),
    kind: `avalon:v2:${kind}`,
    actorAgentId: actorId,
    payload: { seq, round, audience, actorId, kind, payload },
    visibility: audience.kind === 'public' ? 'public' : 'role-restricted',
    restrictedTo,
  }
}

function discussion(round: number): GameEvent[] {
  return AVALON_IDS.map((playerId) =>
    avalonEnvelope('statementIssued', { speakerId: playerId, text: `第 ${round} 轮 ${playerId} 的发言` }, {
      actorId: playerId,
      round,
    }),
  )
}

function proposalRound(
  round: number,
  attempt: number,
  leaderId: AvalonTestId,
  team: AvalonTestId[],
  approveMap: Record<string, boolean>,
  approved: boolean,
): GameEvent[] {
  const events: GameEvent[] = [
    avalonEnvelope('phaseEntered', { phase: 'proposal' }, { round }),
    avalonEnvelope('leaderAssigned', { round, attempt, leaderId }, { actorId: leaderId, round }),
    avalonEnvelope('phaseEntered', { phase: 'teamVote' }, { round }),
    avalonEnvelope('teamProposed', { round, attempt, leaderId, teamIds: team }, { actorId: leaderId, round }),
  ]
  for (const voterId of AVALON_IDS) {
    events.push(
      avalonEnvelope('voteCast', { round, attempt, voterId, approve: approveMap[voterId] ?? false }, {
        actorId: voterId,
        round,
      }),
    )
  }
  const approvals = AVALON_IDS.filter((id) => approveMap[id]).length
  events.push(
    avalonEnvelope('voteResult', { round, attempt, approvals, rejections: AVALON_IDS.length - approvals, outcome: approved ? 'approved' : 'rejected' }, { round }),
  )
  return events
}

/**
 * 整场脚本（4 轮打到好人 3:1 → 刺杀命中梅林 → 坏人翻盘）：
 * R1 成功（2 人队）；R2 第 1 次提案被拒 + 第 2 次通过但任务失败（1 张失败牌）；
 * R3 成功；R4 成功 → 好人 3 成功 → 刺杀合议（p4/p5 密谋，含多副本去重样例）→
 * p4 指认 p1（梅林）→ gameEnded（evil / 刺杀命中梅林 / 全员 reveal）。
 */
export function scriptedAvalonMatch(): GameEvent[] {
  resetAvalonSeq()
  const events: GameEvent[] = []

  // 开局：板子 + 种子 + 发牌 + 夜间知识。
  events.push(
    avalonEnvelope(
      'matchStarted',
      {
        boardId: 'deceit-5',
        boardName: '欺瞒 5 人',
        seats: AVALON_IDS.map((playerId, index) => ({ seat: index + 1, playerId })),
        questCount: 5,
        teamSizes: [2, 3, 2, 3, 3],
        doubleFailRounds: [],
        discussionEnabled: true,
        roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, morgana: 1 },
      },
    ),
    avalonEnvelope('randomnessSeed', { seed: 20260909 }, { audience: { kind: 'delayed-public' } }),
  )
  for (const playerId of AVALON_IDS) {
    events.push(
      avalonEnvelope('rolesAssigned', { role: AVALON_ROLES[playerId] }, {
        audience: { kind: 'role-self', playerId },
        actorId: playerId,
      }),
    )
  }
  events.push(
    avalonEnvelope('knowledgeRevealed', { insight: 'merlin', playerIds: ['p4', 'p5'] }, {
      audience: { kind: 'role-self', playerId: 'p1' },
      actorId: 'p1',
    }),
    avalonEnvelope('knowledgeRevealed', { insight: 'percival', playerIds: ['p1', 'p5'] }, {
      audience: { kind: 'role-self', playerId: 'p2' },
      actorId: 'p2',
    }),
    avalonEnvelope('knowledgeRevealed', { insight: 'evil', playerIds: ['p5'] }, {
      audience: { kind: 'role-self', playerId: 'p4' },
      actorId: 'p4',
    }),
    avalonEnvelope('knowledgeRevealed', { insight: 'evil', playerIds: ['p4'] }, {
      audience: { kind: 'role-self', playerId: 'p5' },
      actorId: 'p5',
    }),
  )

  // R1：讨论 → 提案通过 → 任务成功。
  events.push(avalonEnvelope('phaseEntered', { phase: 'discussion' }, { round: 1 }))
  events.push(...discussion(1))
  events.push(
    ...proposalRound(1, 1, 'p1', ['p1', 'p3'], { p1: true, p2: true, p3: true, p4: false, p5: false }, true),
    avalonEnvelope('phaseEntered', { phase: 'quest' }, { round: 1 }),
    avalonEnvelope('questChoice', { round: 1, playerId: 'p1', succeed: true }, { audience: { kind: 'role-self', playerId: 'p1' }, actorId: 'p1', round: 1 }),
    avalonEnvelope('questChoice', { round: 1, playerId: 'p3', succeed: true }, { audience: { kind: 'role-self', playerId: 'p3' }, actorId: 'p3', round: 1 }),
    avalonEnvelope('questResult', { round: 1, outcome: 'success', failVotes: 0, requiredFails: 1 }, { round: 1 }),
  )

  // R2：第 1 次提案被拒（连坐计数 1）→ 第 2 次通过 → 任务失败（1 张失败牌）。
  events.push(avalonEnvelope('phaseEntered', { phase: 'discussion' }, { round: 2 }))
  events.push(...discussion(2))
  events.push(...proposalRound(2, 1, 'p2', ['p2', 'p4', 'p5'], { p1: false, p2: true, p3: false, p4: true, p5: false }, false))
  events.push(
    ...proposalRound(2, 2, 'p3', ['p1', 'p2', 'p4'], { p1: true, p2: true, p3: true, p4: false, p5: false }, true),
    avalonEnvelope('phaseEntered', { phase: 'quest' }, { round: 2 }),
    avalonEnvelope('questChoice', { round: 2, playerId: 'p1', succeed: true }, { audience: { kind: 'role-self', playerId: 'p1' }, actorId: 'p1', round: 2 }),
    avalonEnvelope('questChoice', { round: 2, playerId: 'p2', succeed: true }, { audience: { kind: 'role-self', playerId: 'p2' }, actorId: 'p2', round: 2 }),
    avalonEnvelope('questChoice', { round: 2, playerId: 'p4', succeed: false }, { audience: { kind: 'role-self', playerId: 'p4' }, actorId: 'p4', round: 2 }),
    avalonEnvelope('questResult', { round: 2, outcome: 'fail', failVotes: 1, requiredFails: 1 }, { round: 2 }),
  )

  // R3：跳过讨论的快进形态（重提案轮无讨论的镜像样例：直接提案）→ 成功。
  events.push(
    ...proposalRound(3, 1, 'p4', ['p2', 'p3'], { p1: true, p2: true, p3: true, p4: true, p5: false }, true),
    avalonEnvelope('phaseEntered', { phase: 'quest' }, { round: 3 }),
    avalonEnvelope('questChoice', { round: 3, playerId: 'p2', succeed: true }, { audience: { kind: 'role-self', playerId: 'p2' }, actorId: 'p2', round: 3 }),
    avalonEnvelope('questChoice', { round: 3, playerId: 'p3', succeed: true }, { audience: { kind: 'role-self', playerId: 'p3' }, actorId: 'p3', round: 3 }),
    avalonEnvelope('questResult', { round: 3, outcome: 'success', failVotes: 0, requiredFails: 1 }, { round: 3 }),
  )

  // R4：成功 → 好人 3:1 赛点 → 刺杀环节。
  events.push(
    ...proposalRound(4, 1, 'p5', ['p1', 'p4', 'p5'], { p1: true, p2: true, p3: true, p4: true, p5: true }, true),
    avalonEnvelope('phaseEntered', { phase: 'quest' }, { round: 4 }),
    avalonEnvelope('questChoice', { round: 4, playerId: 'p1', succeed: true }, { audience: { kind: 'role-self', playerId: 'p1' }, actorId: 'p1', round: 4 }),
    avalonEnvelope('questChoice', { round: 4, playerId: 'p4', succeed: true }, { audience: { kind: 'role-self', playerId: 'p4' }, actorId: 'p4', round: 4 }),
    avalonEnvelope('questChoice', { round: 4, playerId: 'p5', succeed: true }, { audience: { kind: 'role-self', playerId: 'p5' }, actorId: 'p5', round: 4 }),
    avalonEnvelope('questResult', { round: 4, outcome: 'success', failVotes: 0, requiredFails: 1 }, { round: 4 }),
  )

  // 刺杀合议：p4/p5 各一条；p4 的发言按「每人一份 role-self 副本」重复下发（去重样例）。
  events.push(avalonEnvelope('phaseEntered', { phase: 'evilConsultation' }, { round: 4 }))
  events.push(
    avalonEnvelope('evilConsulted', { speakerId: 'p4', text: 'p4 密谋：我认为 p1 像梅林' }, { audience: { kind: 'role-self', playerId: 'p4' }, actorId: 'p4', round: 4 }),
    avalonEnvelope('evilConsulted', { speakerId: 'p4', text: 'p4 密谋：我认为 p1 像梅林' }, { audience: { kind: 'role-self', playerId: 'p5' }, actorId: 'p4', round: 4 }),
    avalonEnvelope('evilConsulted', { speakerId: 'p5', text: 'p5 密谋：同意，就刺 p1' }, { audience: { kind: 'role-self', playerId: 'p5' }, actorId: 'p5', round: 4 }),
  )

  // 刺杀指认：p4 → p1（梅林）→ 坏人翻盘。
  events.push(
    avalonEnvelope('phaseEntered', { phase: 'assassination' }, { round: 4 }),
    avalonEnvelope('assassinationDeclared', { assassinId: 'p4', targetId: 'p1' }, { actorId: 'p4', round: 4 }),
    avalonEnvelope(
      'gameEnded',
      {
        winner: 'evil',
        basis: '刺杀命中梅林（任务 3:1）',
        reveal: AVALON_IDS.map((playerId, index) => ({ playerId, seat: index + 1, role: AVALON_ROLES[playerId] })),
      },
      { audience: { kind: 'delayed-public' } },
    ),
  )

  return events
}
