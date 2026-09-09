// Avalon engine v2 — the phase machine（proposal → teamVote → quest 循环）。
//
// 此处函数只变更 Ctx 内已克隆的 state；engine 入口先克隆再进入。事件
// append-only、seq 单调。冒烟规格：3 轮任务、队伍 2 人、同轮第 3 次拒绝
// 直接判失败、先拿 2 个任务结果者胜。

import type {
  ActionRejection,
  AvalonAction,
  AvalonEngineState,
  AvalonEvent,
  AvalonEventKind,
  EventPayloadMap,
  Audience,
  PhaseId,
  RejectionCode,
} from './types'
import { MAX_REJECTIONS, QUEST_COUNT, TEAM_SIZE, factionOf } from './types'
import { makeEvent } from './events'

export interface Ctx {
  state: AvalonEngineState
  events: AvalonEvent[]
}

// ---------------------------------------------------------------------------
// Event / phase primitives
// ---------------------------------------------------------------------------

export function emitEvent<K extends AvalonEventKind>(
  ctx: Ctx,
  kind: K,
  audience: Audience,
  actorId: string | null,
  payload: EventPayloadMap[K],
  extra?: { isDefault?: boolean; action?: AvalonAction },
): void {
  ctx.events.push(
    makeEvent({
      seq: ctx.state.nextSeq++,
      day: ctx.state.round,
      kind,
      audience,
      actorId,
      payload,
      isDefault: extra?.isDefault,
      action: extra?.action,
    }),
  )
}

/** 每次阶段切换发公开 phaseEntered 事件。 */
function setPhase(ctx: Ctx, phase: PhaseId): void {
  if (ctx.state.phase !== phase) {
    ctx.state.phase = phase
    emitEvent(ctx, 'phaseEntered', { kind: 'public' }, null, { phase })
  }
}

function bySeatIds(state: AvalonEngineState, ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => seatOf(state, a) - seatOf(state, b))
}

export function seatOf(state: AvalonEngineState, playerId: string): number {
  return state.players.find((player) => player.playerId === playerId)?.seat ?? Number.MAX_SAFE_INTEGER
}

/** 下一个轮值队长座位（按座位 +1 循环轮转）。 */
function rotateLeaderSeat(state: AvalonEngineState): number {
  return (state.leaderSeat % state.players.length) + 1
}

