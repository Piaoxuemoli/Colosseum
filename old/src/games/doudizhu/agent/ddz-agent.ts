/**
 * 斗地主 Agent 适配 — ContextBuilder, ResponseParser, BotStrategy
 */

import type {
  ContextBuilder,
  ResponseParser,
  ParseResult,
  BotStrategy,
  AvailableActionInfo,
  AgentPersonality,
  GameEvent,
  ImpressionConfig,
} from '../../../core/protocols'
import type { DdzGameState, DdzAction, DdzCard } from '../engine/ddz-types'
import { ddzCardToString, ddzRankValue } from '../engine/ddz-types'

/** 斗地主上下文拼装器 */
export class DdzContextBuilder implements ContextBuilder<DdzGameState, DdzAction> {
  buildSystemPrompt(
    personality: AgentPersonality,
    _impressions: Record<string, Record<string, number>>,
  ): string {
    return `你是 ${personality.name}，一位经验丰富的斗地主玩家。
${personality.systemPrompt || '策略灵活，善于记牌和配合。'}

## 游戏规则
- 3人斗地主，1个地主 vs 2个农民
- 先经过叫地主阶段：每人可叫 1/2/3 分或不叫，叫分最高者成为地主
- 地主获得3张底牌，先出牌，按顺序出牌
- 牌型：单张、对子、三带一、三带一对、顺子(≥5张)、炸弹(四张同)、火箭(双王)
- 大的牌型可以压过小的同类型，炸弹压一切，火箭最大
- 先出完手牌的一方获胜

## 回复格式
先在 <thinking> 中分析，再在 <action> 中给出操作。
叫地主: <action>bid 2</action> (叫2分) 或 <action>bid 0</action> (不叫)
出牌: <action>play 3♥ 3♠ 3♣</action>
不出: <action>pass</action>`
  }

  buildUserPrompt(
    state: DdzGameState,
    playerId: string,
    actions: AvailableActionInfo[],
  ): string {
    const player = state.players.find(p => p.id === playerId)
    if (!player) return ''

    const handStr = player.hand.map(ddzCardToString).join(' ')

    // ── Bidding 阶段 ──
    if (state.phase === 'bidding') {
      const bidHistoryStr = state.bidHistory.length > 0
        ? state.bidHistory.map(b => {
            const p = state.players[b.playerIndex]
            return `${p.name}: ${b.score === 0 ? '不叫' : `${b.score}分`}`
          }).join(', ')
        : '暂无叫分'

      // 从 actions 提取可用叫分
      const availableScores = actions
        .filter(a => a.type === 'bid')
        .map(a => a.constraints?.bidScore?.min ?? 0)
      const scoreOptions = availableScores.map(s => s === 0 ? '不叫(bid 0)' : `${s}分(bid ${s})`).join(' / ')

      return `【叫地主阶段】
你的手牌 (${player.hand.length}张): ${handStr}
叫分情况: ${bidHistoryStr}
当前最高叫分: ${state.highestBid === 0 ? '无' : `${state.highestBid}分`}
你可以选择: ${scoreOptions}

提示：手牌好（有炸弹、火箭、大牌多）可以叫高分当地主。手牌差则不叫。`
    }

    // ── Playing 阶段 ──
    const roleStr = player.role === 'landlord' ? '地主' : '农民'
    const otherInfo = state.players
      .filter(p => p.id !== playerId)
      .map(p => `${p.name}(${p.role === 'landlord' ? '地主' : '农民'}): ${p.hand.length}张`)
      .join(', ')

    const lastPlayStr = state.lastPlay
      ? `上家出了: ${state.lastPlay.type} [${state.lastPlay.cards.map(ddzCardToString).join(' ')}]`
      : '新一轮，你先出牌'

    const canPass = actions.some(a => a.type === 'pass')

    return `你的身份: ${roleStr}
你的手牌 (${player.hand.length}张): ${handStr}
对手: ${otherInfo}
${lastPlayStr}
可用操作: ${canPass ? 'play / pass' : 'play (必须出牌)'}`
  }

  buildImpressionPrompt(
    _state: DdzGameState,
    _events: GameEvent[],
    _currentImpressions: Record<string, Record<string, number>>,
  ): string {
    return ''
  }

  buildRetryPrompt(error: string, _availableActions: string[]): string {
    return `你的回复格式不正确: ${error}。请重新回复。
叫地主: <action>bid 2</action> 或 <action>bid 0</action>
出牌: <action>play 3♥ 3♠</action>
不出: <action>pass</action>`
  }

