// Avalon engine v2 — public engine facade.
//
//   applyAction(state, action)  → { state, events } | { rejection }
//   applyDefaultAction(state)   → 兜底/超时驱动（提案=自己+下家 / 表决=赞成 / 任务=成功）
//   availableActions(state, id) → 机器可读动作契约
//   reduceEvents(events)        → 事件流重放（确定性：种子入流）
//
// Deterministic & side-effect free：输入 state 永不被变更（每步都 structuredClone）。

import type {
  ActionOption,
  ActionRejection,
  ApplyOutcome,
  AvalonAction,
  AvalonEngineState,
  AvalonEvent,
  CreateMatchResult,
  RejectionCode,
} from './types'
import { engineActionSchema } from './types'
import { factionOf, TEAM_SIZE } from './types'
import { applyActionToCtx, finishMatch, forceEndOutcome, validateAction, type Ctx } from './phases'
import { createMatchFromSeating } from './setup'
import type { AvalonRoleId } from './types'

function rejectWith(
  state: AvalonEngineState,
  action: { actorId: string; type: string },
  code: RejectionCode,
  message: string,
): ApplyOutcome {
  const rejection: ActionRejection = {
    code,
    message,
    context: {
      round: state.round,
      phase: state.phase,
      actorId: action.actorId,
      actionType: action.type,
    },
  }
  return { status: 'rejected', rejection }
}

/**
 * 动作归一化边界：上游适配器把 LLM 输出翻译成标准动作，引擎只裁决标准形；
 * 任何畸形输入都成为结构化 UNPARSEABLE 拒绝而非异常。
 */
export function normalizeAction(raw: unknown): { ok: true; action: AvalonAction } | { ok: false; rejection: ActionRejection } {
  const parsed = engineActionSchema.safeParse(raw)
  if (parsed.success) return { ok: true, action: parsed.data }
  return {
    ok: false,
    rejection: {
      code: 'UNPARSEABLE',
      message: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
      context: { round: -1, phase: 'ended', actorId: '(unknown)', actionType: '(unknown)' },
    },
  }
}

/** 校验并应用一个动作；被拒动作不改变状态。 */
export function applyAction(state: AvalonEngineState, action: AvalonAction): ApplyOutcome {
  return applyActionInternal(state, action, false)
}

function applyActionInternal(state: AvalonEngineState, action: AvalonAction, isDefault: boolean): ApplyOutcome {
  const normalized = normalizeAction(action)
  if (!normalized.ok) return { status: 'rejected', rejection: normalized.rejection }

  const validation = validateAction(state, normalized.action)
  if (!validation.ok) return { status: 'rejected', rejection: validation.rejection }

  const next: AvalonEngineState = structuredClone(state)
  const ctx: Ctx = { state: next, events: [] }
  applyActionToCtx(ctx, normalized.action, isDefault)
  return { status: 'accepted', state: next, events: ctx.events }
}

/**
 * 每个行动槽位的无响应默认：提案 = 自己 + 下家；表决 = 赞成；任务 = 成功。
 * 默认产生的事件带 isDefault=true（通用动作流的兜底角标）。
 */
export function applyDefaultAction(state: AvalonEngineState): ApplyOutcome {
  const actor = state.pendingActor
  if (actor === null) {
    return rejectWith(state, { actorId: '-', type: '(default)' }, 'WRONG_PHASE', 'no pending actor to default')
  }
  let action: AvalonAction
  switch (state.phase) {
    case 'proposal': {
      const seat = state.players.find((player) => player.playerId === actor)?.seat ?? 1
      const nextSeat = (seat % state.players.length) + 1
      const nextId = state.players.find((player) => player.seat === nextSeat)?.playerId
      if (!nextId) {
        return rejectWith(state, { actorId: actor, type: '(default)' }, 'ILLEGAL_TARGET', 'no next seat to default')
      }
      action = { type: 'proposeTeam', actorId: actor, targetIds: [actor, nextId] }
      break
    }
    case 'teamVote':
      action = { type: 'vote', actorId: actor, approve: true }
      break
    case 'quest':
      action = { type: 'quest', actorId: actor, succeed: true }
      break
    default:
      return rejectWith(state, { actorId: actor, type: '(default)' }, 'WRONG_PHASE', `phase ${state.phase} has no default action`)
  }
  return applyActionInternal(state, action, true)
}

