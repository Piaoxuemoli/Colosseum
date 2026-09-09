// Avalon engine v2 — the phase machine（AVR-102 阶段图全量）。
//
//   轮 R（attempt 1）：讨论（每轮仅首次提案前，AVR-OD-3a）→ 提名 → 表决
//   →（通过）任务执行 → 结算 → 下一轮；
//   表决被拒 → 同轮重新提案（队长轮转、跳过讨论）；
//   同轮第 5 次拒绝 → 坏人直接胜（连坐，任务不算失败，AVR-403）；
//   好人 3 任务成功 → 刺杀合议（坏人座位序）→ 刺杀指认 → 裁决（AVR-106）。
//
// 此处函数只变更 Ctx 内已克隆的 state；engine 入口先克隆再进入。事件
// append-only、seq 单调（AVR-501/504）。

import type {
  ActionRejection,
  AvalonAction,
  AvalonEngineState,
  AvalonEvent,
  AvalonEventKind,
  EventPayloadMap,
  Audience,
  PhaseId,
  PlayerSlot,
  RejectionCode,
} from './types'
import { MAX_REJECTIONS, QUEST_COUNT, TEXT_MAX_LENGTH, TEXT_MIN_LENGTH, WINS_REQUIRED, factionOf } from './types'
import { requiredFailsOf } from './board'
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

/** 每次阶段切换发公开 phaseEntered 事件（AVR-502 #5）。 */
function setPhase(ctx: Ctx, phase: PhaseId): void {
  if (ctx.state.phase !== phase) {
    ctx.state.phase = phase
    emitEvent(ctx, 'phaseEntered', { kind: 'public' }, null, { phase })
  }
}

export function seatOf(state: AvalonEngineState, playerId: string): number {
  return state.players.find((player) => player.playerId === playerId)?.seat ?? Number.MAX_SAFE_INTEGER
}

export function playerById(state: AvalonEngineState, playerId: string): PlayerSlot | undefined {
  return state.players.find((player) => player.playerId === playerId)
}

function bySeatIds(state: AvalonEngineState, ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => seatOf(state, a) - seatOf(state, b))
}

/** 下一个轮值队长座位（按座位 +1 循环轮转，AVR-104）。 */
function rotateLeaderSeat(state: AvalonEngineState): number {
  return (state.leaderSeat % state.players.length) + 1
}

function leaderIdOf(state: AvalonEngineState): string {
  const leader = state.players.find((player) => player.seat === state.leaderSeat)
  if (!leader) throw new Error(`avalon engine2: no player at leader seat ${state.leaderSeat}`)
  return leader.playerId
}

export function evilPlayers(state: AvalonEngineState): PlayerSlot[] {
  return state.players.filter((player) => factionOf(player.role) === 'evil')
}

/**
 * 刺杀权持有者（AVR-OD-1b）：刺客角色；板子无刺客卡时由座位序第一名坏人代行。
 */