  buildHandSummary(state: DdzGameState): string {
    return `斗地主第 ${state.roundNumber} 轮, 倍数: ${state.multiplier}`
  }
}

/** 斗地主响应解析器 */
export class DdzResponseParser implements ResponseParser<DdzAction> {
  parseAction(raw: string, availableTypes: string[]): ParseResult<DdzAction> {
    // 提取 <action>...</action>
    const match = raw.match(/<action>([\s\S]*?)<\/action>/)
    if (!match) return { ok: false, error: 'No <action> tag found' }

    const content = match[1].trim().toLowerCase()

    // ── Bid 解析 ──
    if (content.startsWith('bid')) {
      if (!availableTypes.includes('bid')) {
        return { ok: false, error: 'Bid not allowed in current phase' }
      }
      const scoreStr = content.replace('bid', '').trim()
      const score = parseInt(scoreStr, 10)
      if (isNaN(score) || score < 0 || score > 3) {
        return { ok: false, error: `Invalid bid score: ${scoreStr}` }
      }
      return { ok: true, action: { type: 'bid', playerId: '', bidScore: score } }
    }

    // ── Pass 解析 ──
    if (content === 'pass') {
      if (!availableTypes.includes('pass')) {
        return { ok: false, error: 'Pass not allowed — must play' }
      }
      return { ok: true, action: { type: 'pass', playerId: '' } }
    }

    // ── Play 解析 ──
    if (content.startsWith('play')) {
      const cardsStr = content.replace('play', '').trim()
      if (!cardsStr) return { ok: false, error: 'No cards specified' }

      const cardTokens = cardsStr.split(/\s+/)
      const cards: DdzCard[] = []

      for (const token of cardTokens) {
        const card = parseCardToken(token)
        if (!card) return { ok: false, error: `Cannot parse card: ${token}` }
        cards.push(card)
      }

      return { ok: true, action: { type: 'play', playerId: '', cards } }
    }

    return { ok: false, error: `Unknown action: ${content}` }
  }

  parseImpressions(
    _raw: string,
    _dimensionKeys: string[],
  ): Record<string, Record<string, number>> | null {
    return null
  }
}

/** 解析单张牌 token (如 "3♥" "JOKER_S" "10♠") */
function parseCardToken(token: string): DdzCard | null {
  if (token.includes('joker_s') || token === '🃏小') return { suit: 'joker', rank: 'JOKER_S' }
  if (token.includes('joker_b') || token === '🃏大') return { suit: 'joker', rank: 'JOKER_B' }

  const suitMap: Record<string, DdzCard['suit']> = {
    '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs', '♠': 'spades',
    'h': 'hearts', 'd': 'diamonds', 'c': 'clubs', 's': 'spades',
  }

  // Try to split rank + suit
  for (const [sym, suit] of Object.entries(suitMap)) {
    if (token.includes(sym)) {
      const rank = token.replace(sym, '').toUpperCase()
      if (isValidRank(rank)) return { suit, rank: rank as DdzCard['rank'] }
    }
  }

  // Bare rank (assign default suit)
  const upperToken = token.toUpperCase()
  if (isValidRank(upperToken)) return { suit: 'hearts', rank: upperToken as DdzCard['rank'] }

  return null
}

function isValidRank(r: string): boolean {
  return ['3','4','5','6','7','8','9','10','J','Q','K','A','2'].includes(r)
}

/** 斗地主 Bot 策略 — 支持 bidding + playing，覆盖全部牌型 */
export class DdzBotStrategy implements BotStrategy<DdzGameState, DdzAction> {
  chooseAction(state: DdzGameState, playerId: string): DdzAction {
    const player = state.players.find(p => p.id === playerId)
    if (!player) return { type: 'pass', playerId }

    // ── Bidding 阶段 ──
    if (state.phase === 'bidding') {
      return this._chooseBid(state, player, playerId)
    }

    // ── Playing 阶段 ──
    const isNewRound = state.lastPlayPlayerIndex === state.currentPlayerIndex || state.lastPlay === null
    if (!isNewRound) {
      const playable = findPlayableCombo(player.hand, state.lastPlay!)
      if (playable) {
        return { type: 'play', playerId, cards: playable }
      }
      return { type: 'pass', playerId }
    }

    // 新一轮: 选择最佳起手牌
    const lead = chooseBestLead(player.hand)
    return { type: 'play', playerId, cards: lead }
  }

