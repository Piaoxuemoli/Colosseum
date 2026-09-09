// 品类呈现契约 · 前端通用兜底投影（spec: docs/specs/presentation-contract.md §3/§4）。
//
// 消费任何满足「通用锚点约定」（信封 / 名册 / 轮次 / 阶段 / 结算）的
// `${gameType}:v2:${kind}` 事件流，归约出品类无关的通用视图模型：
// 态势名册 + 通用动作日志 + 阶段条带 + 结算摘要。无任何游戏专属知识——
// 观战页对无专属面板的品类（未知 gameType，R3-2 冒烟场景）回落到本投影。
//
// 锚点探测全部是结构化的（候选键 + 形状校验），未知键静默忽略（向前兼容）；
// 既有两游戏（poker / werewolf）在 match-view-store 分派中优先走专属投影，
// 本模块只接其余 `*:v2:` 流——但两游戏的信封流同样满足锚点约定（一致性由
// generic-v2 测试直接归约两游戏信封验证）。

import type { GameEvent } from '@/platform/core/types'
import type { MatchViewProjection } from '../match-view-store'
import { asRecord, numberOr, stringOr } from './common'

/** 通用信封标记：kind 含 `:v2:` 即 engine2 v2 流（poker/werewolf 已被优先分派）。 */
const V2_MARKER = ':v2:'

export function isGenericV2Event(event: Pick<GameEvent, 'kind'>): boolean {
  const markerAt = event.kind.indexOf(V2_MARKER)
  return markerAt > 0 && markerAt + V2_MARKER.length < event.kind.length
}

/** 信封 kind → engine2 kind。 */
export function genericEngineKindOf(kind: string): string {
  return kind.slice(kind.indexOf(V2_MARKER) + V2_MARKER.length)
}

/** 信封 kind → gameType（`:` 前缀段）。 */
export function genericGameTypeOf(kind: string): string {
  return kind.slice(0, kind.indexOf(V2_MARKER))
}

// ---------------------------------------------------------------------------
// 通用视图模型
// ---------------------------------------------------------------------------

export type GenericV2RosterRow = {
  agentId: string
  seat: number | null
  /** 该选手在本流中的动作数（活动度提示）。 */
  actionCount: number
  lastActionSeq: number | null
}

export type GenericV2LogEntry = {
  seq: number
  occurredAt: string
  engineKind: string
  actorAgentId: string | null
  /** 受众非 public 的可见性标记（公开视角降权；FR-4.4-01）。 */
  restricted: boolean
  /** 兜底接管标记（FR-4.4-04）。 */
  isDefault: boolean
  text: string
}

export type GenericV2Boundary = { seq: number; cycle: number; phase: string }

export type GenericV2Settlement = {
  winnerLabel: string | null
  rows: Array<{ agentId: string; rank: number | null; role: string | null }>
}

export type GenericV2Accumulator = {
  gameType: string | null
  status: 'waiting' | 'live' | 'settled'
  roster: GenericV2RosterRow[]
  phase: string | null
  cycle: number
  boundaries: GenericV2Boundary[]
  log: GenericV2LogEntry[]
  settlement: GenericV2Settlement | null
}

export function emptyGenericV2(): GenericV2Accumulator {
  return {
    gameType: null,
    status: 'waiting',
    roster: [],
    phase: null,
    cycle: 0,
    boundaries: [],
    log: [],
    settlement: null,
  }
}

// ---------------------------------------------------------------------------
// 锚点探测（spec §3：全部结构化，无游戏分支）
// ---------------------------------------------------------------------------

/**
 * 锚点探测的作用域：信封载荷本体 + 其内嵌 `payload` 子对象（狼人杀等引擎的
 * 事件体自带 payload 嵌套层；德扑为逐字段平铺）。两个作用域依序探测。
 */
function payloadScopes(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const nested = asRecord(payload.payload)
  return nested ? [payload, nested] : [payload]
}

function stringArrayOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.flatMap((item) => (typeof item === 'string' ? [item] : []))
  return ids.length === value.length && ids.length > 0 ? ids : null
}

/** 名册锚：seatIds / playerIds / seats[{playerId|agentId, seat?}] 之一。 */
function probeRoster(payload: Record<string, unknown>): GenericV2RosterRow[] | null {
  for (const scope of payloadScopes(payload)) {
    const flat = stringArrayOf(scope.seatIds) ?? stringArrayOf(scope.playerIds)
    if (flat) {
      return flat.map((agentId, index) => ({ agentId, seat: index, actionCount: 0, lastActionSeq: null }))
    }
    if (Array.isArray(scope.seats)) {
      const rows = scope.seats.flatMap((item): GenericV2RosterRow[] => {
        const raw = asRecord(item)
        if (!raw) return []
        const agentId = stringOr(raw.playerId) ?? stringOr(raw.agentId)
        if (!agentId) return []
        const seat = typeof raw.seat === 'number' && Number.isFinite(raw.seat) ? raw.seat : null
        return [{ agentId, seat, actionCount: 0, lastActionSeq: null }]
      })
      if (rows.length > 0) return rows
    }
  }
  return null
}

