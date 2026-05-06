# Phase 1a-3 — Poker 引擎算法层（Task 9-13）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `old/src/games/poker/engine/` 里的 Card/Deck/Evaluator/PotManager/Equity 纯算法移植过来，带完整单测。再加上新写的 poker-types.ts（zod schema + TS 类型）。

**前置条件：** P1a-1 + P1a-2 完成。

**参考：**
- spec 第 5.2 节（Poker 规则）
- 源文件：`old/src/games/poker/engine/{deck,evaluator,equity,pot-manager}.ts`

**已知风险（执行时注意）：**
- old evaluator/equity 的导出 API 签名需要 grep 核对（plan 里写的是猜测）
- 所有 import 路径要从 `../../../types/card` 改到 `./card`

**下一份：** `2026-05-06-phase-1a-4-engine-state.md`（poker 状态机：applyAction / 街切换 / 结算）。

---

## Task 9: Card 类型 + Deck 工具（抄自 old）

**Files:**
- Create: `games/poker/engine/card.ts`
- Create: `games/poker/engine/deck.ts`
- Create: `games/poker/engine/__tests__/deck.test.ts`

**Source:** `old/src/types/card.ts` + `old/src/games/poker/engine/deck.ts`

- [x] **Step 1: 抄 Card 类型**

Create `games/poker/engine/card.ts`（基于 `old/src/types/card.ts`，增加可选 `rng` 参数便于种子化测试）：

```typescript
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const
export type Suit = (typeof SUITS)[number]

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export type Rank = (typeof RANKS)[number]

export interface Card {
  suit: Suit
  rank: Rank
}

export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2
}

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

export function shuffleDeck(deck: Card[], rng: () => number = Math.random): Card[] {
  const s = [...deck]
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  return s
}

export function cardToString(card: Card): string {
  const suitChar: Record<Suit, string> = {
    hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's',
  }
  return `${card.rank}${suitChar[card.suit]}`
}
```

- [x] **Step 2: 抄 deck 工具**

Create `games/poker/engine/deck.ts`:

```typescript
import type { Card } from './card'

export interface DealResult {
  dealt: Card[]
  remaining: Card[]
}

export function dealCards(deck: Card[], count: number): DealResult {
  if (deck.length < count) {
    throw new Error(`Not enough cards: need ${count}, have ${deck.length}`)
  }
  return { dealt: deck.slice(0, count), remaining: deck.slice(count) }
}
```

- [x] **Step 3: 写测试**

Create `games/poker/engine/__tests__/deck.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createDeck, shuffleDeck, cardToString, rankValue } from '../card'
import { dealCards } from '../deck'

describe('poker/engine/card', () => {
  it('createDeck returns 52 unique cards', () => {
    const d = createDeck()
    expect(d.length).toBe(52)
    const set = new Set(d.map((c) => `${c.rank}${c.suit}`))
    expect(set.size).toBe(52)
  })

  it('shuffleDeck with fixed seed is deterministic', () => {
    const seeded = () => 0.42
    const a = shuffleDeck(createDeck(), seeded)
    const b = shuffleDeck(createDeck(), seeded)
    expect(a.map(cardToString)).toEqual(b.map(cardToString))
  })

  it('rankValue A=14, 2=2', () => {
    expect(rankValue('A')).toBe(14)
    expect(rankValue('2')).toBe(2)
  })

  it('cardToString formats correctly', () => {
    expect(cardToString({ suit: 'hearts', rank: 'A' })).toBe('Ah')
    expect(cardToString({ suit: 'clubs', rank: 'T' })).toBe('Tc')
  })
})

describe('poker/engine/deck', () => {
  it('dealCards splits deck correctly', () => {
    const d = createDeck()
    const { dealt, remaining } = dealCards(d, 5)
    expect(dealt.length).toBe(5)
    expect(remaining.length).toBe(47)
  })

  it('dealCards throws when not enough', () => {
    expect(() => dealCards(createDeck().slice(0, 3), 5)).toThrow(/Not enough/)
  })
})
```

- [x] **Step 4: 跑测试**

Run: `npm test games/poker/engine/__tests__/deck.test.ts`
Expected: 6 passed。

- [x] **Step 5: Commit**

```bash
git add games/poker/engine/card.ts games/poker/engine/deck.ts games/poker/engine/__tests__/deck.test.ts
git commit -m "feat(p1a): poker card + deck (ported from old/ with seed-aware shuffle)"
```

---

## Task 10: Evaluator（抄自 old）

**Files:**
- Create: `games/poker/engine/evaluator.ts`
- Create: `games/poker/engine/__tests__/evaluator.test.ts`

