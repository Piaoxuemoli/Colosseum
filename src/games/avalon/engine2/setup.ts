// Avalon engine v2 — match bootstrap（种子化发牌 + 夜间情报，AVR-203）。
//
// 确定性（AVR-N1）：Fisher–Yates 洗牌 + 可注入 rng；首任队长由种子随机决定
// （AVR-104）；派西维尔视野中梅林/莫甘娜混排（种子决定顺序）。种子以
// delayed-public 事件入流（终局前选手不可见——公开种子即可反推发牌），
// 重放不需要外部状态。发牌与夜间情报全部走 role-self 受众。
//
// 洗牌流与元随机流（首任队长 / 混排）分离：createMatchFromSeating（fixture /
// 重放入口）不洗牌，但元随机消费与 createMatch 完全一致——否则同一种子在
// 两条路径下会推出不同的首任队长，重放即发散。

import type {
  AvalonEngineState,
  AvalonRoleId,
  CreateMatchResult,
  KnowledgeRecord,
  PlayerSlot,
  ResolvedBoard,
} from './types'
import { factionOf } from './types'
import { emitEvent, startRound, type Ctx } from './phases'
import { validateBoard } from './board'

/** 种子化 LCG（与狼人杀 engine2 同族生成器，选择稳定实现；不得跨游戏复用实例）。 */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * 元随机流（首任队长 / 派西维尔混排）：独立于洗牌流，使显式落座路径与
 * 洗牌路径在元随机消费上逐位一致（AVR-503 重放同态的前提）。
 */
function metaRng(seed: number): () => number {
  return seededRng((seed ^ 0x9e3779b9) >>> 0)
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
  /** 已解析的板子配置（resolveBoard 产物）。 */
  board: ResolvedBoard
  /** 玩家 id（座位序，seat 1..N）。 */
  playerIds: string[]
  /** 显式随机种子；入事件流（重放依据）。 */
  seed: number
}

export function createMatch(args: CreateMatchArgs): CreateMatchResult {
  const validated = validateBoard(args.board)
  if (!validated.ok) return { status: 'invalid', issues: validated.issues }

  const total = Object.values(args.board.roles).reduce((sum, n) => sum + n, 0)
  if (args.playerIds.length !== total) {
    return {
      status: 'invalid',
      issues: [
        {
          field: 'playerIds',
          code: 'count-mismatch',
          message: `board seats ${total} players but ${args.playerIds.length} were given`,
        },
      ],
    }
  }

  const pool: AvalonRoleId[] = []
  for (const [role, count] of Object.entries(args.board.roles) as Array<[AvalonRoleId, number]>) {
    for (let i = 0; i < count; i++) pool.push(role)
  }
  const seating = shuffle(pool, seededRng(args.seed))
  return createMatchFromSeating({ board: validated.board, seating, playerIds: args.playerIds, seed: args.seed })
}

export interface CreateMatchFromSeatingArgs {
  board: ResolvedBoard
  /** 座位序的角色列表（必须与板子角色多重集完全一致）。 */
  seating: AvalonRoleId[]
  playerIds: string[]
  seed: number
}

