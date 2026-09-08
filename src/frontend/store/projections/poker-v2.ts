// 德州扑克 engine2 事件投影（spec：docs/specs/engine2-integration.md §3/§6）。
//
// 消费 `poker:v2:${kind}` 信封事件（payload = engine2 PokerEvent 逐字段平铺，
// 含 audience），把 16 种 engine2 kind 归约成现有 PokerBoard/PlayerSeat/
// PokerStatusPanel/LiveScoreboard/ChipChart 消费的同一套 view model：
// players(chips/status/currentBet/holeCards) / communityCards / pot /
// streetPots / sidePots / street / handNumber / dealerIndex…
//
// 事件即唯一真相（PFR-401/405）：本投影不做任何「下一行动者」推测——engine2
// 事件不携带 pendingActor，currentActor 由思考流高亮兜底（与狼人杀一致）。
//
// 视角（spec §6 / PFR-402/403）：
// - god：全量（底牌即时可见）；
// - public：底牌 `hole-cards-dealt`（audience self:<seat>）在该手 hand-ended
//   之后才可见（延迟揭示）；`cards-revealed`（摊牌亮牌，public）即时可见。

import type { GameEvent } from '@/platform/core/types'
import type { CardVisual, MatchViewProjection, PokerSidePot, PokerStreetPots, PokerUiPlayer } from '../match-view-store'
import {
  POKER_V2_PREFIX,
  asRecord,
  cardsOr,
  engineKindOf,
  numberOr,
  stringOr,
} from './common'

/** v2 投影的内部累积器（不直接供组件消费；deriveMatchView/ingest 共用）。 */
export type PokerV2Accumulator = {
  /** match-config 事件给出的 seatIds（物理座位 = 数组下标）。 */
  seatIds: string[]
  startingStack: number | null
  /** 最近一次发底牌的手号。 */
  holeCardsHand: number
  /** seatId → 底牌（原始、未按视角剥离）。 */
  holeCardsBySeat: Record<string, CardVisual[]>
  /** cards-revealed（public 事实）之亮牌，seatId → cards。 */
  revealedBySeat: Record<string, CardVisual[]>
  /** 已见 hand-ended 的手号（延迟公开到期判定）。 */
  settledHands: number[]
  /** 本手 pot-awarded 按 potIndex 记录（potIndex>1 为边池），派生 sidePots。 */
  sidePotAwards: Record<number, PokerSidePot>
}

export function emptyPokerV2(): PokerV2Accumulator {
  return {
    seatIds: [],
    startingStack: null,
    holeCardsHand: 0,
    holeCardsBySeat: {},
    revealedBySeat: {},
    settledHands: [],
    sidePotAwards: {},
  }
}

const EMPTY_STREET_POTS: PokerStreetPots = { preflop: 0, flop: 0, turn: 0, river: 0 }

/** 已知 engine2 kind（未知 kind 必须完全惰性：不更新任何字段）。 */
const KNOWN_KINDS = new Set([
  'match-config',
  'randomness-established',
  'hand-started',
  'deck-shuffled',
  'hole-cards-dealt',
  'blinds-posted',
  'street-dealt',
  'run-out-started',
  'action-made',
  'cards-revealed',
  'pot-awarded',
  'hand-ended',
  'blind-level-raised',
  'player-eliminated',
  'match-finished',
  'stop-requested',
])

function isStreet(value: unknown): value is keyof PokerStreetPots {
  return value === 'preflop' || value === 'flop' || value === 'turn' || value === 'river'
}

/** sidePotAwards → 按 potIndex 升序的边池列表（主池 potIndex 0 不入列）。 */
function sidePotsOf(awards: Record<number, PokerSidePot>): PokerSidePot[] {
  return Object.keys(awards)
    .map(Number)
    .filter((index) => index > 0 && Number.isFinite(index))
    .sort((a, b) => a - b)
    .map((index) => awards[index])
}

/** seatId → UI 玩家：优先 agentId 精确匹配；否则用 match-config 座位下标对齐。 */
function findPlayer(
  players: PokerUiPlayer[],
  seatId: string | null,
  v2: PokerV2Accumulator,
): { index: number; player: PokerUiPlayer } | null {
  if (!seatId) return null
  const byId = players.findIndex((player) => player.agentId === seatId)
  if (byId >= 0) return { index: byId, player: players[byId] }
  const seatIndex = v2.seatIds.indexOf(seatId)
  if (seatIndex >= 0) {
    const bySeat = players.findIndex((player) => player.seatIndex === seatIndex)
    if (bySeat >= 0) return { index: bySeat, player: players[bySeat] }
  }
  return null
}