  /** 叫分策略: 根据手牌质量评估 */
  private _chooseBid(state: DdzGameState, player: { hand: DdzCard[] }, playerId: string): DdzAction {
    let strength = 0

    const countMap = new Map<number, number>()
    for (const c of player.hand) {
      const v = ddzRankValue(c.rank)
      countMap.set(v, (countMap.get(v) || 0) + 1)
    }

    // 炸弹 (+2 each)
    for (const [, count] of countMap) {
      if (count === 4) strength += 2
    }

    // 火箭 (+3)
    const hasJokerS = player.hand.some(c => c.rank === 'JOKER_S')
    const hasJokerB = player.hand.some(c => c.rank === 'JOKER_B')
    if (hasJokerS && hasJokerB) strength += 3

    // 大牌 (2, A, K 各 +0.5)
    const bigCards = player.hand.filter(c => ['2', 'A', 'K'].includes(c.rank))
    strength += bigCards.length * 0.5

    let bidScore = 0
    if (strength >= 5) bidScore = 3
    else if (strength >= 3) bidScore = 2
    else if (strength >= 1.5) bidScore = 1

    if (bidScore > 0 && bidScore <= state.highestBid) {
      bidScore = 0
    }

    return { type: 'bid', playerId, bidScore }
  }
}

// ── 手牌分析工具 ──

interface HandAnalysis {
  countMap: Map<number, DdzCard[]>   // rankValue → cards
  singles: DdzCard[][]
  pairs: DdzCard[][]
  triples: DdzCard[][]
  bombs: DdzCard[][]
  rocket: DdzCard[] | null
}

function analyzeHand(hand: DdzCard[]): HandAnalysis {
  const countMap = new Map<number, DdzCard[]>()
  for (const c of hand) {
    const v = ddzRankValue(c.rank)
    if (!countMap.has(v)) countMap.set(v, [])
    countMap.get(v)!.push(c)
  }

  const singles: DdzCard[][] = []
  const pairs: DdzCard[][] = []
  const triples: DdzCard[][] = []
  const bombs: DdzCard[][] = []

  // 按 rank 值排序遍历
  const sortedEntries = Array.from(countMap.entries()).sort((a, b) => a[0] - b[0])
  for (const [, cards] of sortedEntries) {
    if (cards.length === 1) singles.push(cards)
    else if (cards.length === 2) pairs.push(cards)
    else if (cards.length === 3) triples.push(cards)
    else if (cards.length === 4) bombs.push(cards)
  }

  // 火箭
  const hasJS = hand.find(c => c.rank === 'JOKER_S')
  const hasJB = hand.find(c => c.rank === 'JOKER_B')
  const rocket = (hasJS && hasJB) ? [hasJS, hasJB] : null

  return { countMap, singles, pairs, triples, bombs, rocket }
}

/** 找到所有可能的顺子 */
function findStraights(hand: DdzCard[]): DdzCard[][] {
  const result: DdzCard[][] = []
  const sorted = [...hand].sort((a, b) => ddzRankValue(a.rank) - ddzRankValue(b.rank))
  // 过滤掉 2 和 Joker (rank value >= 12)
  const eligible = sorted.filter(c => ddzRankValue(c.rank) < 12)

  // 按 rank 去重（每个 rank 取一张）
  const byRank = new Map<number, DdzCard>()
  for (const c of eligible) {
    const v = ddzRankValue(c.rank)
    if (!byRank.has(v)) byRank.set(v, c)
  }

  const rankValues = Array.from(byRank.keys()).sort((a, b) => a - b)

  // 滑动窗口找连续序列
  for (let start = 0; start < rankValues.length; start++) {
    const seq: DdzCard[] = [byRank.get(rankValues[start])!]
    for (let end = start + 1; end < rankValues.length; end++) {
      if (rankValues[end] !== rankValues[end - 1] + 1) break
      seq.push(byRank.get(rankValues[end])!)
      if (seq.length >= 5) {
        result.push([...seq])
      }
    }
  }

  return result
}

