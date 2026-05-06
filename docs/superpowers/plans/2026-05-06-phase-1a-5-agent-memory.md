# Phase 1a-5 — Agent 契约 + 记忆三层 + Plugin 注册（Task 18-23）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成 poker 游戏自治的剩余部分——BotStrategy、ResponseParser、ContextBuilder 最小版，以及 Memory 三层（working 实现、episodic/semantic 骨架），组装成 MemoryModule，最后通过 poker-plugin.ts 注册到 gameRegistry。

**前置条件：** P1a-4 完成（PokerEngine 状态机已实现）。

**Bot-only 约束（本阶段关键）：**
- 本 Phase 不调 LLM，所以 ContextBuilder 只写最小版；真实 prompt 填充留给 LLM Phase
- Episodic/Semantic 返回 null / 空画像（Bot 对局不产生真印象）
- BotStrategy 是主力决策者，也是三层校验的 fallback

**下一份：** `2026-05-06-phase-1a-6-gm-e2e.md`（Game Master + tick loop + 三层校验 + 6-Bot 端到端）。

---

## Task 18: Poker BotStrategy（规则 Bot，作为 fallback 和 Bot-only 测试主力）

**Files:**
- Create: `games/poker/agent/bot-strategy.ts`
- Create: `games/poker/agent/__tests__/bot-strategy.test.ts`

**Context:** 简单规则 Bot：preflop 按手牌强度；postflop 按已下注比例 + 随机噪声。核心职责是"永远返回合法动作"，作为三层校验的最终 fallback。

- [x] **Step 1: 写测试**

Create `games/poker/agent/__tests__/bot-strategy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { PokerBotStrategy } from '../bot-strategy'
import { PokerEngine } from '../../engine/poker-engine'
import type { PokerConfig } from '../../engine/poker-types'

const cfg: PokerConfig = { smallBlind: 2, bigBlind: 4, startingChips: 200, maxBetsPerStreet: 4 }

describe('PokerBotStrategy', () => {
  it('always returns an action from validActions set', () => {
    const engine = new PokerEngine()
    const state = engine.createInitialState(cfg, ['a','b','c','d','e','f'])
    const actor = engine.currentActor(state)!
    const validActions = engine.availableActions(state, actor)
    const bot = new PokerBotStrategy()
    const action = bot.decide(state, validActions)
    expect(validActions.some((va) => va.type === action.type)).toBe(true)
  })

  it('finishes a hand when applied in loop', () => {
    const engine = new PokerEngine()
    const bot = new PokerBotStrategy()
    let state = engine.createInitialState(cfg, ['a','b','c','d','e','f'])
    let guard = 200
    while (!state.handComplete && guard-- > 0) {
      const actor = engine.currentActor(state)
      if (!actor) break
      const valid = engine.availableActions(state, actor)
      const action = bot.decide(state, valid)
      state = engine.applyAction(state, actor, action).nextState
    }
    expect(state.handComplete).toBe(true)
  })
})
```

- [x] **Step 2: 写实现**

Create `games/poker/agent/bot-strategy.ts`:

```typescript
import type { BotStrategy } from '@/lib/core/registry'
import type { ActionSpec } from '@/lib/engine/contracts'
import type { PokerState, PokerAction } from '../engine/poker-types'
import { rankValue } from '../engine/card'

/**
 * 规则 Bot：preflop 根据手牌强度决定；postflop 简单按下注意愿度 + 随机扰动。
 * 目标：永远返回合法动作；作为三层校验的最终 fallback。
 */
export class PokerBotStrategy implements BotStrategy {
  decide(gameStateRaw: unknown, validActionsRaw: unknown[]): PokerAction {
    const state = gameStateRaw as PokerState
    const validActions = validActionsRaw as ActionSpec<PokerAction>[]
    if (validActions.length === 0) return { type: 'fold' }

    const me = state.players.find((p) => p.id === state.currentActor)
    if (!me) return { type: 'fold' }

    const strength = this.handStrength(me.holeCards)
    const rng = Math.random()

    // Preflop 简化策略
    if (state.phase === 'preflop') {
      if (strength >= 0.75) return this.pickRaiseOrCall(validActions, rng)
      if (strength >= 0.45) return this.pickCallOrCheck(validActions)
      return this.pickFoldOrCheck(validActions)
    }

    // Postflop 简化：有 strong 牌加注；否则看底池赔率决定 call/check/fold
    if (strength >= 0.7 && rng < 0.6) return this.pickRaiseOrCall(validActions, rng)
    return this.pickCallOrCheck(validActions) ?? this.pickFoldOrCheck(validActions)
  }

  /** 两张底牌的简化强度评估（0~1）。 */
  private handStrength(holeCards: { rank: string }[]): number {
    if (holeCards.length < 2) return 0.3
    const [a, b] = holeCards
    const ra = rankValue(a.rank as never)
    const rb = rankValue(b.rank as never)
    const hi = Math.max(ra, rb)
    const lo = Math.min(ra, rb)
    const pair = ra === rb
    if (pair) return Math.min(1, 0.5 + (ra - 2) / 24)
    const gap = hi - lo
    const connector = gap === 1 ? 0.08 : 0
    return Math.min(1, (hi - 5) / 20 + connector)
  }

  private pickRaiseOrCall(actions: ActionSpec<PokerAction>[], rng: number): PokerAction {
    const raise = actions.find((a) => a.type === 'raise' || a.type === 'bet')
    if (raise && rng < 0.6) {
      if (raise.type === 'raise') return { type: 'raise', toAmount: raise.minAmount ?? 0 }
      return { type: 'bet', amount: raise.minAmount ?? 0 }
    }
    const call = actions.find((a) => a.type === 'call')
    if (call) return { type: 'call', amount: call.minAmount ?? 0 }
    const check = actions.find((a) => a.type === 'check')
    if (check) return { type: 'check' }
    const allIn = actions.find((a) => a.type === 'allIn')
    if (allIn) return { type: 'allIn', amount: allIn.minAmount ?? 0 }
    return { type: 'fold' }
  }

  private pickCallOrCheck(actions: ActionSpec<PokerAction>[]): PokerAction {
    const check = actions.find((a) => a.type === 'check')
    if (check) return { type: 'check' }
    const call = actions.find((a) => a.type === 'call')
    if (call) return { type: 'call', amount: call.minAmount ?? 0 }
    return { type: 'fold' }
  }

  private pickFoldOrCheck(actions: ActionSpec<PokerAction>[]): PokerAction {
    const check = actions.find((a) => a.type === 'check')
    if (check) return { type: 'check' }
    return { type: 'fold' }
  }
}
```

- [x] **Step 3: 跑测试**

Run: `npm test games/poker/agent/__tests__/bot-strategy.test.ts`
Expected: 2 passed。

- [x] **Step 4: Commit**

```bash
git add games/poker/agent/bot-strategy.ts games/poker/agent/__tests__/bot-strategy.test.ts
git commit -m "feat(p1a): poker BotStrategy (rule-based fallback)"
```

---

## Task 19: Poker Response Parser（三层校验第二层）

**Files:**
- Create: `games/poker/agent/response-parser.ts`
- Create: `games/poker/agent/__tests__/response-parser.test.ts`

**Context:** 解析 LLM/Bot 返回的文本，提取 `<thinking>` + `<action>`；fallback 到 BotStrategy。本 Phase Bot-only，所以 Parser 主要被将来 LLM 版本用，但接口要先建好。

- [x] **Step 1: 写测试**