/** 确定性 fixture / 重放入口：显式落座（不洗牌），并校验板子一致性。 */
export function createMatchFromSeating(args: CreateMatchFromSeatingArgs): CreateMatchResult {
  const { board, playerIds, seed } = args
  const validated = validateBoard(board)
  if (!validated.ok) return { status: 'invalid', issues: validated.issues }

  const issues: Array<{ field: string; code: string; message: string }> = []
  const total = Object.values(board.roles).reduce((sum, n) => sum + n, 0)
  if (args.seating.length !== total || playerIds.length !== total) {
    issues.push({
      field: 'seating',
      code: 'count-mismatch',
      message: `seating has ${args.seating.length} roles for ${playerIds.length} players (board needs ${total})`,
    })
  }
  const expected = new Map<AvalonRoleId, number>(Object.entries(board.roles) as Array<[AvalonRoleId, number]>)
  const actual = new Map<AvalonRoleId, number>()
  for (const role of args.seating) actual.set(role, (actual.get(role) ?? 0) + 1)
  for (const [role, want] of expected) {
    const got = actual.get(role) ?? 0
    if (got !== want) {
      issues.push({
        field: `seating.${role}`,
        code: 'count-mismatch',
        message: `seating has ${got}× ${role}, board declares ${want}`,
      })
    }
  }
  if (new Set(playerIds).size !== playerIds.length) {
    issues.push({ field: 'playerIds', code: 'duplicate-player', message: 'player ids must be unique' })
  }
  if (issues.length > 0) return { status: 'invalid', issues }

  const players: PlayerSlot[] = playerIds.map((playerId, index) => ({
    playerId,
    seat: index + 1,
    role: args.seating[index],
  }))
  const bySeat = [...players].sort((a, b) => a.seat - b.seat)

  // ── 元随机：首任队长（AVR-104）与派西维尔混排（AVR-203）──
  const rng = metaRng(seed)
  const firstLeaderSeat = 1 + Math.floor(rng() * players.length)

  const knowledge = computeKnowledge(bySeat, rng)

  const state: AvalonEngineState = {
    engineVersion: 2,
    board: {
      id: board.id,
      name: board.name,
      roles: { ...board.roles },
      teamSizes: [...board.teamSizes],
      doubleFailRounds: [...board.doubleFailRounds],
      discussionEnabled: board.discussionEnabled,
    },
    players,
    round: 0,
    attempt: 1,
    phase: 'ended', // 占位；startRound（级联）会设置真实首个阶段
    pendingActor: null,
    leaderSeat: 0,
    discussion: null,
    proposal: null,
    voteRound: null,
    quest: null,
    consultation: null,
    results: [],
    voteHistory: [],
    statementLog: [],
    knowledge,
    assassination: null,
    outcome: null,
    nextSeq: 0,
  }
  const ctx: Ctx = { state, events: [] }

  // ── 头部事件：开局配置 / 随机性溯源 / 发牌（role-self）/ 夜间情报（role-self）──
  emitEvent(ctx, 'matchStarted', { kind: 'public' }, null, {
    boardId: board.id,
    boardName: board.name,
    seats: bySeat.map((player) => ({ playerId: player.playerId, seat: player.seat })),
    questCount: 5,
    teamSizes: [...board.teamSizes],
    doubleFailRounds: [...board.doubleFailRounds],
    discussionEnabled: board.discussionEnabled,
    roles: { ...board.roles },
  })
  emitEvent(ctx, 'randomnessSeed', { kind: 'delayed-public' }, null, { seed })
  for (const player of bySeat) {
    emitEvent(ctx, 'rolesAssigned', { kind: 'role-self', playerId: player.playerId }, player.playerId, {
      role: player.role,
    })
  }
  for (const record of knowledge) {
    emitEvent(
      ctx,
      'knowledgeRevealed',
      { kind: 'role-self', playerId: record.playerId },
      record.playerId,
      { insight: record.insight, playerIds: [...record.playerIds] },
    )
  }

  // 首任队长 + 走到第一个可行动阶段（轮 1 讨论或提名）。
  state.leaderSeat = firstLeaderSeat
  startRound(ctx)

  return { status: 'created', state: ctx.state, events: ctx.events }
}

// ---------------------------------------------------------------------------
// 夜间知识矩阵（AVR-203 全表）
// ---------------------------------------------------------------------------

/**
 * 发牌时一次性算定全员知识（与事件、决策上下文同源）：
 * - 梅林：除莫德雷德外的全部坏人（含奥伯伦）；
 * - 派西维尔：梅林与莫甘娜（混排、无标注；无莫甘娜的板子只有梅林）；
 * - 坏人（爪牙/刺客/莫甘娜/莫德雷德）：除奥伯伦外的全部同伙；
 * - 奥伯伦：除自己外全部坏人（含莫德雷德，单向）；
 * - 忠诚仆从：无任何情报事件。
 */
export function computeKnowledge(
  playersBySeat: readonly PlayerSlot[],
  rng: () => number,
): KnowledgeRecord[] {
  const byRole = (role: AvalonRoleId): PlayerSlot | null => playersBySeat.find((player) => player.role === role) ?? null
  const evils = playersBySeat.filter((player) => factionOf(player.role) === 'evil')
  const idsOf = (list: readonly PlayerSlot[]): string[] => list.map((player) => player.playerId)

  const records: KnowledgeRecord[] = []
  const push = (player: PlayerSlot, insight: KnowledgeRecord['insight'], playerIds: string[]): void => {
    records.push({ playerId: player.playerId, insight, playerIds })
  }

  // 梅林：看到除莫德雷德外的全部坏人（奥伯伦也可见）。
  const merlin = byRole('merlin')
  if (merlin) push(merlin, 'merlin', idsOf(evils.filter((player) => player.role !== 'mordred')))

  // 派西维尔：梅林 + 莫甘娜混排（顺序由种子决定，无标注）。
  const percival = byRole('percival')
  if (percival) {
    const sources = [byRole('merlin'), byRole('morgana')].filter(
      (player): player is PlayerSlot => player !== null,
    )
    push(percival, 'percival', idsOf(shuffle(sources, rng)))
  }

  // 坏人互识（除奥伯伦外）：看到除奥伯伦外（且除自己）的全部同伙。
  for (const evil of evils) {
    if (evil.role === 'oberon') continue
    push(
      evil,
      'evil',
      idsOf(evils.filter((other) => other.playerId !== evil.playerId && other.role !== 'oberon')),
    )
  }

  // 奥伯伦：单向看到全部其他坏人（含莫德雷德）；对方看不到他。
  const oberon = byRole('oberon')
  if (oberon) {
    push(oberon, 'evil', idsOf(evils.filter((other) => other.playerId !== oberon.playerId)))
  }

  // 输出按持有者座位序稳定排列（重放同态）。
  const seatOf = (playerId: string): number => playersBySeat.find((player) => player.playerId === playerId)?.seat ?? 0
  return records.sort((a, b) => seatOf(a.playerId) - seatOf(b.playerId))
}