/** 引擎下一步应提示的 agent（自动推进/终局时为 null）。 */
export function currentActor(state: AvalonEngineState): string | null {
  return state.pendingActor
}

/**
 * 单个玩家的机器可读动作契约：当前可以合法提交什么。
 * quest 的可选项按阵营收窄（好人只有 success）——这是行动者自己的信息，
 * 不泄露他人身份。
 */
export function availableActions(state: AvalonEngineState, playerId: string): ActionOption[] {
  if (state.pendingActor !== playerId) return []
  switch (state.phase) {
    case 'proposal':
      return [
        {
          type: 'proposeTeam',
          label: `提名 ${TEAM_SIZE} 人任务队伍`,
          targetIds: state.players.map((player) => player.playerId),
          allowNone: false,
        },
      ]
    case 'teamVote':
      return [{ type: 'vote', label: '队伍表决', targetIds: ['approve', 'reject'], allowNone: false }]
    case 'quest': {
      const actor = state.players.find((player) => player.playerId === playerId)
      const evil = actor ? factionOf(actor.role) === 'evil' : false
      return [
        {
          type: 'quest',
          label: evil ? '任务抉择（成功/失败）' : '任务抉择（好人只能成功）',
          targetIds: evil ? ['success', 'fail'] : ['success'],
          allowNone: false,
        },
      ]
    }
    default:
      return []
  }
}

/** 强制终局（force-end）：按当前任务战绩裁决并全量揭示。 */
export function terminateImmediately(state: AvalonEngineState): ApplyOutcome {
  if (state.phase === 'ended' || state.outcome !== null) {
    return rejectWith(state, { actorId: '-', type: '(terminate)' }, 'PARAM_CONFLICT', '对局已终局')
  }
  const next: AvalonEngineState = structuredClone(state)
  const ctx: Ctx = { state: next, events: [] }
  const outcome = forceEndOutcome(next)
  finishMatch(ctx, outcome.winner, outcome.basis)
  return { status: 'accepted', state: next, events: ctx.events }
}

// ---------------------------------------------------------------------------
// Replay（确定性：种子入流）
// ---------------------------------------------------------------------------

export type ReduceResult =
  | { status: 'ok'; state: AvalonEngineState }
  | { status: 'error'; message: string }

/**
 * 仅凭事件流重建 state：头部事件（matchStarted / rolesAssigned /
 * randomnessSeed）重建初始发牌，随后逐个重放 action 锚定事件。
 */
export function reduceEvents(events: readonly AvalonEvent[]): ReduceResult {
  const started = events.find((event) => event.kind === 'matchStarted')
  if (!started || started.actorId !== null) {
    return { status: 'error', message: 'event stream has no matchStarted header' }
  }
  const seats = [...started.payload.seats].sort((a, b) => a.seat - b.seat)
  const playerIds = seats.map((seat) => seat.playerId)
  const roles = new Map<string, AvalonRoleId>()
  for (const event of events) {
    if (event.kind === 'rolesAssigned' && event.actorId !== null) {
      roles.set(event.actorId, event.payload.role)
    }
  }
  const seating = playerIds.map((id) => roles.get(id))
  if (seating.some((role) => role === undefined)) {
    return { status: 'error', message: 'event stream is missing rolesAssigned events for some seats' }
  }
  const seedEvent = events.find((event) => event.kind === 'randomnessSeed')
  const seed = seedEvent && seedEvent.kind === 'randomnessSeed' ? seedEvent.payload.seed : 0

  const created: CreateMatchResult = createMatchFromSeating({
    seating: seating as AvalonRoleId[],
    playerIds,
    seed,
  })
  if (created.status !== 'created') {
    return { status: 'error', message: `replayed board rejected: ${JSON.stringify(created.issues)}` }
  }

  let state = created.state
  for (const event of events) {
    if (!('action' in event) || event.action === undefined) continue
    const outcome = applyAction(state, event.action)
    if (outcome.status === 'rejected') {
      return {
        status: 'error',
        message: `replay diverged at seq ${event.seq}: ${outcome.rejection.code} — ${outcome.rejection.message}`,
      }
    }
    state = outcome.state
  }
  return { status: 'ok', state }
}
