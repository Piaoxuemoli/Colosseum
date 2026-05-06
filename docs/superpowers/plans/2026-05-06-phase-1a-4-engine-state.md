# Phase 1a-4 — PokerEngine 状态机（Task 14-17）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 `PokerEngine` 类（`lib/engine/contracts.ts` 的 GameEngine 接口）：初始化 + 盲注 + availableActions + applyAction + 街切换 + 摊牌结算 + finalize + match-end 检测。

**前置条件：** P1a-1/2/3 完成（algos 已在位）。

**Architecture 提醒：**
- 引擎**纯函数**，不碰 DB/Redis/LLM
- 每个 action 产出 events（seq=0，GM 在 appendEvents 前填）
- `applyAction` 不抛异常，非法 action 返回 `poker/rejection` event
- 固定限注规则：preflop/flop=smallBlind 下注，turn/river=bigBlind；每街 4-bet cap

**下一份：** `2026-05-06-phase-1a-5-agent-memory.md`（Bot + Parser + ContextBuilder + 记忆 3 层 + plugin 注册）。

---

## Task 14: Poker engine 骨架 + 初始化 + 发底牌 + 盲注

**Files:**
- Create: `games/poker/engine/poker-engine.ts`（骨架 + `createInitialState` + `currentActor`）
- Create: `games/poker/engine/__tests__/poker-engine.test.ts`

- [x] **Step 1: 写测试**

Create `games/poker/engine/__tests__/poker-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { PokerEngine } from '../poker-engine'
import type { PokerConfig } from '../poker-types'

const defaultConfig: PokerConfig = {
  smallBlind: 2, bigBlind: 4, startingChips: 200, maxBetsPerStreet: 4,
}

describe('PokerEngine.createInitialState', () => {
  it('6 players seeded with blinds', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    expect(state.players.length).toBe(6)
    const sb = state.players.find((p) => p.currentBet === 2)
    const bb = state.players.find((p) => p.currentBet === 4)
    expect(sb).toBeDefined()
    expect(bb).toBeDefined()
    expect(state.phase).toBe('preflop')
    expect(state.handNumber).toBe(1)
    expect(state.communityCards.length).toBe(0)
    expect(state.players.every((p) => p.holeCards.length === 2)).toBe(true)
  })

  it('currentActor is UTG preflop', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    const actorId = engine.currentActor(state)
    expect(actorId).not.toBeNull()
    const actor = state.players.find((p) => p.id === actorId)!
    const expectedSeat = (state.dealerIndex + 3) % 6
    expect(actor.seatIndex).toBe(expectedSeat)
  })

  it('throws if fewer than 2 players', () => {
    const engine = new PokerEngine()
    expect(() => engine.createInitialState(defaultConfig, ['a'])).toThrow(/at least 2/)
  })
})
```

- [x] **Step 2: 确认失败**

Run: `npm test games/poker/engine/__tests__/poker-engine.test.ts`
Expected: 失败（engine 不存在）。

- [x] **Step 3: 写实现（骨架）**

Create `games/poker/engine/poker-engine.ts`:

```typescript
import type { GameEngine, ActionSpec, ApplyActionResult, BoundaryKind } from '@/lib/engine/contracts'
import type { GameEvent, MatchResult } from '@/lib/core/types'
import type { PokerState, PokerAction, PokerConfig, PokerPlayerState } from './poker-types'
import { createDeck, shuffleDeck } from './card'
import { dealCards } from './deck'
import { newEventId } from '@/lib/core/ids'

export class PokerEngine
  implements GameEngine<PokerState, PokerAction, PokerConfig>
{
  createInitialState(config: PokerConfig, agentIds: string[]): PokerState {
    if (agentIds.length < 2) throw new Error('poker: at least 2 players required')

    const players: PokerPlayerState[] = agentIds.map((id, idx) => ({
      id, seatIndex: idx, chips: config.startingChips,
      holeCards: [], status: 'active',
      currentBet: 0, totalCommitted: 0, hasActedThisStreet: false,
    }))

    const dealerIndex = Math.floor(Math.random() * players.length)
    const deck = shuffleDeck(createDeck())
    let remaining = deck
    for (const p of players) {
      const r = dealCards(remaining, 2)
      p.holeCards = r.dealt
      remaining = r.remaining
    }

    const sbIndex = (dealerIndex + 1) % players.length
    const bbIndex = (dealerIndex + 2) % players.length
    this.postBlind(players[sbIndex], config.smallBlind)
    this.postBlind(players[bbIndex], config.bigBlind)

    const utgIndex = (dealerIndex + 3) % players.length
    const currentActor = players[utgIndex].id

    return {
      phase: 'preflop',
      handNumber: 1,
      dealerIndex,
      players,
      communityCards: [],
      currentActor,
      actionHistory: [],
      betsThisStreet: 1,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      handComplete: false,
      matchComplete: false,
      deck: remaining,
    }
  }

  currentActor(state: PokerState): string | null {
    return state.currentActor
  }

  availableActions(_state: PokerState, _agentId: string): ActionSpec<PokerAction>[] {
    throw new Error('not implemented yet (Task 15)')
  }

  applyAction(_state: PokerState, _agentId: string, _action: PokerAction): ApplyActionResult<PokerState> {
    throw new Error('not implemented yet (Task 15)')
  }

  boundary(_prev: PokerState, _next: PokerState): BoundaryKind | null {
    throw new Error('not implemented yet (Task 16)')
  }

  finalize(_state: PokerState): MatchResult {
    throw new Error('not implemented yet (Task 17)')
  }

  private postBlind(player: PokerPlayerState, amount: number): void {
    const paid = Math.min(player.chips, amount)
    player.chips -= paid
    player.currentBet = paid
    player.totalCommitted = paid
    if (paid < amount || player.chips === 0) player.status = 'allIn'
  }

  protected makeEvent(input: {
    matchId?: string
    kind: string
    actorAgentId: string | null
    payload: Record<string, unknown>
    visibility?: 'public' | 'role-restricted' | 'private'
    restrictedTo?: string[] | null
  }): GameEvent {
    return {
      id: newEventId(),
      matchId: input.matchId ?? '',
      gameType: 'poker',
      seq: 0,
      occurredAt: new Date().toISOString(),
      kind: input.kind,
      actorAgentId: input.actorAgentId,
      payload: input.payload,
      visibility: input.visibility ?? 'public',
      restrictedTo: input.restrictedTo ?? null,
    }
  }
}
```

- [x] **Step 4: 跑测试**

Run: `npm test games/poker/engine/__tests__/poker-engine.test.ts`
Expected: 3 passed。

- [x] **Step 5: Commit**

```bash
git add games/poker/engine/poker-engine.ts games/poker/engine/__tests__/poker-engine.test.ts
git commit -m "feat(p1a): poker engine skeleton + initialState + blinds"
```

---

## Task 15: Poker engine — availableActions + applyAction（单街内）

**Files:**
- Modify: `games/poker/engine/poker-engine.ts`
- Modify: `games/poker/engine/__tests__/poker-engine.test.ts`

- [ ] **Step 1: 追加测试**

在 `__tests__/poker-engine.test.ts` 末尾追加：

```typescript
describe('PokerEngine.availableActions', () => {
  it('preflop UTG can fold/call/raise', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    const actor = engine.currentActor(state)!
    const actions = engine.availableActions(state, actor)
    const types = actions.map((a) => a.type)
    expect(types).toContain('fold')
    expect(types).toContain('call')
    expect(types).toContain('raise')
  })

  it('check unavailable when there is a bet to call', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a','b'])
    const actor = engine.currentActor(state)!
    const actions = engine.availableActions(state, actor)
    expect(actions.map((a) => a.type)).not.toContain('check')
  })
})

describe('PokerEngine.applyAction', () => {
  it('fold marks player folded', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    const actor = engine.currentActor(state)!
    const { nextState, events } = engine.applyAction(state, actor, { type: 'fold' })
    const p = nextState.players.find((p) => p.id === actor)!
    expect(p.status).toBe('folded')
    expect(events.some((e) => e.kind === 'poker/action' && (e.payload as Record<string, unknown>).type === 'fold')).toBe(true)
  })

  it('call matches highest bet', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    const actor = engine.currentActor(state)!
    const maxBet = Math.max(...state.players.map((p) => p.currentBet))
    const { nextState } = engine.applyAction(state, actor, { type: 'call', amount: maxBet })
    const p = nextState.players.find((p) => p.id === actor)!
    expect(p.currentBet).toBe(maxBet)
  })

  it('raise advances betsThisStreet', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    const actor = engine.currentActor(state)!
    const { nextState } = engine.applyAction(state, actor, {
      type: 'raise', toAmount: state.bigBlind + state.smallBlind,
    })
    expect(nextState.betsThisStreet).toBe(state.betsThisStreet + 1)
  })

  it('no raise after 4-bet cap', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    state = { ...state, betsThisStreet: 4 }
    const actor = engine.currentActor(state)!
    const actions = engine.availableActions(state, actor)
    expect(actions.map((a) => a.type)).not.toContain('raise')
  })
})
```