**Source:** `old/src/games/poker/engine/evaluator.ts`（243 行算法）

- [x] **Step 1: 原样复制 + 适配 import**

Run:
```bash
cp old/src/games/poker/engine/evaluator.ts games/poker/engine/evaluator.ts
```

手工编辑 `games/poker/engine/evaluator.ts`：
- 把所有 `from '../../../types/card'` 改成 `from './card'`
- 其他 import 同理调整

**验证方式：** `grep -n "^import" games/poker/engine/evaluator.ts` 确认所有 import 指向 `./card`。

- [x] **Step 2: 写教科书测试**

Create `games/poker/engine/__tests__/evaluator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Card } from '../card'
import { evaluateHand } from '../evaluator'

function c(s: string): Card {
  return {
    rank: s[0] as Card['rank'],
    suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[
      s[1] as 'h' | 'd' | 'c' | 's'
    ],
  }
}
function cards(...strs: string[]): Card[] {
  return strs.map(c)
}

describe('evaluateHand', () => {
  it('royal flush beats straight flush', () => {
    const royal = evaluateHand(cards('Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '3d'))
    const straight = evaluateHand(cards('9h', '8h', '7h', '6h', '5h', 'Ac', '2d'))
    expect(royal.value).toBeGreaterThan(straight.value)
  })

  it('four of a kind beats full house', () => {
    const quads = evaluateHand(cards('Ah', 'As', 'Ac', 'Ad', 'Kh', '2c', '3d'))
    const full = evaluateHand(cards('Kh', 'Ks', 'Kc', 'Qh', 'Qd', '2c', '3d'))
    expect(quads.value).toBeGreaterThan(full.value)
  })

  it('flush beats straight', () => {
    const flush = evaluateHand(cards('Ah', '9h', '7h', '5h', '3h', '2c', 'Kd'))
    const straight = evaluateHand(cards('9h', '8c', '7d', '6h', '5s', 'Ac', '2d'))
    expect(flush.value).toBeGreaterThan(straight.value)
  })

  it('wheel A-2-3-4-5 is lowest straight', () => {
    const wheel = evaluateHand(cards('Ah', '2c', '3d', '4h', '5s', 'Kh', 'Qc'))
    const broadway = evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', 'Ts', '2c', '3d'))
    expect(broadway.value).toBeGreaterThan(wheel.value)
  })

  it('identical high-card hands tie', () => {
    const a = evaluateHand(cards('Ah', 'Kc', 'Qd', 'Jh', 'Ts', '2c', '3d'))
    const b = evaluateHand(cards('As', 'Kh', 'Qc', 'Jd', 'Tc', '2h', '3s'))
    expect(a.value).toBe(b.value)
  })
})
```

**注意：** 若 evaluator 导出名/签名不同，先 `grep -n "^export" games/poker/engine/evaluator.ts` 看真实 API，按实际改测试。

- [x] **Step 3: 跑测试**

Run: `npm test games/poker/engine/__tests__/evaluator.test.ts`
Expected: 5 passed。

- [x] **Step 4: Commit**

```bash
git add games/poker/engine/evaluator.ts games/poker/engine/__tests__/evaluator.test.ts
git commit -m "feat(p1a): port hand evaluator from old/ with textbook tests"
```

---

## Task 11: Pot manager（边池）

**Files:**
- Create: `games/poker/engine/pot-manager.ts`
- Create: `games/poker/engine/__tests__/pot-manager.test.ts`

**Source:** `old/src/games/poker/engine/pot-manager.ts`（77 行）

- [x] **Step 1: 写实现（基于 old，就地定义 SidePot 去掉 game types 依赖）**

Create `games/poker/engine/pot-manager.ts`:

```typescript
export interface PlayerBet {
  playerId: string
  amount: number
  isAllIn: boolean
  isFolded: boolean
}

export interface SidePot {
  amount: number
  eligiblePlayerIds: string[]
}

export function calculateSidePots(bets: PlayerBet[]): SidePot[] {
  if (bets.length === 0) return []
  const sorted = [...bets].sort((a, b) => a.amount - b.amount)
  const pots: SidePot[] = []
  let previousLevel = 0

  for (let i = 0; i < sorted.length; i++) {
    const currentAmount = sorted[i].amount
    if (currentAmount <= previousLevel) continue

    const levelDiff = currentAmount - previousLevel
    const contributors = sorted.filter((b) => b.amount > previousLevel)
    const eligible = contributors.filter((b) => !b.isFolded).map((b) => b.playerId)
    const potAmount = levelDiff * contributors.length

    if (potAmount > 0 && eligible.length > 0) {
      pots.push({ amount: potAmount, eligiblePlayerIds: eligible })
    } else if (potAmount > 0 && eligible.length === 0) {
      if (pots.length > 0) {
        pots[pots.length - 1].amount += potAmount
      } else {
        pots.push({
          amount: potAmount,
          eligiblePlayerIds: sorted.filter((b) => !b.isFolded).map((b) => b.playerId),
        })
      }
    }
    previousLevel = currentAmount
  }

  const totalIn = bets.reduce((s, b) => s + b.amount, 0)
  const totalOut = pots.reduce((s, p) => s + p.amount, 0)
  if (totalOut < totalIn && pots.length > 0) {
    pots[pots.length - 1].amount += totalIn - totalOut
  }
  return pots
}

export function mergePots(existing: SidePot[], newPots: SidePot[]): SidePot[] {
  return [...existing, ...newPots]
}
```

