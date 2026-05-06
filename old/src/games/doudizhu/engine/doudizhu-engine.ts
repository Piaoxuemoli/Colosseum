/**
 * DoudizhuEngine — 斗地主引擎，实现 EngineProtocol。
 * 完整实现: 3人, 54张牌, 叫地主竞价, 基础出牌规则。
 */

import type {
  EngineProtocol,
  EngineMeta,
  AvailableActionInfo,
  ActionResult,
} from '../../../core/protocols'
import type {
  DdzGameState,
  DdzAction,
  DdzConfig,
  DdzCard,
} from './ddz-types'
import { createDdzDeck, shuffleDdzDeck, ddzRankValue } from './ddz-types'
import { detectCombo, compareCombo } from './combo-detector'

export class DoudizhuEngine implements EngineProtocol<DdzGameState, DdzAction, DdzConfig> {
  readonly meta: EngineMeta = {
    gameType: 'doudizhu',
    displayName: '斗地主',
    minPlayers: 3,
    maxPlayers: 3,
    phases: ['bidding', 'playing', 'finished'],
  }

  createGame(config: DdzConfig): DdzGameState {
    const deck = shuffleDdzDeck(createDdzDeck())

    // 发牌: 每人17张, 留3张底牌
    const players = config.playerNames.map((name, i) => ({
      id: `ddz-p${i}`,
      name,
      type: 'bot' as const,
      hand: sortHand(deck.slice(i * 17, (i + 1) * 17)),
      role: 'undecided' as const,
    }))

    const kittyCards = deck.slice(51, 54)

    // 随机选一个起始叫分者
    const startBidder = Math.floor(Math.random() * 3)

    return {
      phase: 'bidding',
      players,
      kittyCards,
      currentPlayerIndex: startBidder,
      lastPlay: null,
      lastPlayPlayerIndex: -1,
      baseScore: config.baseScore || 1,
      multiplier: 1,
      roundNumber: 1,
      playHistory: [],
      sessionId: config.sessionId,
      // Bidding state
      bidHistory: [],
      highestBid: 0,
      highestBidder: -1,
    }
  }

  getAvailableActions(state: DdzGameState, playerId: string): AvailableActionInfo[] {
    const player = state.players.find(p => p.id === playerId)
    if (!player || state.players[state.currentPlayerIndex]?.id !== playerId) return []

    // ── Bidding 阶段 ──
    if (state.phase === 'bidding') {
      const actions: AvailableActionInfo[] = [
        { type: 'bid', constraints: { bidScore: { min: 0, max: 0 } } }, // 不叫
      ]
      // 可叫的分数: highestBid+1 到 3
      for (let score = state.highestBid + 1; score <= 3; score++) {
        actions.push({
          type: 'bid',
          constraints: { bidScore: { min: score, max: score } },
        })
      }
      return actions
    }

    // ── Playing 阶段 ──
    if (state.phase !== 'playing') return []

    const actions: AvailableActionInfo[] = [{ type: 'pass' }]

    // 如果是新一轮（上一个出牌的人就是自己，或没人出过牌），不能 pass
    if (state.lastPlayPlayerIndex === state.currentPlayerIndex || state.lastPlay === null) {
      actions.length = 0 // 清除 pass，必须出牌
    }

    actions.push({
      type: 'play',
      constraints: { cards: { min: 1, max: player.hand.length } },
    })

    return actions
  }

