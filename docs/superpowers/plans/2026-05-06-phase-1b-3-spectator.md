# Phase 1b-3 — 观战页 + SSE 订阅 + 牌桌渲染

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `/matches/[matchId]` 做成真实观战页。从 SSE 流接收 events → 通过游戏事件 reducer 重建 UI 状态 → 渲染牌桌（椭圆 + 6 座位 + 公共牌 + 底池 + 当前行动高亮 + Thinking 气泡）。**本 Phase 不做计分板/筹码图/排名面板（留给 P1b-4）。**

**Architecture:**
- 观战页是 **Client Component**（需要 SSE 订阅 + state 驱动渲染）
- 用 Zustand store (`match-view-store`) 管理 events 和派生 state
- 牌桌布局参考老项目视觉（椭圆 bg + 6 座位绝对定位），但业务逻辑全部重写
- 动画用 Framer Motion（发牌 stagger、筹码飞、公共牌翻转）
- Thinking bubble 用 `@floating-ui/react` 做智能定位

**前置条件：** P1b-1/2 完成（API 可用 + 能通过 `/matches/new` 创建 match）。

**参考 spec:** 第 9.2 节（观战页结构）、第 9.6 节（动画）、第 9.7 节（老视觉复用）。

**不做的事：**
- ❌ LiveScoreboard / ChipChart / RankingPanel（P1b-4）
- ❌ LLM 接入（P1b-5）
- ❌ 赛后复盘 / 回放 UI（Phase 5）

---

## 文件结构

```
Colosseum/
├── app/
│   └── matches/[matchId]/
│       ├── page.tsx                           # 观战页 Server 外壳（读 match 初始数据）
│       └── SpectatorView.tsx                  # 'use client' 主体
├── games/poker/ui/
│   ├── PokerBoard.tsx                         # 牌桌主容器
│   ├── PlayerSeat.tsx                         # 座位
│   ├── PlayingCard.tsx                        # 扑克牌
│   ├── CommunityCards.tsx                     # 公共牌区
│   ├── Pot.tsx                                # 底池
│   ├── BetChip.tsx                            # 下注筹码
│   ├── ThinkingBubble.tsx                     # 思考气泡（Floating UI）
│   └── types.ts                               # UI 专用类型
├── store/
│   └── match-view-store.ts                    # 观战态 Zustand
├── lib/client/
│   └── sse.ts                                 # SSE 订阅 hook
└── @floating-ui/react                         # 已在 Phase 0 依赖里，或 npm i
```

---

## Task 1: 安装 @floating-ui/react + framer-motion

- [x] **Step 1: 安装**

Run:
```bash
npm install @floating-ui/react framer-motion
```

Expected: 无错。

- [x] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(p1b): install @floating-ui/react + framer-motion"
```

---

## Task 2: 观战 store（match-view-store）

**Files:**
- Create: `store/match-view-store.ts`
- Create: `tests/store/match-view-store.test.ts`

**Context:** SSE 事件流进来后存储到 store，并计算派生态（currentPhase/currentActor/players/pot/communityCards）。**派生态的计算方式：用事件 reducer 从初始 state 推导当前 state。** 这样是事件源（event-sourcing）风格，回放/快进都能共用。

**简化**：本 plan 不做 event sourcing；直接在 store 里维护一个 `derived` 对象，用 reducer 随事件 mutate。

- [ ] **Step 1: 写测试**

Create `tests/store/match-view-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useMatchViewStore } from '@/store/match-view-store'