/** 物理座位号（match-config 下标）→ 展示用 seatIndex。 */
function seatIndexOf(players: PokerUiPlayer[], seat: number, v2: PokerV2Accumulator): number {
  const seatId = v2.seatIds[seat]
  const found = seatId !== undefined ? findPlayer(players, seatId, v2) : null
  return found ? found.player.seatIndex : seat
}

/**
 * 按视角计算某座位的可见底牌：
 * - 亮牌（cards-revealed，public）两视角都见；
 * - 发牌（hole-cards-dealt，self）god 即时可见；public 仅当该手已 hand-ended。
 */
function visibleHoleCards(v2: PokerV2Accumulator, viewMode: 'god' | 'public', seatId: string): CardVisual[] {
  const revealed = v2.revealedBySeat[seatId]
  if (revealed) return revealed
  const dealt = v2.holeCardsBySeat[seatId]
  if (!dealt) return []
  if (viewMode === 'god' || v2.settledHands.includes(v2.holeCardsHand)) return dealt
  return []
}

/** 底牌可见性相关事件后重刷全部玩家的 holeCards（浅拷贝，仅变更时替换数组）。 */
function refreshHoleCards(players: PokerUiPlayer[], v2: PokerV2Accumulator, viewMode: 'god' | 'public'): PokerUiPlayer[] {
  let changed = false
  const next = players.map((player) => {
    const holeCards = visibleHoleCards(v2, viewMode, player.agentId)
    if (holeCards === player.holeCards) return player
    changed = true
    return { ...player, holeCards }
  })
  return changed ? next : players
}

function upsertPlayer(
  players: PokerUiPlayer[],
  seatId: string | null,
  v2: PokerV2Accumulator,
  patch: (player: PokerUiPlayer) => PokerUiPlayer,
): PokerUiPlayer[] {
  const found = findPlayer(players, seatId, v2)
  if (!found) return players
  const next = patch(found.player)
  if (next === found.player) return players
  const copy = players.slice()
  copy[found.index] = next
  return copy
}

function addStreetBet(streetPots: PokerStreetPots, street: unknown, amount: number): PokerStreetPots {
  if (!isStreet(street) || amount <= 0) return streetPots
  return { ...streetPots, [street]: streetPots[street] + amount }
}

function upsertSidePot(
  awards: Record<number, PokerSidePot>,
  potIndex: number,
  amount: number,
  eligibleSeatIds: string[],
): PokerSidePot[] {
  if (potIndex > 0) awards[potIndex] = { amount, eligiblePlayerIds: eligibleSeatIds }
  return sidePotsOf(awards)
}

/**
 * 归约一个 `poker:v2:*` 信封事件。未知 kind 静默忽略（向前兼容，spec §6），
 * 但事件本体仍会追加进 events 列表（与 v1 reducer 行为一致）。
 */