Create `games/poker/agent/__tests__/response-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { PokerResponseParser } from '../response-parser'
import type { ActionSpec } from '@/lib/engine/contracts'
import type { PokerAction } from '../../engine/poker-types'

const validActions: ActionSpec<PokerAction>[] = [
  { type: 'fold' },
  { type: 'call', minAmount: 4, maxAmount: 4 },
  { type: 'raise', minAmount: 6, maxAmount: 6 },
]

describe('PokerResponseParser', () => {
  it('parses clean <action>call</action>', () => {
    const parser = new PokerResponseParser()
    const r = parser.parse('<thinking>analyze</thinking><action>call</action>', validActions)
    expect((r.action as PokerAction).type).toBe('call')
    expect(r.thinking).toContain('analyze')
    expect(r.fallbackUsed).toBe(false)
  })

  it('bet → raise fuzzy match when raise is the valid action', () => {
    const parser = new PokerResponseParser()
    const r = parser.parse('<action>bet</action>', validActions)
    expect((r.action as PokerAction).type).toBe('raise')
  })

  it('garbage text triggers fallback to fold', () => {
    const parser = new PokerResponseParser()
    const r = parser.parse('hello world no tags', validActions)
    expect((r.action as PokerAction).type).toBe('fold')
    expect(r.fallbackUsed).toBe(true)
  })

  it('extracts thinking even without action tag', () => {
    const parser = new PokerResponseParser()
    const r = parser.parse('<thinking>only analysis</thinking>', validActions)
    expect(r.thinking).toContain('only analysis')
    expect(r.fallbackUsed).toBe(true)
  })
})
```

- [x] **Step 2: 写实现**

Create `games/poker/agent/response-parser.ts`:

```typescript
import type { ResponseParser, ParsedResponse } from '@/lib/core/registry'
import type { ActionSpec } from '@/lib/engine/contracts'
import type { PokerAction } from '../engine/poker-types'

export class PokerResponseParser implements ResponseParser {
  parse(rawText: string, validActionsRaw: unknown[]): ParsedResponse {
    const validActions = validActionsRaw as ActionSpec<PokerAction>[]
    const thinking = this.extractTag(rawText, 'thinking') ?? ''
    const actionStr = this.extractTag(rawText, 'action')?.toLowerCase().trim()

    if (!actionStr) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    // 规范化 type
    let typ: PokerAction['type'] | null = null
    if (actionStr.startsWith('fold')) typ = 'fold'
    else if (actionStr.startsWith('check')) typ = 'check'
    else if (actionStr.startsWith('call')) typ = 'call'
    else if (actionStr.startsWith('bet') || actionStr.startsWith('raise')) {
      // 模糊：bet 在 FL 里等价 raise；raise 在无 bet 时等价 bet
      if (validActions.some((a) => a.type === 'raise')) typ = 'raise'
      else if (validActions.some((a) => a.type === 'bet')) typ = 'bet'
      else typ = 'fold'
    } else if (actionStr.startsWith('all') || actionStr.includes('all-in') || actionStr.includes('all in')) {
      typ = 'allIn'
    }

    if (!typ) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    const spec = validActions.find((a) => a.type === typ)
    if (!spec) {
      return { action: this.fallback(validActions), thinking, fallbackUsed: true }
    }

    const amount = spec.minAmount ?? 0
    let action: PokerAction
    switch (typ) {
      case 'fold': action = { type: 'fold' }; break
      case 'check': action = { type: 'check' }; break
      case 'call': action = { type: 'call', amount }; break
      case 'bet': action = { type: 'bet', amount }; break
      case 'raise': action = { type: 'raise', toAmount: amount }; break
      case 'allIn': action = { type: 'allIn', amount }; break
      default: action = { type: 'fold' }
    }
    return { action, thinking, fallbackUsed: false }
  }

  private extractTag(text: string, tag: string): string | null {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')
    const m = text.match(re)
    return m ? m[1] : null
  }

  private fallback(validActions: ActionSpec<PokerAction>[]): PokerAction {
    // 优先 check → fold，保证合法
    if (validActions.some((a) => a.type === 'check')) return { type: 'check' }
    return { type: 'fold' }
  }
}
```

- [x] **Step 3: 跑测试 + commit**

Run: `npm test games/poker/agent/__tests__/response-parser.test.ts`
Expected: 4 passed。

```bash
git add games/poker/agent/response-parser.ts games/poker/agent/__tests__/response-parser.test.ts
git commit -m "feat(p1a): poker ResponseParser (tag extract + fuzzy + fallback)"
```

---

## Task 20: Poker ContextBuilder（简化版，Bot-only Phase）

**Files:**
- Create: `games/poker/agent/context-builder.ts`