- [x] **Step 2: 写测试**

Create `games/poker/engine/__tests__/pot-manager.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calculateSidePots } from '../pot-manager'

describe('calculateSidePots', () => {
  it('single pot when all equal bets', () => {
    const pots = calculateSidePots([
      { playerId: 'a', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ])
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c'])
  })

  it('side pot when one player all-in short', () => {
    const pots = calculateSidePots([
      { playerId: 'a', amount: 50, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ])
    expect(pots).toHaveLength(2)
    expect(pots[0].amount).toBe(150)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c'])
    expect(pots[1].amount).toBe(100)
    expect(pots[1].eligiblePlayerIds.sort()).toEqual(['b', 'c'])
  })

  it('folded player contributes but not eligible', () => {
    const pots = calculateSidePots([
      { playerId: 'a', amount: 100, isAllIn: false, isFolded: true },
      { playerId: 'b', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
    ])
    expect(pots).toHaveLength(1)
    expect(pots[0].amount).toBe(300)
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['b', 'c'])
  })

  it('conservation: total in == total out', () => {
    const bets = [
      { playerId: 'a', amount: 30, isAllIn: true, isFolded: false },
      { playerId: 'b', amount: 70, isAllIn: true, isFolded: false },
      { playerId: 'c', amount: 100, isAllIn: false, isFolded: false },
      { playerId: 'd', amount: 100, isAllIn: false, isFolded: true },
    ]
    const pots = calculateSidePots(bets)
    const totalIn = bets.reduce((s, b) => s + b.amount, 0)
    const totalOut = pots.reduce((s, p) => s + p.amount, 0)
    expect(totalOut).toBe(totalIn)
  })
})
```

- [x] **Step 3: 跑测试**

Run: `npm test games/poker/engine/__tests__/pot-manager.test.ts`
Expected: 4 passed。

- [x] **Step 4: Commit**

```bash
git add games/poker/engine/pot-manager.ts games/poker/engine/__tests__/pot-manager.test.ts
git commit -m "feat(p1a): port pot-manager with side-pot textbook tests"
```

---

## Task 12: Equity（蒙特卡洛胜率）

**Files:**
- Create: `games/poker/engine/equity.ts`
- Create: `games/poker/engine/__tests__/equity.test.ts`

**Source:** `old/src/games/poker/engine/equity.ts`

- [ ] **Step 1: 复制并适配 import**

```bash
cp old/src/games/poker/engine/equity.ts games/poker/engine/equity.ts
```

编辑 `games/poker/engine/equity.ts` 把 import 路径改成 `./card` 和 `./evaluator`。

- [ ] **Step 2: 写收敛性测试**

Create `games/poker/engine/__tests__/equity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Card } from '../card'
import { computeEquity } from '../equity'  // 按实际导出名调整

function c(s: string): Card {
  return {
    rank: s[0] as Card['rank'],
    suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as const)[
      s[1] as 'h' | 'd' | 'c' | 's'
    ],
  }
}

describe('computeEquity', () => {
  it('AA vs 72o heavily favors AA', () => {
    const result = computeEquity({
      holes: [[c('Ah'), c('As')], [c('7c'), c('2d')]],
      community: [],
      iterations: 500,
    })
    expect(result[0]).toBeGreaterThan(0.7)
    expect(result[1]).toBeLessThan(0.3)
  })

  it('equal strength hands roughly 50/50', () => {
    const result = computeEquity({
      holes: [[c('Ah'), c('Kc')], [c('As'), c('Kd')]],
      community: [c('2h'), c('5c'), c('9d')],
      iterations: 500,
    })
    expect(Math.abs(result[0] - result[1])).toBeLessThan(0.3)
  })
})
```

**签名按 `grep -n "^export" games/poker/engine/equity.ts` 实际调整。**

- [ ] **Step 3: 跑测试**