describe('match-view-store', () => {
  beforeEach(() => {
    useMatchViewStore.setState({
      matchId: '',
      events: [],
      thinkingByAgent: {},
      currentActor: null,
      phase: 'waiting',
      communityCards: [],
      pot: 0,
      players: [],
      matchComplete: false,
    })
  })

  it('ingest event appends to list', () => {
    const store = useMatchViewStore.getState()
    store.ingestEvent({
      id: 'e1', matchId: 'm', gameType: 'poker', seq: 1,
      occurredAt: '2026-05-06T00:00:00Z', kind: 'poker/match-start',
      actorAgentId: null, payload: {},
      visibility: 'public', restrictedTo: null,
    } as never)
    expect(useMatchViewStore.getState().events.length).toBe(1)
  })

  it('thinking delta accumulates per agent', () => {
    const store = useMatchViewStore.getState()
    store.appendThinking('agt_1', 'hello ')
    store.appendThinking('agt_1', 'world')
    expect(useMatchViewStore.getState().thinkingByAgent['agt_1']).toBe('hello world')
  })

  it('clearThinking removes agent entry', () => {
    useMatchViewStore.getState().appendThinking('agt_1', 'x')
    useMatchViewStore.getState().clearThinking('agt_1')
    expect(useMatchViewStore.getState().thinkingByAgent['agt_1']).toBeUndefined()
  })
})
```

- [ ] **Step 2: 写 store**

Create `store/match-view-store.ts`:

```typescript
'use client'

import { create } from 'zustand'
import type { GameEvent } from '@/lib/core/types'

export type PokerUiPlayer = {
  agentId: string
  displayName: string
  avatarEmoji: string
  seatIndex: number
  chips: number
  currentBet: number
  status: 'active' | 'folded' | 'allIn' | 'eliminated' | 'sittingOut'
  holeCards: Array<{ rank: string; suit: string }>
}

export type MatchViewState = {
  matchId: string
  initialized: boolean
  events: GameEvent[]

  // 派生态
  phase: string
  handNumber: number
  currentActor: string | null
  players: PokerUiPlayer[]
  communityCards: Array<{ rank: string; suit: string }>
  pot: number
  dealerIndex: number
  matchComplete: boolean
  winnerAgentId: string | null

  // 客户端 UI 态
  thinkingByAgent: Record<string, string>
  fallbackCount: number

  // actions
  init(input: {
    matchId: string
    players: PokerUiPlayer[]
  }): void
  ingestEvent(event: GameEvent): void
  appendThinking(agentId: string, delta: string): void
  clearThinking(agentId: string): void
  setMatchEnd(winnerAgentId: string | null): void
}