**Context:** 本 Phase Bot-only，ContextBuilder 不会被调用（Agent Endpoint 直接调 BotStrategy）。但为了接口契约完整，仍然写一份最小实现，供后续 LLM Phase 使用。**测试先省略，P1b/后续 LLM 接入时补。**

- [x] **Step 1: 写最小实现**

Create `games/poker/agent/context-builder.ts`:

```typescript
import type { PlayerContextBuilder } from '@/lib/core/registry'
import type { MemoryContextSnapshot } from '@/lib/memory/contracts'
import type { ActionSpec } from '@/lib/engine/contracts'
import type { PokerState, PokerAction } from '../engine/poker-types'
import { cardToString } from '../engine/card'

/**
 * Poker 玩家的 ContextBuilder（简化版，详细版本参考 old/src/games/poker/agent/poker-context.ts）。
 * Bot-only Phase 下不被真正调用；LLM Phase 后会被 Agent Endpoint 调。
 */
export class PokerPlayerContextBuilder implements PlayerContextBuilder {
  build(input: {
    agent: { id: string; systemPrompt: string }
    gameState: unknown
    validActions: unknown[]
    memoryContext: MemoryContextSnapshot
  }): { systemMessage: string; userMessage: string } {
    const state = input.gameState as PokerState
    const actions = input.validActions as ActionSpec<PokerAction>[]
    const me = state.players.find((p) => p.id === input.agent.id)!

    const systemMessage = `${input.agent.systemPrompt}

游戏：6-max 固定限注德州扑克。小盲 ${state.smallBlind}，大盲 ${state.bigBlind}。
要求输出格式：
<thinking>简短分析（≤200字）</thinking>
<action>fold|check|call|bet|raise|allIn</action>

${input.memoryContext.semanticSection}
${input.memoryContext.episodicSection}`

    const userMessage = `## 当前手牌 #${state.handNumber}
你的底牌: ${me.holeCards.map(cardToString).join(' ')}
筹码: $${me.chips}
本街: ${state.phase}
公共牌: ${state.communityCards.length > 0 ? state.communityCards.map(cardToString).join(' ') : '无'}
当前下注: $${Math.max(...state.players.map((p) => p.currentBet))}

合法动作：
${actions.map((a) => `- ${a.type}${a.minAmount ? ` ${a.minAmount}` : ''}`).join('\n')}

${input.memoryContext.workingSummary}

请决定你的动作。`

    return { systemMessage, userMessage }
  }
}
```

- [x] **Step 2: Commit**

```bash
git add games/poker/agent/context-builder.ts
git commit -m "feat(p1a): poker ContextBuilder (minimal; LLM Phase will flesh out)"
```

---

## Task 21: Poker Memory — EMA 抄 + Working 层

**Files:**
- Create: `games/poker/memory/ema.ts`
- Create: `games/poker/memory/working.ts`
- Create: `games/poker/memory/__tests__/ema.test.ts`
- Create: `games/poker/memory/__tests__/working.test.ts`

**Source:** `old/src/games/poker/agent/poker-ema.ts`

- [x] **Step 1: 抄 EMA**

```bash
cp old/src/games/poker/agent/poker-ema.ts games/poker/memory/ema.ts
```

编辑 `games/poker/memory/ema.ts` 去掉 old 路径 import，就地定义类型：

