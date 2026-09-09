// Avalon engine v2 — match bootstrap（种子化发牌 + 情报分发入事件流）。
//
// 确定性：Fisher–Yates 洗牌 + 可注入 rng；种子以 delayed-public 事件入流
// （终局前选手不可见——公开种子即可反推发牌，与狼人杀 moderator 受众同因），
// 重放不需要外部状态。发牌与夜间情报全部走 role-self 受众（唯一可见性真相）。

import type {
  AvalonEngineState,
  AvalonRoleId,
  CreateMatchResult,
  PlayerSlot,
} from './types'
import { AVALON_BOARD_SEATS, SMOKE_BOARD_ROLES } from './types'
import { emitEvent, startRound, type Ctx } from './phases'

/** 种子化 LCG（与狼人杀 engine2 同族生成器，选择稳定实现；不得跨游戏复用实例）。 */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Fisher–Yates 洗牌（可注入 rng，确定性）。 */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export interface CreateMatchArgs {
  /** 5 名玩家 id（座位序，seat 1..5）。 */
  playerIds: string[]
  /** 显式随机种子；入事件流（重放依据）。 */
  seed: number
}

export function createMatch(args: CreateMatchArgs): CreateMatchResult {
  if (args.playerIds.length !== AVALON_BOARD_SEATS) {
    return {
      status: 'invalid',
      issues: [
        {
          field: 'playerIds',
          code: 'count-mismatch',
          message: `avalon smoke board seats exactly ${AVALON_BOARD_SEATS} players, got ${args.playerIds.length}`,
        },
      ],
    }
  }
  if (new Set(args.playerIds).size !== args.playerIds.length) {
    return {
      status: 'invalid',
      issues: [{ field: 'playerIds', code: 'duplicate-player', message: 'player ids must be unique' }],
    }
  }

  const seating = shuffle(SMOKE_BOARD_ROLES, seededRng(args.seed))
  return createMatchFromSeating({ seating, playerIds: args.playerIds, seed: args.seed })
}

export interface CreateMatchFromSeatingArgs {
  /** 座位序的角色列表（必须与固定板子的角色多重集完全一致）。 */
  seating: AvalonRoleId[]
  playerIds: string[]
  seed: number
}

/** 确定性 fixture / 重放入口：显式落座（不洗牌），并校验板子一致性。 */
export function createMatchFromSeating(args: CreateMatchFromSeatingArgs): CreateMatchResult {
  const { seating, playerIds, seed } = args
  if (seating.length !== AVALON_BOARD_SEATS || playerIds.length !== AVALON_BOARD_SEATS) {
    return {
      status: 'invalid',
      issues: [
        {
          field: 'seating',
          code: 'count-mismatch',
          message: `seating has ${seating.length} roles for ${playerIds.length} players (board needs ${AVALON_BOARD_SEATS})`,
        },
      ],
    }
  }
  const expected = new Map<AvalonRoleId, number>(SMOKE_BOARD_ROLES.map((role) => [role, 1]))
  const actual = new Map<AvalonRoleId, number>()
  for (const role of seating) actual.set(role, (actual.get(role) ?? 0) + 1)
  for (const [role, want] of expected) {
    const got = actual.get(role) ?? 0
    if (got !== want) {
      return {
        status: 'invalid',
        issues: [
          {
            field: `seating.${role}`,
            code: 'count-mismatch',
            message: `seating has ${got}× ${role}, board declares ${want}`,
          },
        ],
      }
    }
  }
  if (new Set(playerIds).size !== playerIds.length) {
    return {
      status: 'invalid',
      issues: [{ field: 'playerIds', code: 'duplicate-player', message: 'player ids must be unique' }],
    }
  }

  const players: PlayerSlot[] = playerIds.map((playerId, index) => ({
    playerId,
    seat: index + 1,
    role: seating[index],
  }))

  const state: AvalonEngineState = {
    engineVersion: 2,
    players,
    round: 0,
    attempt: 1,
    phase: 'ended', // 占位；startRound（级联）会设置真实首个阶段
    pendingActor: null,
    leaderSeat: 0,
    proposal: null,
    voteRound: null,
    quest: null,
    results: [],
    outcome: null,
    nextSeq: 0,
  }
  const ctx: Ctx = { state, events: [] }

  // ── 头部事件：开局配置 / 随机性溯源 / 发牌（role-self）/ 夜间情报（role-self）──
  emitEvent(ctx, 'matchStarted', { kind: 'public' }, null, {
    board: 'smoke-5',
    seats: players.map((player) => ({ playerId: player.playerId, seat: player.seat })),
  })
  emitEvent(ctx, 'randomnessSeed', { kind: 'delayed-public' }, null, { seed })
  for (const player of players) {
    emitEvent(ctx, 'rolesAssigned', { kind: 'role-self', playerId: player.playerId }, player.playerId, {
      role: player.role,
    })
  }
  const byRole = (role: AvalonRoleId): PlayerSlot => {
    const found = players.find((player) => player.role === role)
    if (!found) throw new Error(`avalon engine2: board missing role ${role}`)
    return found
  }
  const merlin = byRole('merlin')
  const percival = byRole('percival')
  const mordred = byRole('mordred')
  const minion = byRole('minion')
  // 梅林看到坏人中除莫德雷德外的那名（即爪牙）。
  emitEvent(ctx, 'knowledgeRevealed', { kind: 'role-self', playerId: merlin.playerId }, merlin.playerId, {
    insight: 'merlin',
    playerIds: [minion.playerId],
  })
  // 派西维尔看到梅林（简化：无莫甘娜混淆）。
  emitEvent(ctx, 'knowledgeRevealed', { kind: 'role-self', playerId: percival.playerId }, percival.playerId, {
    insight: 'percival',
    playerIds: [merlin.playerId],
  })
  // 坏人互识（含莫德雷德）。
  for (const [self, other] of [
    [mordred, minion],
    [minion, mordred],
  ] as const) {
    emitEvent(ctx, 'knowledgeRevealed', { kind: 'role-self', playerId: self.playerId }, self.playerId, {
      insight: 'evil',
      playerIds: [other.playerId],
    })
  }

  // 走到第一个可行动阶段（轮 1 提名）。
  startRound(ctx)

  return { status: 'created', state: ctx.state, events: ctx.events }
}
