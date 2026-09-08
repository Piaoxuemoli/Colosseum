// 结算可信化（FR-4.6-01）：从事件流独立回推终局排名，并与结算交付的排名
// （matches.finalRanking，GM finalize 落库）对比。回推只消费过程事件——
// 扑克用 hand-ended 的逐手 endStack 链（含未完手的盲注/下注投入），狼人杀
// 用 gameEnded 终局揭示（阵营胜负 + 存活/死亡 + 座次）——不复读结算结论，
// 使「凭空名次」在 UI 上必然暴露为 mismatch（不允许静默通过）。
//
// 纯函数模块：不依赖 store / 网络；前端组件与单元测试共用。

import type { GameEvent } from '@/platform/core/types'
import { asRecord, numberOr, stringOr } from './common'

/** 事件流回推出的单条排名。 */
export type DerivedRankingEntry = {
  agentId: string
  rank: number
  /** 扑克终局筹码（狼人杀为 null）。 */
  chips: number | null
  /** 狼人杀存活标记（扑克为 null：淘汰=出局）。 */
  alive: boolean | null
  /** 狼人杀身份（gameEnded 揭示 / legacy actualRoles）。 */
  role: string | null
}

export type DerivedRanking = {
  gameType: 'poker' | 'werewolf'
  ranking: DerivedRankingEntry[]
  /** 扑克冠军 seatId；狼人杀为 null（阵营胜负见 winnerFaction）。 */
  winnerAgentId: string | null
  /** 狼人杀胜方阵营（'wolves' | 'good' | 'tie'）；扑克为 null。 */
  winnerFaction: string | null
  /** 推导依据（供 UI 展示与测试断言）。 */
  basis: string
}

/** 结算侧交付的排名（matches.finalRanking JSON 的防御性读取形态）。 */
export type DeliveredRanking = {
  winnerFaction: string | null
  ranking: Array<{ agentId: string; rank: number; score: number; extra?: Record<string, unknown> }>
}

export type RankingVerification =
  | { status: 'verified'; divergences: [] }
  | { status: 'mismatch'; divergences: string[] }
  | { status: 'underivable'; reason: string }

// ---------------------------------------------------------------------------
// 扑克：hand-ended endStack 链 + 未完手投入 + player-eliminated 名次
// ---------------------------------------------------------------------------