```typescript
/**
 * EMA 平滑（spec 6.3；从 old/ 移植）。
 * new = α × raw + (1 - α) × old；冷启动 handCount=0 时直接用 raw。
 */

export interface StructuredImpression {
  looseness: number
  aggression: number
  stickiness: number
  honesty: number
  note: string
  handCount: number
}

export interface RawImpressionScores {
  looseness: number
  aggression: number
  stickiness: number
  honesty: number
  note: string
}

export function applyEMA(
  current: StructuredImpression | undefined,
  raw: RawImpressionScores,
  alpha: number = 0.3,
): StructuredImpression {
  if (!current || current.handCount === 0) {
    return {
      looseness: clampScore(raw.looseness),
      aggression: clampScore(raw.aggression),
      stickiness: clampScore(raw.stickiness),
      honesty: clampScore(raw.honesty),
      note: raw.note.slice(0, 30),
      handCount: 1,
    }
  }
  return {
    looseness: roundScore(alpha * clampScore(raw.looseness) + (1 - alpha) * current.looseness),
    aggression: roundScore(alpha * clampScore(raw.aggression) + (1 - alpha) * current.aggression),
    stickiness: roundScore(alpha * clampScore(raw.stickiness) + (1 - alpha) * current.stickiness),
    honesty: roundScore(alpha * clampScore(raw.honesty) + (1 - alpha) * current.honesty),
    note: raw.note.slice(0, 30),
    handCount: current.handCount + 1,
  }
}

function clampScore(v: number): number {
  return Math.max(1, Math.min(10, Math.round(v)))
}

function roundScore(v: number): number {
  return Math.round(v * 10) / 10
}
```

- [x] **Step 2: 写 EMA 测试**

Create `games/poker/memory/__tests__/ema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { applyEMA } from '../ema'

describe('applyEMA', () => {
  it('cold start uses raw directly', () => {
    const r = applyEMA(undefined, {
      looseness: 7, aggression: 8, stickiness: 5, honesty: 6, note: 'test',
    })
    expect(r.looseness).toBe(7)
    expect(r.handCount).toBe(1)
  })

  it('blends with existing via alpha=0.3', () => {
    const prev = { looseness: 5, aggression: 5, stickiness: 5, honesty: 5, note: 'x', handCount: 10 }
    const r = applyEMA(prev, { looseness: 10, aggression: 10, stickiness: 10, honesty: 10, note: 'y' })
    // 0.3*10 + 0.7*5 = 6.5
    expect(r.looseness).toBeCloseTo(6.5, 1)
    expect(r.handCount).toBe(11)
  })

  it('clamps to [1,10]', () => {
    const r = applyEMA(undefined, { looseness: 15, aggression: -3, stickiness: 5, honesty: 7, note: '' })
    expect(r.looseness).toBe(10)
    expect(r.aggression).toBe(1)
  })
})
```

- [x] **Step 3: 写 Working memory**

Create `games/poker/memory/working.ts`:

```typescript
import type { GameEvent } from '@/lib/core/types'

export type PokerWorkingMemory = {
  matchActionsLog: Array<{
    seq: number
    kind: string
    actorAgentId: string | null
    payload: Record<string, unknown>
  }>
  currentHandNumber: number
}

export function initWorking(): PokerWorkingMemory {
  return { matchActionsLog: [], currentHandNumber: 1 }
}

export function updateWorking(
  prev: PokerWorkingMemory,
  event: GameEvent,
): PokerWorkingMemory {
  // 公开事件 + 针对 observer 的 role-restricted 事件才进 working
  // （实际过滤在 MemoryModule 外层，本函数假设 event 已经过滤）
  return {
    ...prev,
    matchActionsLog: [
      ...prev.matchActionsLog,
      {
        seq: event.seq,
        kind: event.kind,
        actorAgentId: event.actorAgentId,
        payload: event.payload,
      },
    ],
    currentHandNumber:
      event.kind === 'poker/match-end' || event.kind === 'poker/pot-award'
        ? prev.currentHandNumber + 1
        : prev.currentHandNumber,
  }
}

export function formatWorkingForPrompt(w: PokerWorkingMemory): string {
  const last20 = w.matchActionsLog.slice(-20)
  const lines = last20.map((a) =>
    `[seq ${a.seq}] ${a.kind}${a.actorAgentId ? ` by ${a.actorAgentId}` : ''}: ${JSON.stringify(a.payload)}`,
  )
  return `## 本局动作日志（最近 20 条）\n${lines.join('\n')}`
}
```

- [x] **Step 4: 写 working memory 测试**

Create `games/poker/memory/__tests__/working.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { initWorking, updateWorking } from '../working'