/** 轮次锚：数值键 day / handNumber / hand 之一。 */
function probeCycle(payload: Record<string, unknown>): number | null {
  for (const scope of payloadScopes(payload)) {
    for (const key of ['day', 'handNumber', 'hand'] as const) {
      const value = scope[key]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
    }
  }
  return null
}

/** 阶段锚：字符串键 phase / street 之一。 */
function probePhase(payload: Record<string, unknown>): string | null {
  for (const scope of payloadScopes(payload)) {
    const phase = stringOr(scope.phase) ?? stringOr(scope.street)
    if (phase !== null) return phase
  }
  return null
}

function agentIdOf(row: Record<string, unknown>): string | null {
  return stringOr(row.seatId) ?? stringOr(row.agentId) ?? stringOr(row.playerId)
}

/** 结算锚：ranking[{seatId|agentId|playerId, rank}] 或 reveal[{playerId, role}]，可选 winner。 */
function probeSettlement(payload: Record<string, unknown>): GenericV2Settlement | null {
  for (const scope of payloadScopes(payload)) {
    const settlement = probeSettlementScope(scope)
    if (settlement) return settlement
  }
  return null
}

function probeSettlementScope(payload: Record<string, unknown>): GenericV2Settlement | null {
  let rows: GenericV2Settlement['rows'] | null = null
  if (Array.isArray(payload.ranking)) {
    const parsed = payload.ranking.flatMap((item): GenericV2Settlement['rows'] => {
      const raw = asRecord(item)
      if (!raw) return []
      const agentId = agentIdOf(raw)
      if (!agentId) return []
      const rank = numberOr(raw.rank, 0)
      return [{ agentId, rank: rank > 0 ? rank : null, role: null }]
    })
    if (parsed.length > 0) rows = parsed
  }
  if (rows === null && Array.isArray(payload.reveal)) {
    const parsed = payload.reveal.flatMap((item): GenericV2Settlement['rows'] => {
      const raw = asRecord(item)
      if (!raw) return []
      const agentId = agentIdOf(raw)
      if (!agentId) return []
      const role = stringOr(raw.role)
      return [{ agentId, rank: null, role }]
    })
    if (parsed.length > 0) rows = parsed
  }
  if (rows === null) return null
  // rank 缺失（reveal 形态）时以数组序兜底；ranking 形态的 rank 1 即冠军。
  const withFallbackRank = rows.map((row, index) => ({ ...row, rank: row.rank ?? index + 1 }))
  return {
    winnerLabel:
      stringOr(payload.winner) ??
      withFallbackRank.find((row) => row.rank === 1)?.agentId ??
      null,
    rows: withFallbackRank,
  }
}

// ---------------------------------------------------------------------------
// 归约
// ---------------------------------------------------------------------------

/**
 * 归约一个非 poker/werewolf 的 `${gameType}:v2:*` 信封事件（未知 kind 静默
 * 忽略但留痕；游戏专属共享字段（players/pot 等）零触碰）。
 */
export function reduceGenericV2Event(state: MatchViewProjection, event: GameEvent): MatchViewProjection {
  const engineKind = genericEngineKindOf(event.kind)
  const payload = asRecord(event.payload) ?? {}
  const gameType = genericGameTypeOf(event.kind)

  let acc = state.genericV2
  let dirty = false
  const mut = (): GenericV2Accumulator => {
    if (!dirty) {
      acc = {
        ...state.genericV2,
        roster: state.genericV2.roster.map((row) => ({ ...row })),
        boundaries: [...state.genericV2.boundaries],
        log: [...state.genericV2.log],
      }
      dirty = true
    }
    return acc
  }

  const a = mut()
  if (a.gameType !== gameType) a.gameType = gameType
  if (a.status === 'waiting') a.status = 'live'

  if (a.roster.length === 0) {
    const roster = probeRoster(payload)
    if (roster) a.roster = roster
  }

  const cycle = probeCycle(payload)
  const nextCycle = Math.max(a.cycle, cycle ?? 0)
  const phase = probePhase(payload)
  if (nextCycle !== a.cycle || (phase !== null && phase !== a.phase)) {
    a.boundaries.push({ seq: event.seq, cycle: nextCycle, phase: phase ?? a.phase ?? '' })
  }
  a.cycle = nextCycle
  if (phase !== null) a.phase = phase

  // 名册活动度：actor 命中名册行则累计。
  const actor = event.actorAgentId
  if (actor) {
    const row = a.roster.find((candidate) => candidate.agentId === actor)
    if (row) {
      row.actionCount += 1
      row.lastActionSeq = event.seq
    }
  }

  const settlement = probeSettlement(payload)
  if (settlement) {
    a.settlement = settlement
    a.status = 'settled'
  }

  const nameOf = (agentId: string): string =>
    state.players.find((player) => player.agentId === agentId)?.displayName ?? agentId
  a.log.push({
    seq: event.seq,
    occurredAt: event.occurredAt,
    engineKind,
    actorAgentId: actor,
    restricted: event.visibility !== 'public',
    isDefault: payload.isDefault === true,
    text: actor ? `${nameOf(actor)} · ${engineKind}` : engineKind,
  })

  return {
    ...state,
    genericV2: acc,
    // 通用流不驱动游戏专属字段；handNumberAt 用轮次计数分桶（思考日志分组）。
    events: [...state.events, { ...event, handNumberAt: a.cycle }],
  }
}