Run: `npm test games/poker/engine/__tests__/equity.test.ts`
Expected: 2 passed（蒙特卡洛有随机性，偶尔失败可提高 iterations 到 2000）。

- [ ] **Step 4: Commit**

```bash
git add games/poker/engine/equity.ts games/poker/engine/__tests__/equity.test.ts
git commit -m "feat(p1a): port equity Monte Carlo from old/"
```

---

## Task 13: Poker 类型定义

**Files:**
- Create: `games/poker/engine/poker-types.ts`
- Create: `games/poker/engine/__tests__/poker-types.test.ts`

- [ ] **Step 1: 写实现**

Create `games/poker/engine/poker-types.ts`:

```typescript
import { z } from 'zod'
import type { Card } from './card'

export const pokerPhaseSchema = z.enum([
  'waiting', 'preflop', 'flop', 'turn', 'river', 'showdown', 'handComplete',
])
export type PokerPhase = z.infer<typeof pokerPhaseSchema>

export const pokerPlayerStatusSchema = z.enum([
  'active', 'folded', 'allIn', 'eliminated', 'sittingOut',
])
export type PokerPlayerStatus = z.infer<typeof pokerPlayerStatusSchema>

export const pokerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fold') }),
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('call'), amount: z.number().nonnegative() }),
  z.object({ type: z.literal('bet'), amount: z.number().positive() }),
  z.object({ type: z.literal('raise'), toAmount: z.number().positive() }),
  z.object({ type: z.literal('allIn'), amount: z.number().positive() }),
  z.object({ type: z.literal('postSmallBlind'), amount: z.number().positive() }),
  z.object({ type: z.literal('postBigBlind'), amount: z.number().positive() }),
])
export type PokerAction = z.infer<typeof pokerActionSchema>

export interface PokerPlayerState {
  id: string
  seatIndex: number
  chips: number
  holeCards: Card[]
  status: PokerPlayerStatus
  currentBet: number         // 本街已投入
  totalCommitted: number     // 本手累计投入
  hasActedThisStreet: boolean
}

export interface PokerActionRecord {
  seq: number
  phase: Exclude<PokerPhase, 'waiting' | 'handComplete'>
  agentId: string
  action: PokerAction
}

export interface PokerConfig {
  smallBlind: number
  bigBlind: number
  startingChips: number
  maxBetsPerStreet: number
}

export interface PokerState {
  phase: PokerPhase
  handNumber: number
  dealerIndex: number
  players: PokerPlayerState[]
  communityCards: Card[]
  currentActor: string | null
  actionHistory: PokerActionRecord[]
  betsThisStreet: number
  smallBlind: number
  bigBlind: number
  handComplete: boolean
  matchComplete: boolean
  deck: Card[]
}
```

- [ ] **Step 2: 写测试**

Create `games/poker/engine/__tests__/poker-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { pokerActionSchema } from '../poker-types'

describe('pokerActionSchema', () => {
  it('accepts fold', () => {
    expect(pokerActionSchema.safeParse({ type: 'fold' }).success).toBe(true)
  })
  it('accepts raise with toAmount', () => {
    expect(pokerActionSchema.safeParse({ type: 'raise', toAmount: 10 }).success).toBe(true)
  })
  it('rejects raise without toAmount', () => {
    expect(pokerActionSchema.safeParse({ type: 'raise' }).success).toBe(false)
  })
  it('rejects negative call amount', () => {
    expect(pokerActionSchema.safeParse({ type: 'call', amount: -1 }).success).toBe(false)
  })
  it('rejects unknown type', () => {
    expect(pokerActionSchema.safeParse({ type: 'bogus' }).success).toBe(false)
  })
})
```

- [ ] **Step 3: 跑测试 + commit**

Run: `npm test games/poker/engine/__tests__/poker-types.test.ts`
Expected: 5 passed。

```bash
git add games/poker/engine/poker-types.ts games/poker/engine/__tests__/poker-types.test.ts
git commit -m "feat(p1a): poker types (PokerState / PokerAction with zod)"
```

---


---

## 本 plan 验收标准

- 6 个算法/类型文件全部通过单测（deck/evaluator/pot-manager/equity/poker-types）
- Evaluator 通过教科书测试（royal>straight-flush、quads>fullhouse、flush>straight、wheel>broadway 等）
- PotManager 通过边池守恒测试
- Equity 蒙特卡洛收敛到预期区间
- Git 有 5 个 feat(p1a) commits

**下一份：** `2026-05-06-phase-1a-4-engine-state.md` —— 实现 PokerEngine 状态机类（createInitialState / applyAction / 街切换 / 摊牌结算 / finalize）。