describe('poker working memory', () => {
  it('init returns empty log', () => {
    const w = initWorking()
    expect(w.matchActionsLog).toEqual([])
    expect(w.currentHandNumber).toBe(1)
  })

  it('updateWorking appends event', () => {
    const w0 = initWorking()
    const w1 = updateWorking(w0, {
      id: 'e1', matchId: 'm', gameType: 'poker', seq: 1,
      occurredAt: new Date().toISOString(), kind: 'poker/action',
      actorAgentId: 'a', payload: { type: 'fold' },
      visibility: 'public', restrictedTo: null,
    })
    expect(w1.matchActionsLog.length).toBe(1)
    expect(w1.matchActionsLog[0].actorAgentId).toBe('a')
  })
})
```

- [x] **Step 5: 跑测试 + commit**

Run: `npm test games/poker/memory/__tests__/`
Expected: 5 passed。

```bash
git add games/poker/memory/ema.ts games/poker/memory/working.ts games/poker/memory/__tests__/
git commit -m "feat(p1a): poker memory (EMA + working layer) with tests"
```

---

## Task 22: Poker Memory — Episodic + Semantic + MemoryModule 组装

**Files:**
- Create: `games/poker/memory/episodic.ts`
- Create: `games/poker/memory/semantic.ts`
- Create: `games/poker/memory/poker-memory.ts`

**Context:** Phase 1a Bot-only，不会真的调 LLM 生成 episodic/semantic。本 Task 写接口 + 空实现（返回 null / 空画像），保证契约完整，Bot 对局可以跑通。真实 LLM 版本在 P1b 或后续 Phase 填。

- [x] **Step 1: 写 Episodic（骨架）**

Create `games/poker/memory/episodic.ts`:

```typescript
import type { Card } from '../engine/card'

export type PokerEpisodicEntry = {
  handId: string
  observer: string
  target: string
  observedActions: string[]
  outcome: 'won' | 'lost' | 'folded' | 'showdown'
  targetShowdownHand: Card[] | null
  summary: string                     // ≤80 字
  tags: string[]
  createdAt: string
}

/**
 * 从 working memory 和 final hand state 合成一条 episodic。
 * Phase 1a Bot-only：直接根据 actions 产生简单 summary；不调 LLM。
 */
export function synthesizeEpisodic(_input: {
  workingLog: Array<{ seq: number; kind: string; actorAgentId: string | null; payload: Record<string, unknown> }>
  finalState: unknown
  observerAgentId: string
  targetAgentId: string
  matchId: string
}): PokerEpisodicEntry | null {
  // Bot-only 简化：暂不生成（避免 DB 膨胀）
  return null
}

export function formatEpisodicSection(entries: PokerEpisodicEntry[]): string {
  if (entries.length === 0) return '## 对手情景\n（暂无）'
  return `## 对手情景\n${entries.map((e) => `- [${e.handId} vs ${e.target}] ${e.summary}`).join('\n')}`
}
```

- [x] **Step 2: 写 Semantic（骨架）**

Create `games/poker/memory/semantic.ts`:

```typescript
import type { StructuredImpression, RawImpressionScores } from './ema'
import { applyEMA } from './ema'
import type { PokerEpisodicEntry } from './episodic'

export type PokerSemanticProfile = StructuredImpression & {
  lastUpdatedHandId: string | null
}

export function initSemantic(): PokerSemanticProfile {
  return {
    looseness: 5, aggression: 5, stickiness: 5, honesty: 5,
    note: '', handCount: 0,
    lastUpdatedHandId: null,
  }
}

/**
 * Bot-only Phase：简单累加 handCount；不调 LLM 更新分数。
 * LLM Phase 会从 episodic 提取 raw scores。
 */
export function updateSemantic(
  current: PokerSemanticProfile | null,
  episodic: PokerEpisodicEntry | null,
): PokerSemanticProfile {
  const base = current ?? initSemantic()
  if (!episodic) return { ...base, handCount: base.handCount + 1 }
  // 占位：真实 LLM 会生成 raw 并 applyEMA
  const raw: RawImpressionScores = {
    looseness: base.looseness, aggression: base.aggression,
    stickiness: base.stickiness, honesty: base.honesty, note: base.note,
  }
  const next = applyEMA(base, raw)
  return { ...next, lastUpdatedHandId: episodic.handId }
}