- [ ] **Step 2: 确认失败**

Run: `npm test games/poker/engine/__tests__/poker-engine.test.ts`
Expected: 上面 5 个失败。

- [ ] **Step 3: 实现 availableActions + applyAction**

替换 `poker-engine.ts` 中的 `availableActions` + `applyAction` 方法体（保留其他）：

```typescript
  availableActions(state: PokerState, agentId: string): ActionSpec<PokerAction>[] {
    const player = state.players.find((p) => p.id === agentId)
    if (!player) return []
    if (player.status !== 'active') return []

    const maxBet = Math.max(...state.players.map((p) => p.currentBet))
    const toCall = maxBet - player.currentBet
    const actions: ActionSpec<PokerAction>[] = []

    if (toCall > 0) {
      actions.push({ type: 'fold' })
      const callAmount = Math.min(toCall, player.chips)
      actions.push({ type: 'call', label: `call ${callAmount}`, minAmount: callAmount, maxAmount: callAmount })
    } else {
      actions.push({ type: 'check' })
    }

    const streetBetSize = this.isSmallBetStreet(state.phase) ? state.smallBlind : state.bigBlind
    const canRaise = state.betsThisStreet < 4 && player.chips > toCall
    if (canRaise) {
      const raiseTo = maxBet + streetBetSize
      if (player.chips >= toCall + streetBetSize) {
        const typ = maxBet === 0 ? 'bet' : 'raise'
        if (typ === 'bet') {
          actions.push({ type: 'bet', label: `bet ${streetBetSize}`, minAmount: streetBetSize, maxAmount: streetBetSize })
        } else {
          actions.push({ type: 'raise', label: `raise to ${raiseTo}`, minAmount: raiseTo, maxAmount: raiseTo })
        }
      } else {
        actions.push({ type: 'allIn', label: `all-in ${player.chips}`, minAmount: player.chips, maxAmount: player.chips })
      }
    }

    return actions
  }

  applyAction(state: PokerState, agentId: string, action: PokerAction): ApplyActionResult<PokerState> {
    const next: PokerState = JSON.parse(JSON.stringify(state))
    const player = next.players.find((p) => p.id === agentId)
    if (!player) {
      return this.rejectAction(next, agentId, action, 'unknown actor')
    }

    const maxBet = Math.max(...next.players.map((p) => p.currentBet))
    const toCall = maxBet - player.currentBet
    const events: GameEvent[] = []

    switch (action.type) {
      case 'fold':
        player.status = 'folded'
        player.hasActedThisStreet = true
        events.push(this.makeEvent({
          kind: 'poker/action', actorAgentId: agentId, payload: { type: 'fold' },
        }))
        break

      case 'check':
        if (toCall > 0) return this.rejectAction(next, agentId, action, 'cannot check facing bet')
        player.hasActedThisStreet = true
        events.push(this.makeEvent({
          kind: 'poker/action', actorAgentId: agentId, payload: { type: 'check' },
        }))
        break

      case 'call': {
        const pay = Math.min(toCall, player.chips)
        player.chips -= pay
        player.currentBet += pay
        player.totalCommitted += pay
        if (player.chips === 0) player.status = 'allIn'
        player.hasActedThisStreet = true
        events.push(this.makeEvent({
          kind: 'poker/action', actorAgentId: agentId, payload: { type: 'call', amount: pay },
        }))
        break
      }

      case 'bet':
      case 'raise': {
        const targetBet = action.type === 'bet' ? action.amount : action.toAmount
        const pay = targetBet - player.currentBet
        if (pay > player.chips) return this.rejectAction(next, agentId, action, 'not enough chips')
        player.chips -= pay
        player.currentBet = targetBet
        player.totalCommitted += pay
        if (player.chips === 0) player.status = 'allIn'
        player.hasActedThisStreet = true
        next.betsThisStreet += 1
        for (const p of next.players) {
          if (p.id !== agentId && p.status === 'active') p.hasActedThisStreet = false
        }
        events.push(this.makeEvent({
          kind: 'poker/action', actorAgentId: agentId, payload: { type: action.type, amount: targetBet },
        }))
        break
      }

      case 'allIn': {
        const pay = player.chips
        player.currentBet += pay
        player.totalCommitted += pay
        player.chips = 0
        player.status = 'allIn'
        player.hasActedThisStreet = true
        if (player.currentBet > maxBet) {
          next.betsThisStreet += 1
          for (const p of next.players) {
            if (p.id !== agentId && p.status === 'active') p.hasActedThisStreet = false
          }
        }
        events.push(this.makeEvent({
          kind: 'poker/action', actorAgentId: agentId,
          payload: { type: 'allIn', amount: pay, totalCurrentBet: player.currentBet },
        }))
        break
      }

      default:
        return this.rejectAction(next, agentId, action, 'unknown action type')
    }

    // 推进 currentActor（街切换在 Task 16 实现）
    next.currentActor = this.findNextActor(next)
    return { nextState: next, events }
  }

  private rejectAction(
    state: PokerState, agentId: string, action: PokerAction, reason: string,
  ): ApplyActionResult<PokerState> {
    return {
      nextState: state,
      events: [this.makeEvent({
        kind: 'poker/rejection', actorAgentId: agentId,
        payload: { reason, action: action as unknown as Record<string, unknown> },
      })],
    }
  }

  private isSmallBetStreet(phase: PokerState['phase']): boolean {
    return phase === 'preflop' || phase === 'flop'
  }

  private findNextActor(state: PokerState): string | null {
    if (state.currentActor === null) return null
    const startIdx = state.players.findIndex((p) => p.id === state.currentActor)
    const n = state.players.length
    const maxBet = Math.max(...state.players.map((pp) => pp.currentBet))
    for (let i = 1; i <= n; i++) {
      const p = state.players[(startIdx + i) % n]
      if (p.status !== 'active') continue
      if (!p.hasActedThisStreet) return p.id
      if (p.currentBet < maxBet) return p.id
    }
    return null
  }
```