/** 新一轮选择最佳起手牌（不只出单张） */
function chooseBestLead(hand: DdzCard[]): DdzCard[] {
  const analysis = analyzeHand(hand)

  // 优先出顺子（消耗最多牌）
  const straights = findStraights(hand)
  if (straights.length > 0) {
    // 选最长的顺子，同长选最小的
    straights.sort((a, b) => b.length - a.length || ddzRankValue(a[0].rank) - ddzRankValue(b[0].rank))
    return straights[0]
  }

  // 三带一/三带对（优先消耗三张）
  if (analysis.triples.length > 0) {
    const triple = analysis.triples[0] // 最小的三张
    // 找一个带牌
    if (analysis.singles.length > 0) {
      return [...triple, analysis.singles[0][0]] // 三带一
    }
    if (analysis.pairs.length > 0) {
      return [...triple, ...analysis.pairs[0]] // 三带对
    }
    return triple // 三不带
  }

  // 对子
  if (analysis.pairs.length > 0) {
    return analysis.pairs[0] // 最小的对子
  }

  // 单张（最小的）
  const sorted = [...hand].sort((a, b) => ddzRankValue(a.rank) - ddzRankValue(b.rank))
  return [sorted[0]]
}

/** 找到一个能压过 lastPlay 的牌组合 — 覆盖全牌型 */
function findPlayableCombo(hand: DdzCard[], lastPlay: { type: string; mainRank: number; cards: DdzCard[] }): DdzCard[] | null {
  const analysis = analyzeHand(hand)

  // ── 按牌型匹配 ──

  if (lastPlay.type === 'single') {
    // 找更大的单张
    const sorted = [...hand].sort((a, b) => ddzRankValue(a.rank) - ddzRankValue(b.rank))
    const card = sorted.find(c => ddzRankValue(c.rank) > lastPlay.mainRank)
    if (card) return [card]
  }

  if (lastPlay.type === 'pair') {
    for (const pair of analysis.pairs) {
      if (ddzRankValue(pair[0].rank) > lastPlay.mainRank) return pair
    }
    // 从三张中拆对
    for (const triple of analysis.triples) {
      if (ddzRankValue(triple[0].rank) > lastPlay.mainRank) return triple.slice(0, 2)
    }
  }

  if (lastPlay.type === 'triple') {
    for (const triple of analysis.triples) {
      if (ddzRankValue(triple[0].rank) > lastPlay.mainRank) return triple
    }
  }

  if (lastPlay.type === 'triple_one') {
    for (const triple of analysis.triples) {
      if (ddzRankValue(triple[0].rank) > lastPlay.mainRank) {
        // 找一个带牌（不是这个三张本身）
        const kicker = hand.find(c => ddzRankValue(c.rank) !== ddzRankValue(triple[0].rank))
        if (kicker) return [...triple, kicker]
        return triple // 实在没带牌就出三不带（引擎会拒绝，fallback）
      }
    }
  }

  if (lastPlay.type === 'triple_pair') {
    for (const triple of analysis.triples) {
      if (ddzRankValue(triple[0].rank) > lastPlay.mainRank) {
        // 找一个对子带牌
        const kickerPair = analysis.pairs.find(p => ddzRankValue(p[0].rank) !== ddzRankValue(triple[0].rank))
        if (kickerPair) return [...triple, ...kickerPair]
      }
    }
  }

  if (lastPlay.type === 'straight') {
    const needed = lastPlay.cards.length
    const straights = findStraights(hand)
    // 找同长度且更大的顺子
    const valid = straights
      .filter(s => s.length === needed && ddzRankValue(s[s.length - 1].rank) > lastPlay.mainRank)
      .sort((a, b) => ddzRankValue(a[0].rank) - ddzRankValue(b[0].rank))
    if (valid.length > 0) return valid[0]
  }

  if (lastPlay.type === 'bomb') {
    // 找更大的炸弹
    for (const bomb of analysis.bombs) {
      if (ddzRankValue(bomb[0].rank) > lastPlay.mainRank) return bomb
    }
    // 火箭压炸弹
    if (analysis.rocket) return analysis.rocket
    return null
  }

  // ── 炸弹/火箭兜底（任何类型都可以用炸弹压） ──
  if (lastPlay.type !== 'rocket') {
    if (analysis.bombs.length > 0) return analysis.bombs[0]
    if (analysis.rocket) return analysis.rocket
  }

  return null
}

/** 斗地主印象配置 */
export const ddzImpressionConfig: ImpressionConfig = {
  dimensions: [
    { key: 'aggression', label: '攻击性', description: '1=保守 10=激进', range: [1, 10], default: 5 },
    { key: 'cooperation', label: '配合度', description: '1=独行 10=善于配合', range: [1, 10], default: 5 },
    { key: 'memory', label: '记牌能力', description: '1=不记 10=全记', range: [1, 10], default: 5 },
  ],
  emaAlpha: 0.3,
}