export function reducePokerV2Event(state: MatchViewProjection, event: GameEvent): MatchViewProjection {
  const kind = engineKindOf(event, POKER_V2_PREFIX)
  const ev = asRecord(event.payload) ?? {}

  const viewMode = state.viewMode
  let v2 = state.pokerV2
  let v2Dirty = false
  const mutV2 = (): PokerV2Accumulator => {
    if (!v2Dirty) {
      v2 = {
        ...state.pokerV2,
        seatIds: [...state.pokerV2.seatIds],
        holeCardsBySeat: { ...state.pokerV2.holeCardsBySeat },
        revealedBySeat: { ...state.pokerV2.revealedBySeat },
        settledHands: [...state.pokerV2.settledHands],
        sidePotAwards: { ...state.pokerV2.sidePotAwards },
      }
      v2Dirty = true
    }
    return v2
  }

  let phase = state.phase
  let handNumber = state.handNumber
  let status = state.status
  let players = state.players
  let communityCards = state.communityCards
  let pot = state.pot
  let streetPots = state.streetPots
  let sidePots = state.sidePots
  let dealerIndex = state.dealerIndex
  let smallBlindIndex = state.smallBlindIndex
  let bigBlindIndex = state.bigBlindIndex
  let stopRequested = state.stopRequested
  let matchComplete = state.matchComplete
  let winnerAgentId = state.winnerAgentId
  let chipHistory = state.chipHistory

  // 手号镜像：已知 kind 的信封都带权威 hand；未知 kind 保持完全惰性。
  const hand = numberOr(ev.hand, 0)
  if (hand > 0 && KNOWN_KINDS.has(kind)) handNumber = hand

  switch (kind) {
    case 'match-config': {
      const acc = mutV2()
      acc.seatIds = Array.isArray(ev.seatIds)
        ? ev.seatIds.filter((item): item is string => typeof item === 'string')
        : []
      acc.startingStack = typeof ev.startingStack === 'number' ? ev.startingStack : null
      if (status === 'waiting') {
        status = 'live'
        phase = 'preflop'
      }
      break
    }
    case 'hand-started': {
      handNumber = Math.max(handNumber, numberOr(ev.handNumber, hand))
      phase = 'preflop'
      status = 'live'
      dealerIndex = seatIndexOf(players, numberOr(ev.buttonSeat, dealerIndex), v2)
      smallBlindIndex = seatIndexOf(players, numberOr(ev.sbSeat, smallBlindIndex), v2)
      bigBlindIndex = seatIndexOf(players, numberOr(ev.bbSeat, bigBlindIndex), v2)
      communityCards = []
      pot = 0
      streetPots = { ...EMPTY_STREET_POTS }
      sidePots = []
      // 新一手：桌面状态复位（弃牌/全下回 active，淘汰除外），底牌回牌背。
      players = players.map((player) => {
        const resetStatus =
          player.status === 'folded' || player.status === 'allIn' ? 'active' : player.status
        if (player.currentBet === 0 && player.status === resetStatus && player.holeCards.length === 0) {
          return player
        }
        return { ...player, currentBet: 0, status: resetStatus, holeCards: [] }
      })
      const acc = mutV2()
      acc.holeCardsHand = handNumber
      acc.holeCardsBySeat = {}
      acc.revealedBySeat = {}
      acc.sidePotAwards = {}
      break
    }
    case 'hole-cards-dealt': {
      const seatId = stringOr(ev.seatId)
      const cards = cardsOr(ev.cards)
      if (!seatId || cards.length === 0) break
      const acc = mutV2()
      if (acc.holeCardsHand !== hand) {
        acc.holeCardsHand = hand
        acc.holeCardsBySeat = {}
      }
      acc.holeCardsBySeat[seatId] = cards
      players = refreshHoleCards(players, acc, viewMode)
      break
    }
    case 'blinds-posted': {
      const posts = Array.isArray(ev.posts) ? ev.posts.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      for (const post of posts) {
        const seatId = stringOr(post.seatId)
        const posted = Math.max(0, numberOr(post.posted, 0))
        const allIn = post.allIn === true
        pot += posted
        streetPots = addStreetBet(streetPots, 'preflop', posted)
        players = upsertPlayer(players, seatId, v2, (player) => {
          const nextStatus = allIn || player.chips - posted <= 0 ? 'allIn' : player.status
          if (player.chips === player.chips - posted && player.currentBet === posted && player.status === nextStatus) {
            return player
          }
          return { ...player, chips: Math.max(0, player.chips - posted), currentBet: posted, status: nextStatus }
        })
      }
      break
    }
    case 'street-dealt': {
      const street = isStreet(ev.street) ? ev.street : null
      const cards = cardsOr(ev.cards)
      if (street) phase = street
      communityCards = [...communityCards, ...cards]
      // 新的一街：桌面下注复位（筹码已扣，桌面注移入池）。
      players = players.some((player) => player.currentBet !== 0)
        ? players.map((player) => (player.currentBet === 0 ? player : { ...player, currentBet: 0 }))
        : players
      break
    }
    case 'run-out-started': {
      phase = 'showdown'
      break
    }
    case 'action-made': {
      const seatId = stringOr(ev.seatId)
      const action = asRecord(ev.action)
      if (!seatId || !action) break
      const type = stringOr(action.type)
      const paid = Math.max(0, numberOr(action.paid, 0))
      const to = numberOr(action.to, Number.NaN)
      const allIn = action.allIn === true
      pot += paid
      streetPots = addStreetBet(streetPots, ev.street, paid)
      players = upsertPlayer(players, seatId, v2, (player) => {
        let nextBet = player.currentBet
        let nextStatus: PokerUiPlayer['status'] = player.status
        if (type === 'fold') {
          nextStatus = 'folded'
        } else if (type === 'bet' || type === 'raise') {
          nextBet = Number.isFinite(to) ? to : player.currentBet + paid
        } else if (type === 'call') {
          nextBet = player.currentBet + paid
        }
        if (allIn) nextStatus = 'allIn'
        const nextChips = Math.max(0, player.chips - paid)
        if (
          nextChips === player.chips &&
          nextBet === player.currentBet &&
          nextStatus === player.status
        ) {
          return player
        }
        return { ...player, chips: nextChips, currentBet: nextBet, status: nextStatus }
      })
      break
    }
    case 'cards-revealed': {
      const seatId = stringOr(ev.seatId)
      const cards = cardsOr(ev.cards)
      if (!seatId || cards.length === 0) break
      const acc = mutV2()
      acc.revealedBySeat[seatId] = cards
      players = refreshHoleCards(players, acc, viewMode)
      phase = 'showdown'
      break
    }
    case 'pot-awarded': {
      const amount = Math.max(0, numberOr(ev.amount, 0))
      const potIndex = numberOr(ev.potIndex, 0)
      const winners = Array.isArray(ev.winners) ? ev.winners.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      const eligible = Array.isArray(ev.eligibleSeatIds)
        ? ev.eligibleSeatIds.filter((item): item is string => typeof item === 'string')
        : []
      pot = Math.max(0, pot - amount)
      for (const winner of winners) {
        const seatId = stringOr(winner.seatId)
        const total = numberOr(winner.total, 0)
        if (!seatId || total === 0) continue
        players = upsertPlayer(players, seatId, v2, (player) =>
          player.chips === player.chips + total ? player : { ...player, chips: player.chips + total },
        )
      }
      sidePots = upsertSidePot(mutV2().sidePotAwards, potIndex, amount, eligible)
      break
    }
    case 'hand-ended': {
      handNumber = Math.max(handNumber, numberOr(ev.handNumber, handNumber))
      const results = Array.isArray(ev.results) ? ev.results.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      for (const result of results) {
        const seatId = stringOr(result.seatId)
        if (!seatId) continue
        const endStack = numberOr(result.endStack, Number.NaN)
        const eliminated = result.eliminated === true
        players = upsertPlayer(players, seatId, v2, (player) => {
          const nextChips = Number.isFinite(endStack) ? endStack : player.chips
          const nextStatus: PokerUiPlayer['status'] = eliminated ? 'eliminated' : player.status
          if (nextChips === player.chips && nextStatus === player.status && player.currentBet === 0) return player
          return { ...player, chips: nextChips, status: nextStatus, currentBet: 0 }
        })
      }
      pot = 0
      const acc = mutV2()
      if (!acc.settledHands.includes(handNumber)) acc.settledHands.push(handNumber)
      // 该手已结算：public 视角的底牌延迟揭示在此刻解锁。
      players = refreshHoleCards(players, acc, viewMode)
      const existing = chipHistory.findIndex((snapshot) => snapshot.handNumber === handNumber)
      const snapshot = {
        handNumber,
        at: Date.now(),
        chips: Object.fromEntries(players.map((player) => [player.agentId, player.chips])),
      }
      chipHistory =
        existing >= 0
          ? [...chipHistory.slice(0, existing), snapshot, ...chipHistory.slice(existing + 1)]
          : [...chipHistory, snapshot]
      break
    }
    case 'blind-level-raised': {
      // 盲注升级无直接 view model 槽位；保留事件即可。
      break
    }
    case 'player-eliminated': {
      const seatId = stringOr(ev.seatId)
      players = upsertPlayer(players, seatId, v2, (player) =>
        player.status === 'eliminated' ? player : { ...player, status: 'eliminated' },
      )
      break
    }
    case 'match-finished': {
      const ranking = Array.isArray(ev.ranking) ? ev.ranking.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      const champion = ranking.find((item) => numberOr(item.rank, Number.MAX_SAFE_INTEGER) === 1)
      const championSeat = champion ? stringOr(champion.seatId) : null
      const championPlayer = championSeat ? findPlayer(players, championSeat, v2) : null
      matchComplete = true
      status = 'settled'
      winnerAgentId = championPlayer ? championPlayer.player.agentId : championSeat
      break
    }
    case 'stop-requested': {
      stopRequested = true
      break
    }
    case 'randomness-established':
    case 'deck-shuffled': {
      // delayed-public 随机性材料：无 view model 槽位（种子复现属工具链）。
      break
    }
    default: {
      // 未知 kind：静默忽略（向前兼容，spec §6）。
      break
    }
  }

  return {
    ...state,
    pokerV2: v2,
    events: [...state.events, { ...event, handNumberAt: handNumber }],
    phase,
    handNumber,
    status,
    players,
    communityCards,
    pot,
    streetPots,
    sidePots,
    dealerIndex,
    smallBlindIndex,
    bigBlindIndex,
    stopRequested,
    matchComplete,
    winnerAgentId,
    chipHistory,
  }
}
