// 牌张与牌堆基础：纯数据 + 纯函数（PFR-201 的输入层）。
// 花色永不参与大小比较（PFR-201）；点数值 2..14。

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const
export type Suit = (typeof SUITS)[number]

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export type Rank = (typeof RANKS)[number]

export interface Card {
  rank: Rank
  suit: Suit
}

const SUIT_CHAR: Record<Suit, string> = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' }
const CHAR_SUIT: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }

export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2
}

export function cardCode(card: Card): string {
  return `${card.rank}${SUIT_CHAR[card.suit]}`
}

export function cardCodes(cards: readonly Card[]): string[] {
  return cards.map(cardCode)
}

export function parseCard(code: string): Card {
  if (code.length !== 2) {
    throw new Error(`parseCard: 非法牌码 ${code}`)
  }
  const rank = code[0] as Rank
  const suit = CHAR_SUIT[code[1]]
  if (!(RANKS as readonly string[]).includes(rank) || !suit) {
    throw new Error(`parseCard: 非法牌码 ${code}`)
  }
  return { rank, suit }
}

export function parseCards(codes: readonly string[]): Card[] {
  return codes.map(parseCard)
}

/** 52 张有序基准牌堆（顺序固定：花色 × 点数），洗牌的唯一输入。 */
export function createOrderedDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit })
    }
  }
  return deck
}

/**
 * 发牌布局约定（PFR-203，无烧牌）：
 * 底牌按座位升序每家 2 张，随后依次为 flop(3) / turn(1) / river(1)。
 * 引擎与测试共用该约定，保证"种子 → 牌序"可独立复现（PFR-404）。
 */
export function dealLayout(deck: readonly Card[], playerCount: number): { holeCards: Card[][]; board: Card[] } {
  const holeCards: Card[][] = []
  let idx = 0
  for (let i = 0; i < playerCount; i++) {
    holeCards.push([deck[idx], deck[idx + 1]])
    idx += 2
  }
  return { holeCards, board: deck.slice(idx, idx + 5) }
}