export function formatSemanticSection(
  profiles: Map<string, PokerSemanticProfile>,
): string {
  if (profiles.size === 0) return '## 对手画像\n（暂无）'
  const lines: string[] = ['## 对手画像']
  for (const [targetId, p] of profiles) {
    lines.push(
      `- ${targetId}: L=${p.looseness.toFixed(1)} A=${p.aggression.toFixed(1)} S=${p.stickiness.toFixed(1)} H=${p.honesty.toFixed(1)} (${p.handCount}手观察)`,
    )
  }
  return lines.join('\n')
}
```

- [x] **Step 3: 组装 MemoryModule**

Create `games/poker/memory/poker-memory.ts`:

```typescript
import type { MemoryModule, MemoryContextSnapshot } from '@/lib/memory/contracts'
import type { GameEvent } from '@/lib/core/types'
import type { PokerWorkingMemory } from './working'
import { initWorking, updateWorking, formatWorkingForPrompt } from './working'
import type { PokerEpisodicEntry } from './episodic'
import { synthesizeEpisodic as synth, formatEpisodicSection } from './episodic'
import type { PokerSemanticProfile } from './semantic'
import { initSemantic, updateSemantic, formatSemanticSection } from './semantic'

export class PokerMemoryModule
  implements MemoryModule<PokerWorkingMemory, PokerEpisodicEntry, PokerSemanticProfile>
{
  readonly gameType = 'poker' as const

  initWorking(_matchId: string, _agentId: string): PokerWorkingMemory {
    return initWorking()
  }

  updateWorking(prev: PokerWorkingMemory, event: GameEvent): PokerWorkingMemory {
    return updateWorking(prev, event)
  }

  synthesizeEpisodic(input: {
    working: PokerWorkingMemory
    finalState: unknown
    observerAgentId: string
    targetAgentId: string | null
    matchId: string
  }): PokerEpisodicEntry | null {
    if (!input.targetAgentId) return null
    return synth({
      workingLog: input.working.matchActionsLog,
      finalState: input.finalState,
      observerAgentId: input.observerAgentId,
      targetAgentId: input.targetAgentId,
      matchId: input.matchId,
    })
  }

  updateSemantic(
    current: PokerSemanticProfile | null,
    episodic: PokerEpisodicEntry,
  ): PokerSemanticProfile {
    return updateSemantic(current, episodic)
  }

  buildMemoryContext(input: {
    working: PokerWorkingMemory
    allEpisodic: PokerEpisodicEntry[]
    semanticByTarget: Map<string, PokerSemanticProfile>
  }): MemoryContextSnapshot {
    return {
      workingSummary: formatWorkingForPrompt(input.working),
      episodicSection: formatEpisodicSection(input.allEpisodic),
      semanticSection: formatSemanticSection(input.semanticByTarget),
      raw: {
        working: input.working as unknown as Record<string, unknown>,
      },
    }
  }

  serialize = {
    working: (w: PokerWorkingMemory) => w as unknown as Record<string, unknown>,
    episodic: (e: PokerEpisodicEntry) => e as unknown as Record<string, unknown>,
    semantic: (s: PokerSemanticProfile) => s as unknown as Record<string, unknown>,
  }
  deserialize = {
    working: (raw: Record<string, unknown>) => raw as unknown as PokerWorkingMemory,
    episodic: (raw: Record<string, unknown>) => raw as unknown as PokerEpisodicEntry,
    semantic: (raw: Record<string, unknown>) => raw as unknown as PokerSemanticProfile,
  }
}
```

- [x] **Step 4: 写 MemoryModule 组合测试**

Create `games/poker/memory/__tests__/poker-memory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { PokerMemoryModule } from '../poker-memory'