- [ ] **Step 4: 跑测试**

Run: `npm test games/poker/engine/__tests__/poker-engine.test.ts`
Expected: 8 passed（初始化 3 + availableActions 2 + applyAction 4）。

- [ ] **Step 5: Commit**

```bash
git add games/poker/engine/poker-engine.ts games/poker/engine/__tests__/poker-engine.test.ts
git commit -m "feat(p1a): poker engine availableActions + applyAction (single street)"
```

---

## Task 16: Poker engine — 街切换 + hand-end + boundary

**Files:**
- Modify: `games/poker/engine/poker-engine.ts`
- Modify: `games/poker/engine/__tests__/poker-engine.test.ts`

- [ ] **Step 1: 追加测试**

```typescript
describe('PokerEngine street transitions', () => {
  it('flop is dealt after preflop completes', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    let guard = 30
    while (state.phase === 'preflop' && guard-- > 0) {
      const actor = engine.currentActor(state)
      if (!actor) break
      const p = state.players.find((p) => p.id === actor)!
      const maxBet = Math.max(...state.players.map((p) => p.currentBet))
      const toCall = maxBet - p.currentBet
      const action: PokerAction = toCall > 0
        ? { type: 'call', amount: toCall }
        : { type: 'check' }
      const r = engine.applyAction(state, actor, action)
      state = r.nextState
    }
    expect(state.phase).toBe('flop')
    expect(state.communityCards.length).toBe(3)
    expect(state.betsThisStreet).toBe(0)
  })

  it('hand-end boundary when only 1 non-folded remains', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    for (let i = 0; i < 5; i++) {
      const actor = engine.currentActor(state)
      if (!actor) break
      const prev = state
      const r = engine.applyAction(state, actor, { type: 'fold' })
      state = r.nextState
      if (i === 4) {
        expect(engine.boundary(prev, state)).toBe('hand-end')
      }
    }
  })
})
```

文件顶部加 `import type { PokerAction } from '../poker-types'`。

- [ ] **Step 2: 实现 applyAction 末尾的街切换 + boundary**

替换 `applyAction` 末尾：

```typescript
    // 1. 若只剩 <= 1 个非弃牌者 → hand-end
    const notFolded = next.players.filter(
      (p) => p.status !== 'folded' && p.status !== 'eliminated' && p.status !== 'sittingOut',
    )
    if (notFolded.length <= 1) {
      next.currentActor = null
      next.handComplete = true
      const settleEvents = this.settleHand(next)
      events.push(...settleEvents)
      return { nextState: next, events }
    }

    // 2. 街结束切换
    if (this.isStreetComplete(next)) {
      const streetEvents = this.advanceStreet(next)
      events.push(...streetEvents)
    } else {
      next.currentActor = this.findNextActor(next)
    }

    return { nextState: next, events }
```