export const useMatchViewStore = create<MatchViewState>((set, get) => ({
  matchId: '',
  initialized: false,
  events: [],
  phase: 'waiting',
  handNumber: 0,
  currentActor: null,
  players: [],
  communityCards: [],
  pot: 0,
  dealerIndex: 0,
  matchComplete: false,
  winnerAgentId: null,
  thinkingByAgent: {},
  fallbackCount: 0,

  init(input) {
    set({
      matchId: input.matchId,
      initialized: true,
      players: input.players,
      phase: 'preflop',
    })
  },

  ingestEvent(event) {
    const s = get()
    // 1. 记录
    const events = [...s.events, event]

    // 2. reducer 更新派生态
    let { phase, handNumber, currentActor, players, communityCards, pot, matchComplete, winnerAgentId } = s
    const updated = [...players]

    switch (event.kind) {
      case 'poker/match-start':
        handNumber = 1
        phase = 'preflop'
        break

      case 'poker/deal-flop':
        phase = 'flop'
        communityCards = [...communityCards, ...((event.payload.cards as typeof communityCards) ?? [])]
        break

      case 'poker/deal-turn':
        phase = 'turn'
        communityCards = [...communityCards, ...((event.payload.cards as typeof communityCards) ?? [])]
        break

      case 'poker/deal-river':
        phase = 'river'
        communityCards = [...communityCards, ...((event.payload.cards as typeof communityCards) ?? [])]
        break

      case 'poker/action': {
        const actorId = event.actorAgentId
        if (actorId) {
          const idx = updated.findIndex((p) => p.agentId === actorId)
          if (idx >= 0) {
            const p = { ...updated[idx] }
            const type = (event.payload as { type: string }).type
            const amount = (event.payload as { amount?: number }).amount ?? 0
            if (type === 'fold') p.status = 'folded'
            else if (type === 'call' || type === 'bet' || type === 'raise') {
              p.chips = Math.max(0, p.chips - amount)
              p.currentBet += amount
              pot += amount
            } else if (type === 'allIn') {
              p.currentBet += amount
              p.chips = 0
              p.status = 'allIn'
              pot += amount
            }
            updated[idx] = p
          }
        }
        // 该 actor 动作完成 → 清 thinking
        if (actorId) {
          const t = { ...s.thinkingByAgent }
          delete t[actorId]
          set({ thinkingByAgent: t })
        }
        break
      }

      case 'poker/showdown':
        phase = 'showdown'
        break

      case 'poker/pot-award': {
        const winnerIds = (event.payload.winnerIds as string[]) ?? []
        const amt = (event.payload.potAmount as number) ?? 0
        const share = winnerIds.length > 0 ? Math.floor(amt / winnerIds.length) : 0
        for (const wid of winnerIds) {
          const idx = updated.findIndex((p) => p.agentId === wid)
          if (idx >= 0) updated[idx] = { ...updated[idx], chips: updated[idx].chips + share }
        }
        pot = 0
        // 重置 currentBet for next hand
        for (let i = 0; i < updated.length; i++) updated[i] = { ...updated[i], currentBet: 0 }
        break
      }

      case 'poker/match-end':
        matchComplete = true
        winnerAgentId = (event.payload.winnerId as string | null) ?? null
        currentActor = null
        break
    }

    set({ events, phase, handNumber, currentActor, players: updated, communityCards, pot, matchComplete, winnerAgentId })
  },

  appendThinking(agentId, delta) {
    set((s) => ({
      thinkingByAgent: {
        ...s.thinkingByAgent,
        [agentId]: (s.thinkingByAgent[agentId] ?? '') + delta,
      },
      currentActor: agentId,  // 思考中的人就是当前行动者
    }))
  },

  clearThinking(agentId) {
    set((s) => {
      const t = { ...s.thinkingByAgent }
      delete t[agentId]
      return { thinkingByAgent: t }
    })
  },

  setMatchEnd(winnerAgentId) {
    set({ matchComplete: true, winnerAgentId, currentActor: null })
  },
}))
```

**注意**：reducer 里 `currentActor` 的更新没完整做 —— `currentActor` 主要依赖 `thinking-delta` 事件推进，真实 current actor 的计算在服务端。本版本简化：thinking 到谁 → currentActor 就是谁。

- [ ] **Step 3: 跑测试 + commit**

Run: `npm test tests/store/match-view-store.test.ts`
Expected: 3 passed。

```bash
git add store/match-view-store.ts tests/store/match-view-store.test.ts
git commit -m "feat(p1b): match view store with event reducer"
```

---

## Task 3: SSE 订阅 hook

**Files:**
- Create: `lib/client/sse.ts`

- [ ] **Step 1: 写 hook**

Create `lib/client/sse.ts`:

```typescript
'use client'

import { useEffect } from 'react'

/**
 * SSE 订阅 hook。
 * 服务端广播的 payload 结构见 lib/orchestrator/sse-broadcast.ts：
 *  - { kind: 'event', event: GameEvent }
 *  - { kind: 'thinking-delta', agentId, delta }
 *  - { kind: 'match-end', winnerAgentId }
 */
export function useMatchStream(
  matchId: string,
  onMessage: (payload: unknown) => void,
) {
  useEffect(() => {
    if (!matchId) return
    const url = `/api/matches/${matchId}/stream`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as unknown
        onMessage(data)
      } catch {
        /* ignore */
      }
    }
    es.onerror = () => {
      // EventSource 会自动重连；只在 completely closed 时报错
    }
    return () => es.close()
  }, [matchId, onMessage])
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/client/sse.ts
git commit -m "feat(p1b): SSE subscription hook"
```

---

## Task 4: 扑克牌组件 PlayingCard

**Files:**
- Create: `games/poker/ui/PlayingCard.tsx`

- [ ] **Step 1: 写实现**

Create `games/poker/ui/PlayingCard.tsx`:

```typescript
'use client'

import { motion } from 'framer-motion'

export type CardVisual = {
  rank: string   // '2' | ... | 'A'
  suit: string   // 'hearts' | 'diamonds' | 'clubs' | 'spades'
}