describe('PokerMemoryModule', () => {
  it('gameType is poker', () => {
    const m = new PokerMemoryModule()
    expect(m.gameType).toBe('poker')
  })

  it('buildMemoryContext renders all sections', () => {
    const m = new PokerMemoryModule()
    const ctx = m.buildMemoryContext({
      working: m.initWorking('match1', 'agt_1'),
      allEpisodic: [],
      semanticByTarget: new Map(),
    })
    expect(ctx.workingSummary).toContain('本局动作日志')
    expect(ctx.episodicSection).toContain('对手情景')
    expect(ctx.semanticSection).toContain('对手画像')
  })
})
```

- [x] **Step 5: 跑测试 + commit**

Run: `npm test games/poker/memory/`
Expected: 7 passed（前面 5 + 新 2）。

```bash
git add games/poker/memory/episodic.ts games/poker/memory/semantic.ts games/poker/memory/poker-memory.ts games/poker/memory/__tests__/poker-memory.test.ts
git commit -m "feat(p1a): poker memory module (episodic/semantic placeholders + assembly)"
```

---

## Task 23: Poker Plugin + Registry 注册

**Files:**
- Create: `games/poker/poker-plugin.ts`
- Create: `lib/core/register-games.ts`（统一注册入口）
- Create: `tests/lib/core/register-games.test.ts`

- [ ] **Step 1: 写 plugin**

Create `games/poker/poker-plugin.ts`:

```typescript
import type { GameModule } from '@/lib/core/registry'
import { PokerEngine } from './engine/poker-engine'
import { PokerMemoryModule } from './memory/poker-memory'
import { PokerPlayerContextBuilder } from './agent/context-builder'
import { PokerResponseParser } from './agent/response-parser'
import { PokerBotStrategy } from './agent/bot-strategy'

export const pokerPlugin: GameModule = {
  gameType: 'poker',
  engine: new PokerEngine() as unknown as GameModule['engine'],
  memory: new PokerMemoryModule() as unknown as GameModule['memory'],
  playerContextBuilder: new PokerPlayerContextBuilder(),
  responseParser: new PokerResponseParser(),
  botStrategy: new PokerBotStrategy(),
}
```

- [ ] **Step 2: 写统一注册**

Create `lib/core/register-games.ts`:

```typescript
import { registerGame } from '@/lib/core/registry'
import { pokerPlugin } from '@/games/poker/poker-plugin'

/**
 * 应用启动时调用（如 Next.js instrumentation.ts 或 lazy 调用）。
 * Phase 1a 只注册 poker；Phase 3 会追加 werewolf。
 */
export function registerAllGames(): void {
  registerGame(pokerPlugin)
}
```

- [ ] **Step 3: 写测试**

Create `tests/lib/core/register-games.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { clearRegistry, hasGame, getGame } from '@/lib/core/registry'
import { registerAllGames } from '@/lib/core/register-games'

describe('registerAllGames', () => {
  beforeEach(() => clearRegistry())

  it('registers poker plugin', () => {
    registerAllGames()
    expect(hasGame('poker')).toBe(true)
    const mod = getGame('poker')
    expect(mod.gameType).toBe('poker')
    expect(mod.engine).toBeDefined()
    expect(mod.memory).toBeDefined()
    expect(mod.botStrategy).toBeDefined()
  })
})
```

- [ ] **Step 4: 跑测试 + commit**

Run: `npm test tests/lib/core/register-games.test.ts`
Expected: 1 passed。

```bash
git add games/poker/poker-plugin.ts lib/core/register-games.ts tests/lib/core/register-games.test.ts
git commit -m "feat(p1a): poker plugin + registerAllGames entry"
```

---


---

## 本 plan 验收标准

- BotStrategy 能对任意合法 state 返回合法 action（测试：连续 decide 直到 handComplete）
- ResponseParser 通过 fuzzy 匹配测试（bet/raise 互换、garbage→fold）
- ContextBuilder 能渲染 system+user message（内容不追求完整，但能编译+调用成功）
- MemoryModule.buildMemoryContext 渲染三个 section
- `gameRegistry.get('poker')` 返回完整 GameModule
- Git 有 6 个 feat(p1a) commits

**下一份：** `2026-05-06-phase-1a-6-gm-e2e.md` —— Game Master tick loop + match-lifecycle + SSE broadcast + action-validator + **M3 里程碑：6-Bot 端到端集成测试**。