  applyAction(state: DdzGameState, action: DdzAction): ActionResult<DdzGameState> {
    const newState = structuredClone(state)
    const playerIdx = newState.players.findIndex(p => p.id === action.playerId)
    if (playerIdx === -1) return { ok: false, error: 'Player not found' }
    if (playerIdx !== newState.currentPlayerIndex) return { ok: false, error: 'Not your turn' }

    // ── Bid 动作 ──
    if (action.type === 'bid') {
      if (newState.phase !== 'bidding') return { ok: false, error: 'Not in bidding phase' }

      const score = action.bidScore ?? 0
      if (score !== 0 && (score <= newState.highestBid || score > 3)) {
        return { ok: false, error: `叫分必须大于当前最高分 ${newState.highestBid} 且不超过 3` }
      }

      // 记录叫分
      newState.bidHistory.push({ playerIndex: playerIdx, score })
      if (score > 0) {
        newState.highestBid = score
        newState.highestBidder = playerIdx
      }

      // 叫 3 分 → 直接成为地主
      if (score === 3) {
        return this._finalizeBidding(newState, playerIdx)
      }

      // 转到下一个玩家
      newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % 3

      // 判断叫分是否结束: 每人都叫过一次
      if (newState.bidHistory.length >= 3) {
        if (newState.highestBidder >= 0) {
          // 有人叫过 → 最高叫分者成为地主
          return this._finalizeBidding(newState, newState.highestBidder)
        }
        // 3 人都不叫 → 重新发牌
        return {
          ok: true,
          state: this.createGame({
            playerNames: state.players.map(p => p.name),
            baseScore: state.baseScore,
            sessionId: state.sessionId,
          }),
          events: [{ type: 'rebid', payload: { reason: '三人都不叫，重新发牌' } }],
        }
      }

      return {
        ok: true,
        state: newState,
        events: [{ type: 'bid', payload: { playerId: action.playerId, score } }],
      }
    }

    // ── Pass 动作 ──
    if (action.type === 'pass') {
      if (newState.phase !== 'playing') return { ok: false, error: 'Not in playing phase' }
      // 如果是新一轮开始，不能 pass
      if (newState.lastPlayPlayerIndex === newState.currentPlayerIndex || newState.lastPlay === null) {
        return { ok: false, error: '新一轮必须出牌，不能 pass' }
      }
      newState.playHistory.push({ playerIndex: playerIdx, combo: null })
      newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % 3
      // 如果回到上次出牌者，开始新一轮
      if (newState.currentPlayerIndex === newState.lastPlayPlayerIndex) {
        newState.lastPlay = null
      }
      return { ok: true, state: newState, events: [{ type: 'pass', payload: { playerId: action.playerId } }] }
    }

    // ── Play 动作 ──
    if (action.type === 'play' && action.cards) {
      if (newState.phase !== 'playing') return { ok: false, error: 'Not in playing phase' }

      const combo = detectCombo(action.cards)
      if (!combo) return { ok: false, error: '不合法的牌型' }

      // 验证玩家手中有这些牌
      const player = newState.players[playerIdx]
      const handCopy = [...player.hand]
      for (const card of action.cards) {
        const idx = handCopy.findIndex(c => c.rank === card.rank && c.suit === card.suit)
        if (idx === -1) return { ok: false, error: '你没有这张牌' }
        handCopy.splice(idx, 1)
      }

      // 如果有上次出牌，检查是否压得过
      if (newState.lastPlay) {
        const cmp = compareCombo(combo, newState.lastPlay)
        if (cmp <= 0) return { ok: false, error: '出的牌必须比上家大' }
      }

      // 从手牌中移除
      player.hand = handCopy

      // 炸弹/火箭加倍
      if (combo.type === 'bomb' || combo.type === 'rocket') {
        newState.multiplier *= 2
      }

      newState.lastPlay = combo
      newState.lastPlayPlayerIndex = playerIdx
      newState.playHistory.push({ playerIndex: playerIdx, combo })

      // 检查是否出完 → 结束
      if (player.hand.length === 0) {
        newState.phase = 'finished'
        return {
          ok: true,
          state: newState,
          events: [{
            type: 'game_over',
            payload: {
              winnerId: player.id,
              winnerRole: player.role,
              score: newState.baseScore * newState.multiplier,
            },
          }],
        }
      }

      newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % 3
      return { ok: true, state: newState, events: [{ type: 'play', payload: { playerId: action.playerId, combo: combo.type } }] }
    }

    return { ok: false, error: 'Unknown action type' }
  }

  /** 叫分结束，确定地主，进入 playing 阶段 */
  private _finalizeBidding(state: DdzGameState, landlordIdx: number): ActionResult<DdzGameState> {
    state.players[landlordIdx].role = 'landlord'
    state.players[landlordIdx].hand = sortHand([...state.players[landlordIdx].hand, ...state.kittyCards])
    for (let i = 0; i < 3; i++) {
      if (i !== landlordIdx) state.players[i].role = 'peasant'
    }
    state.baseScore = state.highestBid || 1
    state.phase = 'playing'
    state.currentPlayerIndex = landlordIdx
    state.lastPlay = null
    state.lastPlayPlayerIndex = -1

    return {
      ok: true,
      state,
      events: [{
        type: 'landlord_decided',
        payload: {
          landlordId: state.players[landlordIdx].id,
          landlordName: state.players[landlordIdx].name,
          bidScore: state.highestBid,
        },
      }],
    }
  }

  validateAction(state: DdzGameState, action: DdzAction): { valid: boolean; error?: string } {
    if (action.type === 'bid') {
      if (state.phase !== 'bidding') return { valid: false, error: 'Not in bidding phase' }
      const score = action.bidScore ?? 0
      if (score !== 0 && (score <= state.highestBid || score > 3)) {
        return { valid: false, error: `叫分必须大于 ${state.highestBid}` }
      }
      return { valid: true }
    }
    if (state.phase !== 'playing') return { valid: false, error: 'Game not in playing phase' }
    const playerIdx = state.players.findIndex(p => p.id === action.playerId)
    if (playerIdx !== state.currentPlayerIndex) return { valid: false, error: 'Not your turn' }
    if (action.type === 'pass') {
      if (state.lastPlayPlayerIndex === state.currentPlayerIndex || state.lastPlay === null) {
        return { valid: false, error: '新一轮必须出牌' }
      }
      return { valid: true }
    }
    if (action.type === 'play' && action.cards) {
      const combo = detectCombo(action.cards)
      if (!combo) return { valid: false, error: '不合法的牌型' }
      if (state.lastPlay) {
        const cmp = compareCombo(combo, state.lastPlay)
        if (cmp <= 0) return { valid: false, error: '出的牌必须比上家大' }
      }
      return { valid: true }
    }
    return { valid: false, error: 'Invalid action' }
  }

  serialize(state: DdzGameState): string {
    return JSON.stringify(state)
  }

  deserialize(data: string): DdzGameState {
    return JSON.parse(data) as DdzGameState
  }
}

/** 手牌排序 (升序) */
function sortHand(cards: DdzCard[]): DdzCard[] {
  return [...cards].sort((a, b) => ddzRankValue(a.rank) - ddzRankValue(b.rank))
}