const SUIT_SYMBOL: Record<string, string> = {
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
}

const SUIT_COLOR: Record<string, string> = {
  hearts: 'text-red-500',
  diamonds: 'text-red-500',
  clubs: 'text-neutral-800',
  spades: 'text-neutral-800',
}

export function PlayingCard({
  card, faceDown, size = 'md', className = '',
}: {
  card?: CardVisual
  faceDown?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sz = size === 'sm' ? 'w-8 h-12 text-sm' : size === 'lg' ? 'w-16 h-24 text-2xl' : 'w-12 h-16 text-lg'

  if (faceDown || !card) {
    return (
      <motion.div
        className={`${sz} rounded bg-gradient-to-br from-indigo-600 to-indigo-900 border border-indigo-800 ${className}`}
        initial={{ rotateY: 90, opacity: 0 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
      />
    )
  }

  return (
    <motion.div
      className={`${sz} rounded bg-white border border-neutral-300 flex flex-col items-center justify-center shadow ${SUIT_COLOR[card.suit]} font-bold ${className}`}
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div>{card.rank}</div>
      <div>{SUIT_SYMBOL[card.suit]}</div>
    </motion.div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add games/poker/ui/PlayingCard.tsx
git commit -m "feat(p1b): PlayingCard component with flip animation"
```

---

## Task 5: ThinkingBubble（Floating UI 智能定位）

**Files:**
- Create: `games/poker/ui/ThinkingBubble.tsx`

- [ ] **Step 1: 写实现**

Create `games/poker/ui/ThinkingBubble.tsx`:

```typescript
'use client'

import { useFloating, autoPlacement, offset, shift, useTransitionStyles } from '@floating-ui/react'

export function ThinkingBubble({
  anchorRef, text, visible,
}: {
  anchorRef: React.RefObject<HTMLElement>
  text: string
  visible: boolean
}) {
  const { refs, floatingStyles, context } = useFloating({
    open: visible,
    middleware: [
      autoPlacement({ allowedPlacements: ['top', 'bottom', 'left', 'right'] }),
      offset(10),
      shift({ padding: 8 }),
    ],
    elements: { reference: anchorRef.current },
  })

  const { isMounted, styles } = useTransitionStyles(context, {
    duration: 150,
    initial: { opacity: 0, scale: 0.95 },
    open: { opacity: 1, scale: 1 },
  })

  if (!isMounted) return null

  return (
    <div
      ref={refs.setFloating}
      style={{ ...floatingStyles, ...styles }}
      className="z-50 max-w-xs bg-white/90 backdrop-blur-sm border border-neutral-200 rounded-lg shadow-lg p-3 text-sm text-neutral-800"
    >
      {text || <span className="italic text-neutral-400">思考中...</span>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add games/poker/ui/ThinkingBubble.tsx
git commit -m "feat(p1b): ThinkingBubble with floating-ui smart positioning"
```

---

## Task 6: PlayerSeat

**Files:**
- Create: `games/poker/ui/PlayerSeat.tsx`

- [ ] **Step 1: 写实现**

Create `games/poker/ui/PlayerSeat.tsx`:

```typescript
'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import { PlayingCard } from './PlayingCard'
import { ThinkingBubble } from './ThinkingBubble'
import type { PokerUiPlayer } from '@/store/match-view-store'

export function PlayerSeat({
  player, isCurrentActor, isDealer, thinking,
}: {
  player: PokerUiPlayer
  isCurrentActor: boolean
  isDealer: boolean
  thinking: string | undefined
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const opacity = player.status === 'folded' ? 0.4 : 1

  return (
    <div ref={anchorRef} style={{ opacity }} className="relative">
      <motion.div
        className={`flex items-center gap-3 p-3 rounded-lg bg-neutral-900/80 backdrop-blur-sm border-2 transition-colors ${
          isCurrentActor ? 'border-yellow-400 animate-pulse' : 'border-neutral-700'
        }`}
      >
        <div className="text-4xl">{player.avatarEmoji}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">
            {player.displayName}
            {isDealer && (
              <span className="ml-1 inline-block w-5 h-5 text-xs font-bold bg-white text-neutral-900 rounded-full text-center leading-5">
                D
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-300">${player.chips}</div>
          {player.currentBet > 0 && (
            <div className="text-xs text-amber-300">下注: ${player.currentBet}</div>
          )}
          {player.status === 'folded' && (
            <div className="text-xs text-red-400">弃牌</div>
          )}
          {player.status === 'allIn' && (
            <div className="text-xs text-orange-300">全下</div>
          )}
        </div>
        <div className="flex gap-1">
          {player.holeCards.slice(0, 2).map((c, i) => (
            <PlayingCard key={i} card={c} size="sm" />
          ))}
        </div>
      </motion.div>
      <ThinkingBubble
        anchorRef={anchorRef as never}
        text={thinking ?? ''}
        visible={!!thinking || isCurrentActor}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add games/poker/ui/PlayerSeat.tsx
git commit -m "feat(p1b): PlayerSeat with current-actor highlight + thinking bubble"
```

---

## Task 7: CommunityCards + Pot + BetChip

**Files:**
- Create: `games/poker/ui/CommunityCards.tsx`
- Create: `games/poker/ui/Pot.tsx`

- [ ] **Step 1: 写 CommunityCards**

Create `games/poker/ui/CommunityCards.tsx`:

```typescript
'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { PlayingCard, type CardVisual } from './PlayingCard'

export function CommunityCards({ cards }: { cards: CardVisual[] }) {
  return (
    <div className="flex gap-2 items-center justify-center min-h-24">
      <AnimatePresence>
        {cards.map((c, i) => (
          <motion.div
            key={`${i}-${c.rank}-${c.suit}`}
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: i * 0.15, duration: 0.3 }}
          >
            <PlayingCard card={c} size="lg" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 2: 写 Pot**

Create `games/poker/ui/Pot.tsx`:

```typescript
'use client'

import { motion } from 'framer-motion'

export function Pot({ amount, phase }: { amount: number; phase: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        key={amount}
        initial={{ scale: 1.15 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.2 }}
        className="px-4 py-2 rounded-full bg-amber-500/20 border border-amber-500 text-amber-200 font-bold"
      >
        底池 ${amount}
      </motion.div>
      <div className="text-xs text-neutral-400 uppercase">{phase}</div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add games/poker/ui/CommunityCards.tsx games/poker/ui/Pot.tsx
git commit -m "feat(p1b): CommunityCards + Pot with animations"
```

---

## Task 8: PokerBoard 主容器

**Files:**
- Create: `games/poker/ui/PokerBoard.tsx`

**Context:** 椭圆牌桌，6 座位环绕。用绝对定位 + 百分比放置座位。

- [ ] **Step 1: 写实现**

Create `games/poker/ui/PokerBoard.tsx`:

```typescript
'use client'

import { CommunityCards } from './CommunityCards'
import { Pot } from './Pot'
import { PlayerSeat } from './PlayerSeat'
import type { PokerUiPlayer } from '@/store/match-view-store'

/**
 * 6-max 座位绝对定位百分比。顺序：底部中间 = seat 0，逆时针。
 * 为了让观众看到自己（若有）常放底部，这里用固定布局。
 */
const SEAT_POSITIONS = [
  { bottom: '-8%', left: '50%', transform: 'translateX(-50%)' },   // 0: 底
  { bottom: '15%', left: '10%' },                                   // 1: 左下
  { top: '25%', left: '5%' },                                       // 2: 左上
  { top: '-5%', left: '50%', transform: 'translateX(-50%)' },       // 3: 顶
  { top: '25%', right: '5%' },                                      // 4: 右上
  { bottom: '15%', right: '10%' },                                  // 5: 右下
]

export function PokerBoard({
  players, communityCards, pot, phase, currentActor, dealerIndex, thinkingByAgent,
}: {
  players: PokerUiPlayer[]
  communityCards: Array<{ rank: string; suit: string }>
  pot: number
  phase: string
  currentActor: string | null
  dealerIndex: number
  thinkingByAgent: Record<string, string>
}) {
  return (
    <div className="relative w-full aspect-[16/10] max-w-4xl mx-auto">
      {/* 椭圆牌桌 */}
      <div
        className="absolute inset-[8%] rounded-[50%] bg-gradient-to-br from-green-900 to-green-950 border-[6px] border-amber-800 shadow-2xl flex items-center justify-center"
      >
        <div className="flex flex-col items-center gap-4">
          <CommunityCards cards={communityCards} />
          <Pot amount={pot} phase={phase} />
        </div>
      </div>
      {/* 座位 */}
      {players.map((p) => {
        const pos = SEAT_POSITIONS[p.seatIndex] ?? SEAT_POSITIONS[0]
        return (
          <div key={p.agentId} className="absolute" style={pos}>
            <PlayerSeat
              player={p}
              isCurrentActor={p.agentId === currentActor}
              isDealer={p.seatIndex === dealerIndex}
              thinking={thinkingByAgent[p.agentId]}
            />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add games/poker/ui/PokerBoard.tsx
git commit -m "feat(p1b): PokerBoard with 6-seat oval layout"
```

---

## Task 9: SpectatorView 主组件（整合）

**Files:**
- Create: `app/matches/[matchId]/SpectatorView.tsx`
- Create: `app/matches/[matchId]/page.tsx`

**Context:** Server 外壳 `page.tsx` 读 match/participants/agents 初始数据；Client `SpectatorView` 接管 SSE + 渲染。

- [ ] **Step 1: 写 Server page**

Create `app/matches/[matchId]/page.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { db } from '@/lib/db/client'
import { matches, matchParticipants, agents } from '@/lib/db/schema.sqlite'
import { eq } from 'drizzle-orm'
import { SpectatorView } from './SpectatorView'
import type { PokerUiPlayer } from '@/store/match-view-store'

export const dynamic = 'force-dynamic'

export default async function MatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const { matchId } = await params

  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1)
  if (!match) notFound()

  const participantsData = await db
    .select({
      agentId: matchParticipants.agentId,
      seatIndex: matchParticipants.seatIndex,
      initialData: matchParticipants.initialData,
      agentName: agents.displayName,
      agentAvatar: agents.avatarEmoji,
    })
    .from(matchParticipants)
    .leftJoin(agents, eq(matchParticipants.agentId, agents.id))
    .where(eq(matchParticipants.matchId, matchId))

  const initialPlayers: PokerUiPlayer[] = participantsData.map((p) => ({
    agentId: p.agentId,
    displayName: p.agentName ?? p.agentId,
    avatarEmoji: p.agentAvatar ?? '🃏',
    seatIndex: p.seatIndex,
    chips: 200,             // 初始（会被后续事件修正）
    currentBet: 0,
    status: 'active',
    holeCards: [],
  }))

  return (
    <SpectatorView
      matchId={matchId}
      gameType={match.gameType as 'poker' | 'werewolf'}
      initialPlayers={initialPlayers}
      status={match.status}
    />
  )
}
```

- [ ] **Step 2: 写 Client SpectatorView**

Create `app/matches/[matchId]/SpectatorView.tsx`:

```typescript
'use client'

import { useEffect, useCallback } from 'react'
import { useMatchViewStore, type PokerUiPlayer } from '@/store/match-view-store'
import { useMatchStream } from '@/lib/client/sse'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { Badge } from '@/components/ui/badge'

type SseMessage =
  | { kind: 'event'; event: import('@/lib/core/types').GameEvent }
  | { kind: 'thinking-delta'; agentId: string; delta: string }
  | { kind: 'agent-action-ready'; agentId: string; actionType: string }
  | { kind: 'match-end'; winnerAgentId: string | null }

export function SpectatorView({
  matchId, gameType, initialPlayers, status,
}: {
  matchId: string
  gameType: 'poker' | 'werewolf'
  initialPlayers: PokerUiPlayer[]
  status: string
}) {
  const {
    init, ingestEvent, appendThinking, setMatchEnd,
    players, communityCards, pot, phase, currentActor,
    dealerIndex, thinkingByAgent, matchComplete, winnerAgentId,
  } = useMatchViewStore()

  useEffect(() => {
    init({ matchId, players: initialPlayers })
  }, [matchId, initialPlayers, init])

  const onMessage = useCallback(
    (raw: unknown) => {
      const m = raw as SseMessage
      switch (m.kind) {
        case 'event':
          ingestEvent(m.event)
          break
        case 'thinking-delta':
          appendThinking(m.agentId, m.delta)
          break
        case 'match-end':
          setMatchEnd(m.winnerAgentId)
          break
      }
    },
    [ingestEvent, appendThinking, setMatchEnd],
  )

  useMatchStream(matchId, onMessage)

  if (gameType !== 'poker') {
    return <div className="p-8">狼人杀观战页将在 Phase 3 实现。</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">
          德州扑克 · 第 #{useMatchViewStore.getState().handNumber} 手
        </h1>
        <div className="flex gap-2">
          <Badge variant="outline">{phase}</Badge>
          <Badge variant={status === 'running' ? 'default' : 'secondary'}>{status}</Badge>
          {matchComplete && winnerAgentId && (
            <Badge>赢家: {players.find((p) => p.agentId === winnerAgentId)?.displayName ?? winnerAgentId}</Badge>
          )}
        </div>
      </div>

      <PokerBoard
        players={players}
        communityCards={communityCards}
        pot={pot}
        phase={phase}
        currentActor={currentActor}
        dealerIndex={dealerIndex}
        thinkingByAgent={thinkingByAgent}
      />

      {matchComplete && (
        <div className="mt-6 p-4 border rounded bg-muted text-center">
          <div className="text-lg font-bold">对局结束</div>
          {winnerAgentId && (
            <div className="text-sm text-muted-foreground">
              获胜者：{players.find((p) => p.agentId === winnerAgentId)?.displayName ?? winnerAgentId}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 手工验证**

Run: `npm run infra:up && npm run dev`（新开终端跑 dev）：
1. 访问 `/matches/new`，选 6 agent 开新对局，跳到观战页
2. 应看到椭圆牌桌 + 6 座位 + Badge 显示 phase/status
3. SSE 流式触发事件 → 座位发生变化（chips 减少、folded 状态、pot 增长、公共牌翻出）
4. 当前 actor 有黄色 pulse 边框
5. 最后 match-end 弹出"对局结束"

**常见问题**：
- 座位显示乱：调 SEAT_POSITIONS 的 top/bottom/left/right
- ThinkingBubble 不显示：检查 anchorRef 是否绑定
- 动画卡顿：降低 Framer Motion `transition.duration`

- [ ] **Step 4: Commit + tag**

```bash
git add app/matches/\[matchId\]/ games/poker/ui/
git commit -m "feat(p1b): spectator view with SSE + event reducer + animated board"
git tag -a phase-1b-3 -m "Phase 1b-3: spectator page + poker table renderer"
```

---

## Phase 1b-3 Done 定义

1. ✅ 访问 `/matches/<id>` 能看到椭圆牌桌 + 6 座位
2. ✅ SSE 事件驱动 UI：发牌 / 下注 / 弃牌 / 换街 / 摊牌 全部可见
3. ✅ 当前 actor 有明显视觉高亮（ring-2 + pulse）
4. ✅ Thinking bubble 浮动在座位附近，`@floating-ui/react` 自动避开遮挡
5. ✅ Framer Motion 动画：发牌 flip、公共牌 stagger、pot 变化 scale
6. ✅ 对局结束弹出"对局结束"面板
7. ✅ `npm test` + `npx tsc --noEmit` + `npm run build` 全绿
8. ✅ Git tag `phase-1b-3`

**下一份：** `2026-05-06-phase-1b-4-scoreboard-ranking.md` —— LiveScoreboard 实时计分板 + ChipChart 筹码曲线 + 赛后 RankingPanel + ActionLog（日志/思考链 tabs）+ fallback Badge。