在 class 内新增：

```typescript
  private isStreetComplete(state: PokerState): boolean {
    const active = state.players.filter((p) => p.status === 'active')
    if (active.length === 0) return true   // 全部 all-in 或 folded
    const activeOrAllIn = state.players.filter((p) => p.status === 'active' || p.status === 'allIn')
    const maxBet = Math.max(...activeOrAllIn.map((p) => p.currentBet))
    return active.every((p) => p.currentBet === maxBet && p.hasActedThisStreet)
  }

  private advanceStreet(state: PokerState): GameEvent[] {
    const events: GameEvent[] = []

    // 重置本街状态
    for (const p of state.players) {
      p.currentBet = 0
      p.hasActedThisStreet = false
    }
    state.betsThisStreet = 0

    if (state.phase === 'preflop') {
      const r = dealCards(state.deck, 3)
      state.communityCards.push(...r.dealt)
      state.deck = r.remaining
      state.phase = 'flop'
      events.push(this.makeEvent({
        kind: 'poker/deal-flop', actorAgentId: null, payload: { cards: r.dealt },
      }))
    } else if (state.phase === 'flop') {
      const r = dealCards(state.deck, 1)
      state.communityCards.push(...r.dealt)
      state.deck = r.remaining
      state.phase = 'turn'
      events.push(this.makeEvent({
        kind: 'poker/deal-turn', actorAgentId: null, payload: { cards: r.dealt },
      }))
    } else if (state.phase === 'turn') {
      const r = dealCards(state.deck, 1)
      state.communityCards.push(...r.dealt)
      state.deck = r.remaining
      state.phase = 'river'
      events.push(this.makeEvent({
        kind: 'poker/deal-river', actorAgentId: null, payload: { cards: r.dealt },
      }))
    } else if (state.phase === 'river') {
      state.phase = 'showdown'
      state.currentActor = null
      state.handComplete = true
      events.push(this.makeEvent({
        kind: 'poker/showdown', actorAgentId: null, payload: {},
      }))
      const settleEvents = this.settleHand(state)
      events.push(...settleEvents)
      return events
    }

    // postflop: 从 SB 左侧第一个 active 开始
    const sbIndex = (state.dealerIndex + 1) % state.players.length
    for (let i = 0; i < state.players.length; i++) {
      const idx = (sbIndex + i) % state.players.length
      if (state.players[idx].status === 'active') {
        state.currentActor = state.players[idx].id
        break
      }
    }
    return events
  }

  boundary(prev: PokerState, next: PokerState): BoundaryKind | null {
    if (!prev.handComplete && next.handComplete) return 'hand-end'
    if (!prev.matchComplete && next.matchComplete) return 'match-end'
    return null
  }

  // settleHand placeholder（Task 17 完整实现）
  private settleHand(_state: PokerState): GameEvent[] {
    return []
  }
```

- [ ] **Step 3: 跑测试**

Run: `npm test games/poker/engine/__tests__/poker-engine.test.ts`
Expected: 10 passed。

- [ ] **Step 4: Commit**

```bash
git add games/poker/engine/poker-engine.ts games/poker/engine/__tests__/poker-engine.test.ts
git commit -m "feat(p1a): poker engine street transitions + boundary detection"
```

---

## Task 17: Poker engine — settleHand + finalize + match-end

**Files:**
- Modify: `games/poker/engine/poker-engine.ts`
- Modify: `games/poker/engine/__tests__/poker-engine.test.ts`

- [ ] **Step 1: 追加测试**

```typescript
describe('PokerEngine.finalize', () => {
  it('returns ranking sorted by chips desc', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    state = {
      ...state,
      matchComplete: true,
      players: state.players.map((p, i) => ({
        ...p,
        chips: i === 0 ? 500 : i === 1 ? 300 : 0,
        status: (i > 1 ? 'eliminated' : 'active') as PokerPlayerStatus,
      })),
    }
    const result = engine.finalize(state)
    expect(result.ranking.length).toBe(6)
    expect(result.ranking[0].rank).toBe(1)
    expect(result.ranking[0].score).toBeGreaterThanOrEqual(result.ranking[5].score)
  })
})

describe('PokerEngine settlement', () => {
  it('pot awarded when 5 fold to heads-up winner', () => {
    const engine = new PokerEngine()
    let state = engine.createInitialState(defaultConfig, ['a','b','c','d','e','f'])
    for (let i = 0; i < 5; i++) {
      const actor = engine.currentActor(state)
      if (!actor) break
      const r = engine.applyAction(state, actor, { type: 'fold' })
      state = r.nextState
    }
    // 底池应被唯一留下的人赢走
    const survivor = state.players.find((p) => p.status !== 'folded')!
    const totalInitial = defaultConfig.startingChips * 6
    const totalNow = state.players.reduce((s, p) => s + p.chips, 0)
    expect(totalNow).toBe(totalInitial)          // 守恒
    expect(survivor.chips).toBeGreaterThan(defaultConfig.startingChips)  // 赢了至少 SB+BB
  })
})
```