function leaderIdOf(state: AvalonEngineState): string {
  const leader = state.players.find((player) => player.seat === state.leaderSeat)
  if (!leader) throw new Error(`avalon engine2: no player at leader seat ${state.leaderSeat}`)
  return leader.playerId
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

/** 进入下一轮：轮转队长 → 提名阶段（attempt 重置为 1）。 */
export function startRound(ctx: Ctx): void {
  const state = ctx.state
  state.round += 1
  state.attempt = 1
  state.leaderSeat = rotateLeaderSeat(state)
  state.proposal = null
  state.voteRound = null
  state.quest = null
  setPhase(ctx, 'proposal')
  const leaderId = leaderIdOf(state)
  state.pendingActor = leaderId
  emitEvent(ctx, 'leaderAssigned', { kind: 'public' }, null, {
    round: state.round,
    attempt: 1,
    leaderId,
  })
}

/** 同轮被拒后的重新提案：队长轮转一位、attempt + 1。 */
function restartProposal(ctx: Ctx): void {
  const state = ctx.state
  state.leaderSeat = rotateLeaderSeat(state)
  state.attempt += 1
  const attempt = state.attempt
  state.proposal = null
  state.voteRound = null
  setPhase(ctx, 'proposal')
  const leaderId = leaderIdOf(state)
  state.pendingActor = leaderId
  emitEvent(ctx, 'leaderAssigned', { kind: 'public' }, null, {
    round: state.round,
    attempt,
    leaderId,
  })
}

/** 终局：写入 outcome、清空进行面、阶段切 ended、发终局揭示（delayed-public）。 */
export function finishMatch(ctx: Ctx, winner: 'good' | 'evil' | 'tie', basis: string): void {
  const state = ctx.state
  state.outcome = { winner, basis }
  state.proposal = null
  state.voteRound = null
  state.quest = null
  state.pendingActor = null
  setPhase(ctx, 'ended')
  emitEvent(ctx, 'gameEnded', { kind: 'delayed-public' }, null, {
    winner,
    basis,
    reveal: state.players.map((player) => ({
      playerId: player.playerId,
      seat: player.seat,
      role: player.role,
    })),
  })
}

export function successCount(state: AvalonEngineState): number {
  return state.results.filter((result) => result.outcome === 'success').length
}

export function failCount(state: AvalonEngineState): number {
  return state.results.filter((result) => result.outcome === 'fail').length
}

/** 任务结算后：先到 2 胜即终局；否则进入下一轮。 */
function resolveQuest(ctx: Ctx): void {
  const state = ctx.state
  const successes = successCount(state)
  const fails = failCount(state)
  if (successes >= 2) {
    finishMatch(ctx, 'good', `quests:${successes}-${fails}`)
    return
  }
  if (fails >= 2) {
    finishMatch(ctx, 'evil', `quests:${successes}-${fails}`)
    return
  }
  if (state.round >= QUEST_COUNT) {
    // 防御分支：先到 2 规则下 3 轮必分胜负，此路径正常不可达。
    finishMatch(ctx, successes > fails ? 'good' : 'evil', `quests:majority-${successes}-${fails}`)
    return
  }
  startRound(ctx)
}

// ---------------------------------------------------------------------------
// Validation（结构化拒绝）
// ---------------------------------------------------------------------------

function rejectionOf(
  state: AvalonEngineState,
  action: { actorId: string; type: string },
  code: RejectionCode,
  message: string,
): ActionRejection {
  return {
    code,
    message,
    context: { round: state.round, phase: state.phase, actorId: action.actorId, actionType: action.type },
  }
}

export type Validation = { ok: true } | { ok: false; rejection: ActionRejection }

export function validateAction(state: AvalonEngineState, action: AvalonAction): Validation {
  switch (action.type) {
    case 'proposeTeam': {
      if (state.phase !== 'proposal') {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_PHASE', `proposeTeam 仅在提名阶段合法（当前 ${state.phase}）`) }
      }
      if (state.pendingActor !== action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_ACTOR', `当前轮值队长是 ${state.pendingActor ?? '(无)'}`) }
      }
      const [a, b] = action.targetIds
      if (new Set(action.targetIds).size !== TEAM_SIZE || a === b) {
        return { ok: false, rejection: rejectionOf(state, action, 'ILLEGAL_TARGET', '队伍必须为 2 名互不相同的玩家') }
      }
      for (const target of action.targetIds) {
        if (!state.players.some((player) => player.playerId === target)) {
          return { ok: false, rejection: rejectionOf(state, action, 'ILLEGAL_TARGET', `目标不在名册内: ${target}`) }
        }
      }
      return { ok: true }
    }
    case 'vote': {
      if (state.phase !== 'teamVote') {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_PHASE', `vote 仅在表决阶段合法（当前 ${state.phase}）`) }
      }
      if (state.pendingActor !== action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_ACTOR', `当前投票人是 ${state.pendingActor ?? '(无)'}`) }
      }
      return { ok: true }
    }
    case 'quest': {
      if (state.phase !== 'quest') {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_PHASE', `quest 仅在任务阶段合法（当前 ${state.phase}）`) }
      }
      if (state.pendingActor !== action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_ACTOR', `当前抉择者是 ${state.pendingActor ?? '(无)'}`) }
      }
      const actor = state.players.find((player) => player.playerId === action.actorId)
      if (!action.succeed && actor && factionOf(actor.role) === 'good') {
        return { ok: false, rejection: rejectionOf(state, action, 'ILLEGAL_CHOICE', '好人只能选择任务成功') }
      }
      return { ok: true }
    }
  }
}

// ---------------------------------------------------------------------------
// Action application（只变更已克隆 state）
// ---------------------------------------------------------------------------

export function applyActionToCtx(ctx: Ctx, action: AvalonAction, isDefault: boolean): void {
  switch (action.type) {
    case 'proposeTeam':
      applyProposeTeam(ctx, action, isDefault)
      return
    case 'vote':
      applyVote(ctx, action, isDefault)
      return
    case 'quest':
      applyQuest(ctx, action, isDefault)
      return
  }
}

function applyProposeTeam(ctx: Ctx, action: Extract<AvalonAction, { type: 'proposeTeam' }>, isDefault: boolean): void {
  const state = ctx.state
  const proposal = {
    round: state.round,
    attempt: state.attempt,
    leaderId: action.actorId,
    teamIds: bySeatIds(state, action.targetIds),
  }
  state.proposal = proposal
  emitEvent(ctx, 'teamProposed', { kind: 'public' }, action.actorId, {
    round: proposal.round,
    attempt: proposal.attempt,
    leaderId: proposal.leaderId,
    teamIds: [...proposal.teamIds],
  }, { isDefault, action })
  state.voteRound = {
    round: proposal.round,
    attempt: proposal.attempt,
    queue: [...state.players].sort((a, b) => a.seat - b.seat).map((player) => player.playerId),
    cast: [],
  }
  setPhase(ctx, 'teamVote')
  state.pendingActor = state.voteRound.queue[0] ?? null
}

function applyVote(ctx: Ctx, action: Extract<AvalonAction, { type: 'vote' }>, isDefault: boolean): void {
  const state = ctx.state
  const voteRound = state.voteRound
  if (!voteRound) throw new Error('avalon engine2: vote cast outside a vote batch')
  voteRound.cast.push({ voterId: action.actorId, approve: action.approve })
  voteRound.queue = voteRound.queue.slice(1)
  emitEvent(ctx, 'voteCast', { kind: 'role-self', playerId: action.actorId }, action.actorId, {
    round: voteRound.round,
    attempt: voteRound.attempt,
    voterId: action.actorId,
    approve: action.approve,
  }, { isDefault, action })

  if (voteRound.queue.length > 0) {
    state.pendingActor = voteRound.queue[0]
    return
  }

  // 全员投完 → 汇总（公共：计数与结果，不点名）
  const approvals = voteRound.cast.filter((vote) => vote.approve).length
  const rejections = voteRound.cast.length - approvals
  const approved = approvals > rejections
  const round = voteRound.round
  const attempt = voteRound.attempt
  state.voteRound = null
  emitEvent(ctx, 'voteResult', { kind: 'public' }, null, {
    round,
    attempt,
    approvals,
    rejections,
    outcome: approved ? 'approved' : 'rejected',
  })

  if (approved) {
    const proposal = state.proposal
    if (!proposal) throw new Error('avalon engine2: approved vote without a proposal')
    state.quest = {
      round,
      teamIds: [...proposal.teamIds],
      queue: bySeatIds(state, proposal.teamIds),
      choices: [],
    }
    setPhase(ctx, 'quest')
    state.pendingActor = state.quest.queue[0] ?? null
    return
  }

  if (attempt >= MAX_REJECTIONS) {
    // 同一轮第 3 次拒绝 → 该任务直接判失败（防死锁），不经任务阶段。
    state.results.push({ round, outcome: 'fail', failVotes: 0, autoFailed: true })
    emitEvent(ctx, 'questResult', { kind: 'public' }, null, {
      round,
      outcome: 'fail',
      failVotes: 0,
      autoFailed: true,
    })
    state.proposal = null
    resolveQuest(ctx)
    return
  }

  restartProposal(ctx)
}

function applyQuest(ctx: Ctx, action: Extract<AvalonAction, { type: 'quest' }>, isDefault: boolean): void {
  const state = ctx.state
  const quest = state.quest
  if (!quest) throw new Error('avalon engine2: quest choice outside a quest batch')
  quest.choices.push({ playerId: action.actorId, succeed: action.succeed })
  quest.queue = quest.queue.slice(1)
  emitEvent(ctx, 'questChoice', { kind: 'role-self', playerId: action.actorId }, action.actorId, {
    round: quest.round,
    playerId: action.actorId,
    succeed: action.succeed,
  }, { isDefault, action })

  if (quest.queue.length > 0) {
    state.pendingActor = quest.queue[0]
    return
  }

  const failVotes = quest.choices.filter((choice) => !choice.succeed).length
  const outcome: 'success' | 'fail' = failVotes > 0 ? 'fail' : 'success'
  const round = quest.round
  state.results.push({ round, outcome, failVotes, autoFailed: false })
  emitEvent(ctx, 'questResult', { kind: 'public' }, null, {
    round,
    outcome,
    failVotes,
    autoFailed: false,
  })
  state.quest = null
  state.proposal = null
  resolveQuest(ctx)
}

// ---------------------------------------------------------------------------
// Force end（plugin terminateImmediately 的引擎侧实现）
// ---------------------------------------------------------------------------

/** 按当前任务战绩裁一个强制终局（多者胜；持平为平局）。 */
export function forceEndOutcome(state: AvalonEngineState): { winner: 'good' | 'evil' | 'tie'; basis: string } {
  const successes = successCount(state)
  const fails = failCount(state)
  if (successes > fails) return { winner: 'good', basis: `terminated-immediate:quests-${successes}-${fails}` }
  if (fails > successes) return { winner: 'evil', basis: `terminated-immediate:quests-${successes}-${fails}` }
  return { winner: 'tie', basis: `terminated-immediate:quests-${successes}-${fails}` }
}