function derivePokerRanking(events: GameEvent[]): DerivedRanking | null {
  let seatOrder: string[] = []
  let startingStack: number | null = null
  /** 最近一次 hand-ended 后的静止筹码（seatId → chips）。 */
  const settledChips: Record<string, number> = {}
  let sawSettlement = false
  /** 当前未完手中的净投入（盲注 + 下注 paid；seatId → committed）。 */
  let committed: Record<string, number> = {}
  const eliminatedRank: Record<string, number> = {}

  let legacyChips: Record<string, number> = {}
  let legacyOrder: string[] = []
  let legacyEliminated = new Set<string>()
  let sawLegacyState = false

  for (const event of events) {
    const payload = asRecord(event.payload) ?? {}
    switch (event.kind) {
      case 'poker:v2:match-config': {
        seatOrder = Array.isArray(payload.seatIds)
          ? payload.seatIds.filter((item): item is string => typeof item === 'string')
          : []
        startingStack = typeof payload.startingStack === 'number' ? payload.startingStack : null
        break
      }
      case 'poker:v2:hand-started': {
        committed = {}
        break
      }
      case 'poker:v2:blinds-posted': {
        const posts = Array.isArray(payload.posts) ? payload.posts.flatMap((item) => (asRecord(item) ? [item] : [])) : []
        for (const post of posts) {
          const seatId = stringOr(post.seatId)
          if (seatId) committed[seatId] = (committed[seatId] ?? 0) + Math.max(0, numberOr(post.posted, 0))
        }
        break
      }
      case 'poker:v2:action-made': {
        const seatId = stringOr(payload.seatId)
        const action = asRecord(payload.action)
        if (seatId && action) committed[seatId] = (committed[seatId] ?? 0) + Math.max(0, numberOr(action.paid, 0))
        break
      }
      case 'poker:v2:hand-ended': {
        const results = Array.isArray(payload.results) ? payload.results.flatMap((item) => (asRecord(item) ? [item] : [])) : []
        for (const result of results) {
          const seatId = stringOr(result.seatId)
          const endStack = numberOr(result.endStack, Number.NaN)
          if (seatId && Number.isFinite(endStack)) settledChips[seatId] = endStack
        }
        sawSettlement = results.length > 0 || sawSettlement
        committed = {}
        break
      }
      case 'poker:v2:player-eliminated': {
        const seatId = stringOr(payload.seatId)
        const rank = numberOr(payload.rank, 0)
        if (seatId && rank > 0) eliminatedRank[seatId] = rank
        break
      }
      case 'poker/state': {
        // legacy 流：全量状态快照，最后一份即终局筹码。
        const players = Array.isArray(payload.players) ? payload.players.flatMap((item) => (asRecord(item) ? [item] : [])) : []
        const next: Record<string, number> = {}
        const order: string[] = []
        const dead = new Set<string>()
        for (const player of players) {
          const id = stringOr(player.id)
          if (!id) continue
          next[id] = numberOr(player.chips, 0)
          order.push(id)
          if (player.status === 'eliminated') dead.add(id)
        }
        if (order.length > 0) {
          legacyChips = next
          legacyOrder = order
          legacyEliminated = dead
          sawLegacyState = true
        }
        break
      }
      default:
        break
    }
  }

  const isV2 = sawSettlement || seatOrder.length > 0 || Object.keys(eliminatedRank).length > 0

  if (isV2) {
    const roster = seatOrder.length > 0 ? seatOrder : Object.keys(settledChips)
    if (roster.length === 0) return null
    const base = startingStack ?? 0
    const finalChips: Record<string, number> = {}
    for (const seatId of roster) {
      const rest = sawSettlement ? (settledChips[seatId] ?? 0) : base
      finalChips[seatId] = rest + (committed[seatId] ?? 0)
    }
    const survivors = roster.filter((seatId) => !(seatId in eliminatedRank))
    survivors.sort((a, b) => {
      const diff = finalChips[b] - finalChips[a]
      if (diff !== 0) return diff
      return roster.indexOf(a) - roster.indexOf(b)
    })
    const ranking: DerivedRankingEntry[] = []
    for (const [index, seatId] of survivors.entries()) {
      ranking.push({ agentId: seatId, rank: index + 1, chips: finalChips[seatId], alive: null, role: null })
    }
    for (const seatId of roster) {
      const rank = eliminatedRank[seatId]
      if (rank !== undefined) {
        ranking.push({ agentId: seatId, rank, chips: finalChips[seatId], alive: null, role: null })
      }
    }
    ranking.sort((a, b) => a.rank - b.rank)
    return {
      gameType: 'poker',
      ranking,
      winnerAgentId: survivors[0] ?? null,
      winnerFaction: null,
      basis: 'hand-ended endStack 链（含未完手盲注/下注投入）+ player-eliminated 名次',
    }
  }

  if (sawLegacyState) {
    const actives = legacyOrder.filter((id) => !legacyEliminated.has(id))
    const dead = legacyOrder.filter((id) => legacyEliminated.has(id))
    actives.sort((a, b) => legacyChips[b] - legacyChips[a] || legacyOrder.indexOf(a) - legacyOrder.indexOf(b))
    dead.sort((a, b) => legacyChips[a] - legacyChips[b] || legacyOrder.indexOf(a) - legacyOrder.indexOf(b))
    const ordered = [...actives, ...dead]
    return {
      gameType: 'poker',
      ranking: ordered.map((agentId, index) => ({
        agentId,
        rank: index + 1,
        chips: legacyChips[agentId],
        alive: null,
        role: null,
      })),
      winnerAgentId: actives[0] ?? null,
      winnerFaction: null,
      basis: 'legacy poker/state 筹码快照（尽力推导）',
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// 狼人杀：gameEnded 揭示（阵营 + 存活 + 座次）/ legacy game-end 尽力推导
// ---------------------------------------------------------------------------

/** 狼阵营角色（与 engine2 roles.campOf 的 wolf 分支保持一致的镜像）。 */
const WOLF_ROLES = new Set(['werewolf', 'wolfKing', 'whiteWolfKing'])

function factionOfRole(role: string): 'wolves' | 'good' {
  return WOLF_ROLES.has(role) ? 'wolves' : 'good'
}

function werewolfRankingOf(
  players: Array<{ agentId: string; seat: number; role: string | null; alive: boolean }>,
  winner: 'wolves' | 'good' | 'tie',
  basis: string,
): DerivedRanking {
  const factionRank = (player: (typeof players)[number]): number => {
    if (winner === 'tie' || !player.role) return 0
    return factionOfRole(player.role) === winner ? 0 : 1
  }
  const ordered = [...players].sort((a, b) => {
    const diff = factionRank(a) - factionRank(b)
    if (diff !== 0) return diff
    const aliveDiff = (a.alive ? 0 : 1) - (b.alive ? 0 : 1)
    if (aliveDiff !== 0) return aliveDiff
    return a.seat - b.seat
  })
  return {
    gameType: 'werewolf',
    ranking: ordered.map((player, index) => ({
      agentId: player.agentId,
      rank: index + 1,
      chips: null,
      alive: player.alive,
      role: player.role,
    })),
    winnerAgentId: null,
    winnerFaction: winner,
    basis,
  }
}

function deriveWerewolfRanking(events: GameEvent[]): DerivedRanking | null {
  // legacy：moderator-narrate 累计的出局名单（game-end 前的死亡事实）。
  const legacyDead = new Set<string>()

  for (const event of events) {
    const payload = asRecord(event.payload) ?? {}

    if (event.kind === 'werewolf/moderator-narrate') {
      const deaths = Array.isArray(payload.deaths) ? payload.deaths.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      for (const death of deaths) {
        const agentId = stringOr(death.agentId)
        if (agentId) legacyDead.add(agentId)
      }
      continue
    }

    if (event.kind !== 'werewolf:v2:gameEnded' && event.kind !== 'werewolf/game-end') continue

    if (event.kind === 'werewolf:v2:gameEnded') {
      const inner = asRecord(payload.payload) ?? {}
      const winnerRaw = stringOr(inner.winner)
      if (winnerRaw !== 'wolves' && winnerRaw !== 'good' && winnerRaw !== 'tie') return null
      const reveal = Array.isArray(inner.reveal) ? inner.reveal.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      const players = reveal.flatMap((entry) => {
        const agentId = stringOr(entry.playerId)
        if (!agentId) return []
        return [
          {
            agentId,
            seat: numberOr(entry.seat, 0),
            role: stringOr(entry.role),
            alive: asRecord(entry.death) === null,
          },
        ]
      })
      if (players.length === 0) return null
      return werewolfRankingOf(players, winnerRaw, 'gameEnded 终局揭示（阵营/存活/座次）')
    }

    // legacy werewolf/game-end：winner 词表不同（werewolves/villagers/tie）。
    const winnerRaw = stringOr(payload.winner)
    const winner = winnerRaw === 'werewolves' ? 'wolves' : winnerRaw === 'villagers' ? 'good' : 'tie'
    const roles = asRecord(payload.actualRoles)
    if (!roles) return null
    const players = Object.entries(roles).map(([agentId, roleValue], index) => ({
      agentId,
      seat: index + 1,
      role: typeof roleValue === 'string' ? roleValue : null,
      alive: !legacyDead.has(agentId),
    }))
    return werewolfRankingOf(players, winner, 'legacy game-end actualRoles + 死亡名单（尽力推导）')
  }

  return null
}

/**
 * 从 v2（含 legacy 兜底）事件流回推终局排名。事件不足（未见任何结算链）
 * 时返回 null —— 调用方必须按「无法验证」呈现，不得视作通过。
 */
export function deriveRankingFromEvents(events: GameEvent[]): DerivedRanking | null {
  const hasPoker = events.some(
    (event) => event.kind.startsWith('poker:v2:') || event.kind === 'poker/state' || event.kind === 'poker/hand-start',
  )
  const hasWerewolf = events.some(
    (event) => event.kind.startsWith('werewolf:v2:') || event.kind.startsWith('werewolf/'),
  )
  if (hasPoker && !hasWerewolf) return derivePokerRanking(events)
  if (hasWerewolf && !hasPoker) return deriveWerewolfRanking(events)
  return null
}

/** matches.finalRanking JSON → DeliveredRanking（形状不符 → null）。 */
export function parseDeliveredRanking(value: unknown): DeliveredRanking | null {
  const raw = asRecord(value)
  if (!raw) return null
  const ranking = Array.isArray(raw.ranking) ? raw.ranking.flatMap((item) => (asRecord(item) ? [item] : [])) : []
  const parsed = ranking.flatMap((item) => {
    const agentId = stringOr(item.agentId)
    const rank = numberOr(item.rank, 0)
    if (!agentId || rank <= 0) return []
    return [{ agentId, rank, score: numberOr(item.score, 0), extra: asRecord(item.extra) ?? undefined }]
  })
  if (parsed.length === 0) return null
  const winnerFaction = stringOr(raw.winnerFaction)
  return { winnerFaction, ranking: parsed }
}

/**
 * 事件流回推结果 vs 结算交付结果的对比。任何一侧缺失 → underivable；
 * 名次 / 胜方 / 筹码（扑克）/ 身份（狼人）不一致 → mismatch 并列出分歧。
 */
export function verifySettlementRanking(
  derived: DerivedRanking | null,
  delivered: DeliveredRanking | null,
): RankingVerification {
  if (!derived) return { status: 'underivable', reason: '事件流不足以回推排名（缺少结算链事件）' }
  if (!delivered) return { status: 'underivable', reason: '结算排名数据缺失（finalRanking 未落库或为空）' }

  const divergences: string[] = []
  const derivedById = new Map(derived.ranking.map((entry) => [entry.agentId, entry]))
  const deliveredById = new Map(delivered.ranking.map((entry) => [entry.agentId, entry]))

  const missing = [...deliveredById.keys()].filter((agentId) => !derivedById.has(agentId))
  const extra = [...derivedById.keys()].filter((agentId) => !deliveredById.has(agentId))
  if (missing.length > 0) divergences.push(`结算有名次但事件流缺失：${missing.join('、')}`)
  if (extra.length > 0) divergences.push(`事件流有选手但结算无名次：${extra.join('、')}`)

  for (const [agentId, deliveredEntry] of deliveredById) {
    const derivedEntry = derivedById.get(agentId)
    if (!derivedEntry) continue
    if (derivedEntry.rank !== deliveredEntry.rank) {
      divergences.push(`${agentId} 名次不符：结算 #${deliveredEntry.rank}，事件回推 #${derivedEntry.rank}`)
    }
    if (derived.gameType === 'poker' && derivedEntry.chips !== null && derivedEntry.chips !== deliveredEntry.score) {
      divergences.push(`${agentId} 筹码不符：结算 ${deliveredEntry.score}，事件回推 ${derivedEntry.chips}`)
    }
    if (derived.gameType === 'werewolf') {
      const deliveredRole = deliveredEntry.extra ? stringOr(deliveredEntry.extra.role) : null
      if (deliveredRole && derivedEntry.role && deliveredRole !== derivedEntry.role) {
        divergences.push(`${agentId} 身份不符：结算 ${deliveredRole}，事件揭示 ${derivedEntry.role}`)
      }
    }
  }

  if (derived.gameType === 'werewolf') {
    if ((delivered.winnerFaction ?? null) !== (derived.winnerFaction ?? null)) {
      divergences.push(`胜方阵营不符：结算 ${delivered.winnerFaction ?? '无'}，事件回推 ${derived.winnerFaction ?? '无'}`)
    }
  } else if (derived.winnerAgentId && delivered.winnerFaction && derived.winnerAgentId !== delivered.winnerFaction) {
    divergences.push(`冠军不符：结算 ${delivered.winnerFaction}，事件回推 ${derived.winnerAgentId}`)
  }

  if (divergences.length > 0) return { status: 'mismatch', divergences }
  return { status: 'verified', divergences: [] }
}