export function assassinationHolderId(state: AvalonEngineState): string {
  const assassin = state.players.find((player) => player.role === 'assassin')
  if (assassin) return assassin.playerId
  const firstEvil = [...evilPlayers(state)].sort((a, b) => a.seat - b.seat)[0]
  if (!firstEvil) throw new Error('avalon engine2: board has no evil player to hold the assassination')
  return firstEvil.playerId
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

/** 指定轮值队长（公共事件，AVR-502 #6）。 */
function assignLeader(ctx: Ctx): void {
  const state = ctx.state
  const leaderId = leaderIdOf(state)
  state.pendingActor = leaderId
  emitEvent(ctx, 'leaderAssigned', { kind: 'public' }, null, {
    round: state.round,
    attempt: state.attempt,
    leaderId,
  })
}

/** 进入提名阶段（讨论结束或被跳过后）。 */
function enterProposal(ctx: Ctx): void {
  setPhase(ctx, 'proposal')
  assignLeader(ctx)
}

/**
 * 进入下一轮：轮转队长 → attempt 重置 1 → 讨论阶段（板子开启且为首次提案，
 * AVR-OD-3a）或直接提名。leaderAssigned 只在进入提名时发出（每次提案恰一条，
 * AVR-104）。
 */
export function startRound(ctx: Ctx): void {
  const state = ctx.state
  state.round += 1
  state.attempt = 1
  state.leaderSeat = rotateLeaderSeat(state)
  state.discussion = null
  state.proposal = null
  state.voteRound = null
  state.quest = null

  if (state.board.discussionEnabled) {
    setPhase(ctx, 'discussion')
    const queue = [...state.players].sort((a, b) => a.seat - b.seat).map((player) => player.playerId)
    state.discussion = { round: state.round, queue }
    state.pendingActor = queue[0] ?? null
    return
  }
  enterProposal(ctx)
}

/** 同轮被拒后的重新提案：队长轮转一位、attempt + 1、跳过讨论（AVR-OD-3a）。 */
function restartProposal(ctx: Ctx): void {
  const state = ctx.state
  state.leaderSeat = rotateLeaderSeat(state)
  state.attempt += 1
  state.discussion = null
  state.proposal = null
  state.voteRound = null
  setPhase(ctx, 'proposal')
  assignLeader(ctx)
}

// ---------------------------------------------------------------------------
// 终局（AVR-404 / AVR-502 #15）
// ---------------------------------------------------------------------------

export function successCount(state: AvalonEngineState): number {
  return state.results.filter((result) => result.outcome === 'success').length
}

export function failCount(state: AvalonEngineState): number {
  return state.results.filter((result) => result.outcome === 'fail').length
}

/** 终局：写入 outcome、清空进行面、阶段切 ended、发终局揭示（delayed-public）。 */
export function finishMatch(ctx: Ctx, winner: 'good' | 'evil' | 'tie', basis: string): void {
  const state = ctx.state
  state.outcome = { winner, basis }
  state.discussion = null
  state.proposal = null
  state.voteRound = null
  state.quest = null
  state.consultation = null
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

/**
 * 任务结算后的裁决推进（AVR-401/404）：坏人 3 失败直接胜（无刺杀环节）；
 * 好人 3 成功进入刺杀环节（合议 → 指认）；否则下一轮。
 */
function resolveQuest(ctx: Ctx): void {
  const state = ctx.state
  const successes = successCount(state)
  const fails = failCount(state)
  if (fails >= WINS_REQUIRED) {
    finishMatch(ctx, 'evil', `quests:${successes}-${fails}`)
    return
  }
  if (successes >= WINS_REQUIRED) {
    enterEvilConsultation(ctx)
    return
  }
  if (state.round >= QUEST_COUNT) {
    // 防御分支：5 轮 3 胜制下鸽笼原理保证必有一方 ≥3，此路径正常不可达。
    finishMatch(
      ctx,
      successes > fails ? 'good' : 'evil',
      `quests:majority-${successes}-${fails}`,
    )
    return
  }
  startRound(ctx)
}

/** 刺杀环节第一步：坏人秘密合议（座位序逐人，AVR-106）。 */
function enterEvilConsultation(ctx: Ctx): void {
  const state = ctx.state
  const queue = [...evilPlayers(state)].sort((a, b) => a.seat - b.seat).map((player) => player.playerId)
  state.discussion = null
  state.proposal = null
  state.voteRound = null
  state.quest = null
  state.consultation = { queue }
  if (queue.length === 0) {
    // 防御分支：板子必有坏人（阵营配比校验），此路径正常不可达。
    enterAssassination(ctx)
    return
  }
  setPhase(ctx, 'evilConsultation')
  state.pendingActor = queue[0]
}

/** 刺杀环节第二步：刺杀权持有者指认（AVR-106 / AVR-OD-1b）。 */
function enterAssassination(ctx: Ctx): void {
  const state = ctx.state
  state.consultation = null
  setPhase(ctx, 'assassination')
  state.pendingActor = assassinationHolderId(state)
}

// ---------------------------------------------------------------------------
// Validation（结构化拒绝，AVR-302）
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

export interface ValidateOptions {
  /** 引擎默认动作（AVR-304）：speak/consult 的跳过允许空文本，其余口径不变。 */
  isDefault?: boolean
}

function validateText(state: AvalonEngineState, action: { actorId: string; type: string }, text: string, options?: ValidateOptions): Validation {
  if (options?.isDefault === true && text.length === 0) return { ok: true }
  if (text.length < TEXT_MIN_LENGTH || text.length > TEXT_MAX_LENGTH) {
    return {
      ok: false,
      rejection: rejectionOf(
        state,
        action,
        'ILLEGAL_CHOICE',
        `文本长度必须在 ${TEXT_MIN_LENGTH}–${TEXT_MAX_LENGTH} 字之间（当前 ${text.length}）`,
      ),
    }
  }
  return { ok: true }
}

export function validateAction(state: AvalonEngineState, action: AvalonAction, options?: ValidateOptions): Validation {
  switch (action.type) {
    case 'speak': {
      if (state.phase !== 'discussion') {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_PHASE', `speak 仅在讨论阶段合法（当前 ${state.phase}）`) }
      }
      if (state.pendingActor !== action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_ACTOR', `当前发言人是 ${state.pendingActor ?? '(无)'}`) }
      }
      return validateText(state, action, action.text, options)
    }
    case 'proposeTeam': {
      if (state.phase !== 'proposal') {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_PHASE', `proposeTeam 仅在提名阶段合法（当前 ${state.phase}）`) }
      }
      if (state.pendingActor !== action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_ACTOR', `当前轮值队长是 ${state.pendingActor ?? '(无)'}`) }
      }
      const teamSize = state.board.teamSizes[state.round - 1]
      if (teamSize === undefined) {
        return { ok: false, rejection: rejectionOf(state, action, 'PARAM_CONFLICT', `轮次 ${state.round} 无任务人数配置`) }
      }
      if (action.targetIds.length !== teamSize || new Set(action.targetIds).size !== teamSize) {
        return {
          ok: false,
          rejection: rejectionOf(state, action, 'ILLEGAL_TARGET', `队伍必须为 ${teamSize} 名互不相同的玩家`),
        }
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
      const actor = playerById(state, action.actorId)
      if (!action.succeed && actor && factionOf(actor.role) === 'good') {
        return { ok: false, rejection: rejectionOf(state, action, 'ILLEGAL_CHOICE', '好人只能选择任务成功') }
      }
      return { ok: true }
    }
    case 'consult': {
      if (state.phase !== 'evilConsultation') {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_PHASE', `consult 仅在刺杀合议阶段合法（当前 ${state.phase}）`) }
      }
      if (state.pendingActor !== action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_ACTOR', `当前合议者是 ${state.pendingActor ?? '(无)'}`) }
      }
      return validateText(state, action, action.text, options)
    }
    case 'assassinate': {
      if (state.phase !== 'assassination') {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_PHASE', `assassinate 仅在刺杀指认阶段合法（当前 ${state.phase}）`) }
      }
      if (state.pendingActor !== action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'WRONG_ACTOR', `当前刺杀权持有者是 ${state.pendingActor ?? '(无)'}`) }
      }
      if (!state.players.some((player) => player.playerId === action.targetId)) {
        return { ok: false, rejection: rejectionOf(state, action, 'ILLEGAL_TARGET', `指认目标不在名册内: ${action.targetId}`) }
      }
      if (action.targetId === action.actorId) {
        return { ok: false, rejection: rejectionOf(state, action, 'ILLEGAL_TARGET', '指认目标不能是刺杀者本人') }
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
    case 'speak':
      applySpeak(ctx, action, isDefault)
      return
    case 'proposeTeam':
      applyProposeTeam(ctx, action, isDefault)
      return
    case 'vote':
      applyVote(ctx, action, isDefault)
      return
    case 'quest':
      applyQuest(ctx, action, isDefault)
      return
    case 'consult':
      applyConsult(ctx, action, isDefault)
      return
    case 'assassinate':
      applyAssassinate(ctx, action, isDefault)
      return
  }
}

function applySpeak(
  ctx: Ctx,
  action: Extract<AvalonAction, { type: 'speak' }>,
  isDefault: boolean,
): void {
  const state = ctx.state
  const discussion = state.discussion
  if (!discussion) throw new Error('avalon engine2: speak outside a discussion batch')
  if (discussion.queue[0] === action.actorId) discussion.queue = discussion.queue.slice(1)
  state.statementLog.push(action.actorId)
  emitEvent(
    ctx,
    'statementIssued',
    { kind: 'public' },
    action.actorId,
    { speakerId: action.actorId, text: action.text },
    { isDefault, action },
  )
  if (discussion.queue.length > 0) {
    state.pendingActor = discussion.queue[0]
    return
  }
  state.discussion = null
  enterProposal(ctx)
}

function applyProposeTeam(
  ctx: Ctx,
  action: Extract<AvalonAction, { type: 'proposeTeam' }>,
  isDefault: boolean,
): void {
  const state = ctx.state
  const proposal = {
    round: state.round,
    attempt: state.attempt,
    leaderId: action.actorId,
    teamIds: bySeatIds(state, action.targetIds),
  }
  state.proposal = proposal
  emitEvent(
    ctx,
    'teamProposed',
    { kind: 'public' },
    action.actorId,
    {
      round: proposal.round,
      attempt: proposal.attempt,
      leaderId: proposal.leaderId,
      teamIds: [...proposal.teamIds],
    },
    { isDefault, action },
  )
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
  // AVR-107 口径变更：公开记名 —「投票人 + 立场」公共事件。
  emitEvent(
    ctx,
    'voteCast',
    { kind: 'public' },
    action.actorId,
    {
      round: voteRound.round,
      attempt: voteRound.attempt,
      voterId: action.actorId,
      approve: action.approve,
    },
    { isDefault, action },
  )

  if (voteRound.queue.length > 0) {
    state.pendingActor = voteRound.queue[0]
    return
  }

  // 全员投完 → 汇总（赞成严格多于反对 = 通过；平票 = 否决，AVR-107）。
  const approvals = voteRound.cast.filter((vote) => vote.approve).length
  const rejections = voteRound.cast.length - approvals
  const approved = approvals > rejections
  const round = voteRound.round
  const attempt = voteRound.attempt
  state.voteHistory.push({ round, attempt, cast: [...voteRound.cast] })
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
    // AVR-403 连坐：同轮第 5 次提案被拒 → 坏人直接胜（不进任务、任务不算失败）。
    finishMatch(ctx, 'evil', `connective-rejection:round-${round}`)
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
  emitEvent(
    ctx,
    'questChoice',
    { kind: 'role-self', playerId: action.actorId },
    action.actorId,
    {
      round: quest.round,
      playerId: action.actorId,
      succeed: action.succeed,
    },
    { isDefault, action },
  )

  if (quest.queue.length > 0) {
    state.pendingActor = quest.queue[0]
    return
  }

  // AVR-401/402：失败张数 ≥ 阈值（普通轮 1 / 双失败轮 2）→ 失败；只公布张数。
  const failVotes = quest.choices.filter((choice) => !choice.succeed).length
  const requiredFails = requiredFailsOf(state.board, quest.round)
  const outcome: 'success' | 'fail' = failVotes >= requiredFails ? 'fail' : 'success'
  const round = quest.round
  state.results.push({ round, outcome, failVotes, requiredFails })
  emitEvent(ctx, 'questResult', { kind: 'public' }, null, {
    round,
    outcome,
    failVotes,
    requiredFails,
  })
  state.quest = null
  state.proposal = null
  resolveQuest(ctx)
}

function applyConsult(
  ctx: Ctx,
  action: Extract<AvalonAction, { type: 'consult' }>,
  isDefault: boolean,
): void {
  const state = ctx.state
  const consultation = state.consultation
  if (!consultation) throw new Error('avalon engine2: consult outside a consultation batch')
  if (consultation.queue[0] === action.actorId) consultation.queue = consultation.queue.slice(1)

  // 坏人互见（AVR-502 #8 脚注）：每条合议发给全部坏人各自 role-self 副本；
  // 发言人本人的副本锚定原动作（重放只应用一次），其余副本为派生事实。
  const evils = [...evilPlayers(state)].sort((a, b) => a.seat - b.seat)
  for (const evil of evils) {
    const isSpeaker = evil.playerId === action.actorId
    emitEvent(
      ctx,
      'evilConsulted',
      { kind: 'role-self', playerId: evil.playerId },
      action.actorId,
      { speakerId: action.actorId, text: action.text },
      { isDefault, action: isSpeaker ? action : undefined },
    )
  }

  if (consultation.queue.length > 0) {
    state.pendingActor = consultation.queue[0]
    return
  }
  enterAssassination(ctx)
}

function applyAssassinate(
  ctx: Ctx,
  action: Extract<AvalonAction, { type: 'assassinate' }>,
  isDefault: boolean,
): void {
  const state = ctx.state
  const target = playerById(state, action.targetId)
  if (!target) throw new Error('avalon engine2: assassination target not in roster')
  const hitMerlin = target.role === 'merlin'
  state.assassination = { assassinId: action.actorId, targetId: action.targetId, hitMerlin }
  emitEvent(
    ctx,
    'assassinationDeclared',
    { kind: 'public' },
    action.actorId,
    { assassinId: action.actorId, targetId: action.targetId },
    { isDefault, action },
  )

  const successes = successCount(state)
  const fails = failCount(state)
  if (hitMerlin) {
    // AVR-106：指认梅林 → 坏人翻盘获胜（终局依据注明刺杀翻盘）。
    finishMatch(ctx, 'evil', `quests:${successes}-${fails};assassination-hit`)
    return
  }
  finishMatch(ctx, 'good', `quests:${successes}-${fails};assassination-miss`)
}

// ---------------------------------------------------------------------------
// Force end（plugin terminateImmediately 的引擎侧实现，AVR-405）
// ---------------------------------------------------------------------------

/** 按当前任务战绩裁一个强制终局（多者胜；0:0 平局并注明强制终结）。 */
export function forceEndOutcome(state: AvalonEngineState): { winner: 'good' | 'evil' | 'tie'; basis: string } {
  const successes = successCount(state)
  const fails = failCount(state)
  if (successes > fails) return { winner: 'good', basis: `terminated-immediate:quests-${successes}-${fails}` }
  if (fails > successes) return { winner: 'evil', basis: `terminated-immediate:quests-${successes}-${fails}` }
  return { winner: 'tie', basis: `terminated-immediate:quests-${successes}-${fails}` }
}
