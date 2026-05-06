/**
 * 斗地主类型定义
 */

/** 斗地主花色 (含大小王) */
export type DdzSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker'

/** 斗地主牌面 (3-2 升序, 含大小王) */
export type DdzRank = '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A' | '2' | 'JOKER_S' | 'JOKER_B'

export interface DdzCard {
  suit: DdzSuit
  rank: DdzRank
}

/** 斗地主牌面大小 (3=0, ..., 2=12, 小王=13, 大王=14) */
export function ddzRankValue(rank: DdzRank): number {
  const order: DdzRank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_S', 'JOKER_B']
  return order.indexOf(rank)
}

/** 牌型 */
export type ComboType =
  | 'single'      // 单张
  | 'pair'         // 对子
  | 'triple'       // 三不带
  | 'triple_one'   // 三带一
  | 'triple_pair'  // 三带一对
  | 'straight'     // 顺子 (>=5张)
  | 'bomb'         // 炸弹 (四张)
  | 'rocket'       // 火箭 (双王)
  | 'pass'         // 不出

export interface CardCombo {
  type: ComboType
  cards: DdzCard[]
  /** 主牌面值 (用于比较大小) */
  mainRank: number
}

/** 游戏阶段 */
export type DdzPhase = 'bidding' | 'playing' | 'finished'

/** 玩家角色 */
export type DdzRole = 'landlord' | 'peasant' | 'undecided'

/** 斗地主玩家 */
export interface DdzPlayer {
  id: string
  name: string
  type: 'human' | 'bot' | 'llm'
  hand: DdzCard[]
  role: DdzRole
  profileId?: string
  systemPrompt?: string
}

/** 斗地主游戏状态 */
export interface DdzGameState {
  phase: DdzPhase
  players: DdzPlayer[]
  /** 底牌 (3张) */
  kittyCards: DdzCard[]
  /** 当前出牌者索引 */
  currentPlayerIndex: number
  /** 上一个有效出牌 */
  lastPlay: CardCombo | null
  /** 上一个有效出牌者索引 */
  lastPlayPlayerIndex: number
  /** 底分 */
  baseScore: number
  /** 倍数 */
  multiplier: number
  /** 轮数 */
  roundNumber: number
  /** 出牌历史 */
  playHistory: Array<{ playerIndex: number; combo: CardCombo | null }>
  /** Session ID */
  sessionId: string

  // ── Bidding 阶段 ──
  /** 叫分记录 */
  bidHistory: Array<{ playerIndex: number; score: number }>
  /** 当前最高叫分 (0=无人叫, 1/2/3) */
  highestBid: number
  /** 最高叫分者 index (-1=无) */
  highestBidder: number
}

/** 斗地主动作 */
export interface DdzAction {
  type: 'bid' | 'play' | 'pass'
  playerId: string
  cards?: DdzCard[]
  /** 叫分 (0=不叫, 1/2/3=叫分) — 仅 type='bid' 时使用 */
  bidScore?: number
}

/** 斗地主配置 */
export interface DdzConfig {
  playerNames: string[]
  baseScore: number
  sessionId: string
}

/** 创建 54 张斗地主牌组 */
export function createDdzDeck(): DdzCard[] {
  const deck: DdzCard[] = []
  const suits: DdzSuit[] = ['hearts', 'diamonds', 'clubs', 'spades']
  const ranks: DdzRank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank })
    }
  }
  // 大小王
  deck.push({ suit: 'joker', rank: 'JOKER_S' })
  deck.push({ suit: 'joker', rank: 'JOKER_B' })

  return deck // 54 张
}

/** 洗牌 */
export function shuffleDdzDeck(deck: DdzCard[]): DdzCard[] {
  const s = [...deck]
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  return s
}

/** 卡牌显示 */
export function ddzCardToString(card: DdzCard): string {
  if (card.rank === 'JOKER_S') return '🃏小'
  if (card.rank === 'JOKER_B') return '🃏大'
  const suitChar: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }
  return `${suitChar[card.suit] || ''}${card.rank}`
}