文件顶部加 `import type { PokerPlayerStatus } from '../poker-types'`（如还没）。

- [ ] **Step 2: 替换 `settleHand` 占位实现**

在 `poker-engine.ts` 顶部加：

```typescript
import { calculateSidePots } from './pot-manager'
import { evaluateHand } from './evaluator'
```

替换 `settleHand`：

```typescript
  private settleHand(state: PokerState): GameEvent[] {
    const events: GameEvent[] = []
    const bets = state.players.map((p) => ({
      playerId: p.id,
      amount: p.totalCommitted,
      isAllIn: p.status === 'allIn',
      isFolded: p.status === 'folded',
    }))
    const pots = calculateSidePots(bets)

    for (const pot of pots) {
      const eligible = state.players.filter((p) => pot.eligiblePlayerIds.includes(p.id))
      let winners: PokerPlayerState[]
      if (eligible.length === 1) {
        winners = eligible
      } else {
        const hands = eligible.map((p) => ({
          player: p,
          hand: evaluateHand([...p.holeCards, ...state.communityCards]),
        }))
        const best = Math.max(...hands.map((h) => h.hand.value))
        winners = hands.filter((h) => h.hand.value === best).map((h) => h.player)
      }
      const share = Math.floor(pot.amount / winners.length)
      for (const w of winners) w.chips += share
      events.push(this.makeEvent({
        kind: 'poker/pot-award', actorAgentId: null,
        payload: { potAmount: pot.amount, winnerIds: winners.map((w) => w.id) },
      }))
    }

    // match-end 检测
    const withChips = state.players.filter((p) => p.chips > 0)
    if (withChips.length <= 1) {
      state.matchComplete = true
      events.push(this.makeEvent({
        kind: 'poker/match-end', actorAgentId: null,
        payload: { winnerId: withChips[0]?.id ?? null },
      }))
    } else {
      for (const p of state.players) {
        if (p.chips === 0 && p.status !== 'sittingOut') p.status = 'eliminated'
      }
    }
    return events
  }
```

替换 `finalize`：

```typescript
  finalize(state: PokerState): MatchResult {
    const sorted = [...state.players].sort((a, b) => b.chips - a.chips)
    return {
      winnerFaction: null,
      ranking: sorted.map((p, idx) => ({
        agentId: p.id,
        rank: idx + 1,
        score: p.chips,
      })),
    }
  }
```

- [ ] **Step 3: 跑测试**

Run: `npm test games/poker/engine/__tests__/poker-engine.test.ts`
Expected: 12 passed。

Run: `npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 4: Commit**

```bash
git add games/poker/engine/poker-engine.ts games/poker/engine/__tests__/poker-engine.test.ts
git commit -m "feat(p1a): poker engine settlement + finalize + match-end detection"
```

---

# ===== 第 2 批完（Task 9-17）=====

**本批交付：** 完整 poker 引擎——Card/Deck/Evaluator/Equity/PotManager 算法层 + PokerEngine 状态机（初始化→下注轮→街切换→摊牌→结算→match-end→finalize）。

**验证：**
```bash
npm test games/poker/engine/
npx tsc --noEmit
```

Expected: poker/engine 下所有测试通过；9 个 feat(p1a) commits。

---

# ===== 第 3 批：Agent + 记忆 + GM + 端到端（Task 18-25）=====


---

## 本 plan 验收标准

- `PokerEngine` 实现完整 `GameEngine<PokerState, PokerAction, PokerConfig>` 契约
- 所有单测通过（initialState / availableActions / applyAction / street transition / settlement / finalize / boundary）
- 能手动模拟一手：6 人 → 5 人 fold → 唯一赢家获得底池，总筹码守恒
- Git 有 4 个 feat(p1a) commits

**下一份：** `2026-05-06-phase-1a-5-agent-memory.md` —— poker Agent 四契约（Bot/Parser/Context）+ 记忆 3 层 + plugin 注册。
