# Phase 3-1 — 狼人杀引擎：阶段机 + 动作校验 + 胜负

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现简化 6 人狼人杀的纯 TypeScript 引擎（零 React 依赖）：夜晚 / 白天 8 阶段机、动作合法性校验、胜负判定、visibility 标注的事件产出。

**Architecture:**
- `games/werewolf/engine/`：状态机 + 动作 dispatcher
- 严格对齐 spec 5.3 的 `WerewolfAction` / `WerewolfState` 类型
- `nextActor()` / `applyAction()` / `phaseAdvance()` 三主方法，对齐 `GameEngine` 契约（P1a-2）
- 事件 visibility：`role-restricted`（狼讨论 / 预言家验人 / 女巫行动）、`public`（发言 / 投票公布 / 死亡）

**前置条件：** Phase 2 完成；`lib/core/types` 和 `GameEngine` 契约已稳定。

**参考 spec:** 第 5.3 节（Werewolf 引擎）、第 5.5 节（事件 visibility）。

**不做的事：**
- ❌ Agent / ContextBuilder / Parser（Phase 3-2）
- ❌ Moderator 接入（Phase 3-3）
- ❌ UI（Phase 3-4）

---

## 文件结构

```
Colosseum/
├── games/werewolf/
│   ├── engine/
│   │   ├── types.ts                  # WerewolfState / WerewolfAction / Role
│   │   ├── roles.ts                  # 角色分配 / 阵营判定
│   │   ├── validator.ts              # 动作合法性校验
│   │   ├── phase-machine.ts          # 8 阶段转换逻辑
│   │   ├── win-condition.ts          # 胜负 / 平局判定
│   │   └── werewolf-engine.ts        # 实现 GameEngine<WerewolfAction, WerewolfState>
│   └── plugin.ts                     # 注册到 gameRegistry（延后，Phase 3-3 补齐）
└── tests/games/werewolf/engine/
    ├── roles.test.ts
    ├── validator.test.ts
    ├── phase-machine.test.ts
    ├── win-condition.test.ts
    └── werewolf-engine.test.ts
```

---

## Task 1: 类型 + 角色分配

**Files:**
- Create: `games/werewolf/engine/types.ts`
- Create: `games/werewolf/engine/roles.ts`
- Create: `tests/games/werewolf/engine/roles.test.ts`

- [ ] **Step 1: types.ts**

```typescript
// games/werewolf/engine/types.ts
export type WerewolfRole = 'werewolf' | 'seer' | 'witch' | 'villager'
export type WerewolfFaction = 'werewolves' | 'villagers'

export type WerewolfPhase =
  | 'night/werewolfDiscussion'
  | 'night/werewolfKill'
  | 'night/seerCheck'
  | 'night/witchAction'
  | 'day/announce'
  | 'day/speak'
  | 'day/vote'
  | 'day/execute'

export interface WerewolfPlayerState {
  agentId: string
  name: string
  alive: boolean
  seatOrder: number
  deathDay: number | null
  deathCause: 'werewolfKill' | 'witchPoison' | 'vote' | null
}

export type WerewolfAction =
  | { type: 'night/werewolfKill'; targetId: string; reasoning: string }
  | { type: 'night/seerCheck'; targetId: string }
  | { type: 'night/witchSave' }
  | { type: 'night/witchPoison'; targetId: string | null }
  | { type: 'day/speak'; content: string; claimedRole?: WerewolfRole }
  | { type: 'day/vote'; targetId: string | null; reason?: string }

export interface SpeechRecord {
  day: number
  agentId: string
  content: string
  claimedRole?: WerewolfRole
  at: number
}

export interface VoteRecord {
  day: number
  voter: string
  target: string | null
  reason?: string
  at: number
}

export interface SeerResult {
  day: number
  targetId: string
  role: WerewolfRole
}

export interface WerewolfState {
  day: number
  phase: WerewolfPhase
  players: WerewolfPlayerState[]
  roleAssignments: Record<string, WerewolfRole>
  moderatorAgentId: string
  speechQueue: string[]
  currentActor: string | null
  witchPotions: { save: boolean; poison: boolean }
  lastNightKilled: string | null
  lastNightSaved: string | null
  lastNightPoisoned: string | null
  seerCheckResults: SeerResult[]
  speechLog: SpeechRecord[]
  voteLog: VoteRecord[]
  werewolfDiscussionQueue: string[]   // 狼夜晚发言队列
  matchComplete: boolean
  winner: WerewolfFaction | 'tie' | null
}
```

- [ ] **Step 2: roles.ts**

```typescript
// games/werewolf/engine/roles.ts
import type { WerewolfRole, WerewolfFaction } from './types'

export const WEREWOLF_ROLE_COMPOSITION: Record<WerewolfRole, number> = {
  werewolf: 2, seer: 1, witch: 1, villager: 2,
}

export function factionOf(role: WerewolfRole): WerewolfFaction {
  return role === 'werewolf' ? 'werewolves' : 'villagers'
}

export function assignRoles(
  agentIds: string[],
  rng: () => number = Math.random,
): Record<string, WerewolfRole> {
  if (agentIds.length !== 6) throw new Error('werewolf requires exactly 6 agents')
  const pool: WerewolfRole[] = []
  for (const [role, count] of Object.entries(WEREWOLF_ROLE_COMPOSITION)) {
    for (let i = 0; i < count; i++) pool.push(role as WerewolfRole)
  }
  // Fisher-Yates
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const out: Record<string, WerewolfRole> = {}
  agentIds.forEach((id, i) => { out[id] = shuffled[i] })
  return out
}
```

- [ ] **Step 3: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { assignRoles, factionOf } from '@/games/werewolf/engine/roles'

describe('assignRoles', () => {
  it('assigns 6 agents with exact composition', () => {
    const r = assignRoles(['a','b','c','d','e','f'])
    const counts: Record<string, number> = {}
    for (const role of Object.values(r)) counts[role] = (counts[role] ?? 0) + 1
    expect(counts.werewolf).toBe(2)
    expect(counts.seer).toBe(1)
    expect(counts.witch).toBe(1)
    expect(counts.villager).toBe(2)
  })
  it('throws on non-6 agents', () => {
    expect(() => assignRoles(['a','b'])).toThrow()
  })
  it('deterministic with seeded rng', () => {
    const rng = seedRng(42)
    const r1 = assignRoles(['a','b','c','d','e','f'], rng)
    const rng2 = seedRng(42)
    const r2 = assignRoles(['a','b','c','d','e','f'], rng2)
    expect(r1).toEqual(r2)
  })
})

describe('factionOf', () => {
  it('werewolf → werewolves', () => { expect(factionOf('werewolf')).toBe('werewolves') })
  it('seer/witch/villager → villagers', () => {
    expect(factionOf('seer')).toBe('villagers')
    expect(factionOf('witch')).toBe('villagers')
    expect(factionOf('villager')).toBe('villagers')
  })
})

function seedRng(seed: number): () => number {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) % 2 ** 32; return s / 2 ** 32 }
}
```

Run: `npx vitest run tests/games/werewolf/engine/roles.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add games/werewolf/engine/types.ts games/werewolf/engine/roles.ts tests/games/werewolf/engine/roles.test.ts
git commit -m "feat(p3-1): werewolf engine types + role assignment"
```

---

## Task 2: 动作合法性校验

**Files:**
- Create: `games/werewolf/engine/validator.ts`
- Create: `tests/games/werewolf/engine/validator.test.ts`

**Context:** 每阶段合法动作不同：
- `night/werewolfDiscussion` / `night/werewolfKill` → actor 必须是狼且活着；target 必须活着
- `night/seerCheck` → actor 必须是 seer；target 活着且非自己
- `night/witchAction` → actor 必须是 witch；`save` 需 potions.save=true 且首夜不可自救；`poison` 需 potions.poison=true
- `day/speak` → 当前 actor + 发言轮到他
- `day/vote` → 所有活着玩家轮到

- [ ] **Step 1: 实现**

```typescript
// games/werewolf/engine/validator.ts
import type { WerewolfAction, WerewolfState } from './types'

export interface ValidationResult { ok: boolean; reason?: string }

export function validate(state: WerewolfState, actorId: string, action: WerewolfAction): ValidationResult {
  const actor = state.players.find(p => p.agentId === actorId)
  if (!actor) return { ok: false, reason: 'actor not in game' }
  if (!actor.alive) return { ok: false, reason: 'actor is dead' }
  const role = state.roleAssignments[actorId]

  switch (action.type) {
    case 'night/werewolfKill':
      if (state.phase !== 'night/werewolfKill') return { ok: false, reason: 'wrong phase' }
      if (role !== 'werewolf') return { ok: false, reason: 'not werewolf' }
      return targetAlive(state, action.targetId)

    case 'night/seerCheck':
      if (state.phase !== 'night/seerCheck') return { ok: false, reason: 'wrong phase' }
      if (role !== 'seer') return { ok: false, reason: 'not seer' }
      if (action.targetId === actorId) return { ok: false, reason: 'cannot check self' }
      return targetAlive(state, action.targetId)

    case 'night/witchSave':
      if (state.phase !== 'night/witchAction') return { ok: false, reason: 'wrong phase' }
      if (role !== 'witch') return { ok: false, reason: 'not witch' }
      if (!state.witchPotions.save) return { ok: false, reason: 'no save potion' }
      if (state.day === 0 && state.lastNightKilled === actorId) return { ok: false, reason: 'cannot self-save on first night' }
      return { ok: true }

    case 'night/witchPoison':
      if (state.phase !== 'night/witchAction') return { ok: false, reason: 'wrong phase' }
      if (role !== 'witch') return { ok: false, reason: 'not witch' }
      if (!state.witchPotions.poison) return { ok: false, reason: 'no poison' }
      if (action.targetId === null) return { ok: true }
      return targetAlive(state, action.targetId)

    case 'day/speak':
      if (state.phase !== 'day/speak') return { ok: false, reason: 'wrong phase' }
      if (state.currentActor !== actorId) return { ok: false, reason: 'not your turn' }
      if (action.content.length > 200) return { ok: false, reason: 'speech too long' }
      return { ok: true }

    case 'day/vote':
      if (state.phase !== 'day/vote') return { ok: false, reason: 'wrong phase' }
      if (action.targetId === null) return { ok: true }
      return targetAlive(state, action.targetId)

    default:
      return { ok: false, reason: 'unknown action' }
  }
}

function targetAlive(state: WerewolfState, id: string): ValidationResult {
  const t = state.players.find(p => p.agentId === id)
  if (!t) return { ok: false, reason: 'target not in game' }
  if (!t.alive) return { ok: false, reason: 'target already dead' }
  return { ok: true }
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { validate } from '@/games/werewolf/engine/validator'
import type { WerewolfState } from '@/games/werewolf/engine/types'

function baseState(overrides: Partial<WerewolfState> = {}): WerewolfState {
  return {
    day: 0,
    phase: 'night/werewolfKill',
    players: [
      { agentId: 'w1', name: 'W1', alive: true, seatOrder: 0, deathDay: null, deathCause: null },
      { agentId: 'w2', name: 'W2', alive: true, seatOrder: 1, deathDay: null, deathCause: null },
      { agentId: 's', name: 'S', alive: true, seatOrder: 2, deathDay: null, deathCause: null },
      { agentId: 'wi', name: 'Wi', alive: true, seatOrder: 3, deathDay: null, deathCause: null },
      { agentId: 'v1', name: 'V1', alive: true, seatOrder: 4, deathDay: null, deathCause: null },
      { agentId: 'v2', name: 'V2', alive: true, seatOrder: 5, deathDay: null, deathCause: null },
    ],
    roleAssignments: { w1: 'werewolf', w2: 'werewolf', s: 'seer', wi: 'witch', v1: 'villager', v2: 'villager' },
    moderatorAgentId: 'mod',
    speechQueue: [],
    currentActor: null,
    witchPotions: { save: true, poison: true },
    lastNightKilled: null, lastNightSaved: null, lastNightPoisoned: null,
    seerCheckResults: [],
    speechLog: [], voteLog: [],
    werewolfDiscussionQueue: [],
    matchComplete: false, winner: null,
    ...overrides,
  }
}

describe('validate', () => {
  it('werewolfKill valid from werewolf to villager', () => {
    const s = baseState()
    expect(validate(s, 'w1', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' }).ok).toBe(true)
  })
  it('werewolfKill invalid from non-werewolf', () => {
    const s = baseState()
    expect(validate(s, 's', { type: 'night/werewolfKill', targetId: 'v1', reasoning: 'x' }).ok).toBe(false)
  })
  it('seerCheck cannot target self', () => {
    const s = baseState({ phase: 'night/seerCheck' })
    expect(validate(s, 's', { type: 'night/seerCheck', targetId: 's' }).ok).toBe(false)
  })
  it('witchSave forbidden first-night self-save', () => {
    const s = baseState({ phase: 'night/witchAction', lastNightKilled: 'wi' })
    expect(validate(s, 'wi', { type: 'night/witchSave' }).ok).toBe(false)
  })
  it('witchPoison null target ok (skip)', () => {
    const s = baseState({ phase: 'night/witchAction' })
    expect(validate(s, 'wi', { type: 'night/witchPoison', targetId: null }).ok).toBe(true)
  })
  it('day/speak must be current actor and ≤200 chars', () => {
    const s = baseState({ phase: 'day/speak', currentActor: 'v1' })
    expect(validate(s, 'v1', { type: 'day/speak', content: 'ok' }).ok).toBe(true)
    expect(validate(s, 'v2', { type: 'day/speak', content: 'ok' }).ok).toBe(false)
    expect(validate(s, 'v1', { type: 'day/speak', content: 'x'.repeat(201) }).ok).toBe(false)
  })
  it('day/vote allows null target', () => {
    const s = baseState({ phase: 'day/vote' })
    expect(validate(s, 'v1', { type: 'day/vote', targetId: null }).ok).toBe(true)
  })
})
```

Run: `npx vitest run tests/games/werewolf/engine/validator.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/engine/validator.ts tests/games/werewolf/engine/validator.test.ts
git commit -m "feat(p3-1): werewolf action validator"
```

---

## Task 3: 胜负判定

**Files:**
- Create: `games/werewolf/engine/win-condition.ts`
- Create: `tests/games/werewolf/engine/win-condition.test.ts`

- [ ] **Step 1: 实现**

```typescript
// games/werewolf/engine/win-condition.ts
import type { WerewolfState, WerewolfFaction } from './types'
import { factionOf } from './roles'

export interface WinResult {
  settled: boolean
  winner: WerewolfFaction | 'tie' | null
}

const MAX_DAYS_BEFORE_TIE = 40

export function checkWin(state: WerewolfState): WinResult {
  const alive = state.players.filter(p => p.alive)
  const aliveWerewolves = alive.filter(p => state.roleAssignments[p.agentId] === 'werewolf').length
  const aliveVillagers = alive.length - aliveWerewolves

  if (aliveWerewolves === 0) return { settled: true, winner: 'villagers' }
  if (aliveVillagers === 0 || aliveWerewolves >= aliveVillagers) return { settled: true, winner: 'werewolves' }
  if (state.day >= MAX_DAYS_BEFORE_TIE) return { settled: true, winner: 'tie' }
  return { settled: false, winner: null }
}

export { factionOf }
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { checkWin } from '@/games/werewolf/engine/win-condition'
import type { WerewolfState } from '@/games/werewolf/engine/types'

function mk(alive: Record<string, boolean>): WerewolfState {
  return {
    day: 1, phase: 'day/announce',
    players: Object.entries(alive).map(([id, a], i) => ({
      agentId: id, name: id, alive: a, seatOrder: i, deathDay: a ? null : 1, deathCause: a ? null : 'vote',
    })),
    roleAssignments: { w1: 'werewolf', w2: 'werewolf', s: 'seer', wi: 'witch', v1: 'villager', v2: 'villager' },
    moderatorAgentId: 'm', speechQueue: [], currentActor: null,
    witchPotions: { save: false, poison: false },
    lastNightKilled: null, lastNightSaved: null, lastNightPoisoned: null,
    seerCheckResults: [], speechLog: [], voteLog: [],
    werewolfDiscussionQueue: [],
    matchComplete: false, winner: null,
  }
}

describe('checkWin', () => {
  it('villagers win when all werewolves dead', () => {
    const s = mk({ w1: false, w2: false, s: true, wi: true, v1: true, v2: true })
    expect(checkWin(s)).toEqual({ settled: true, winner: 'villagers' })
  })
  it('werewolves win when werewolves ≥ villagers', () => {
    const s = mk({ w1: true, w2: true, s: false, wi: false, v1: true, v2: false })
    expect(checkWin(s).winner).toBe('werewolves')
  })
  it('werewolves win when all villagers dead', () => {
    const s = mk({ w1: true, w2: true, s: false, wi: false, v1: false, v2: false })
    expect(checkWin(s).winner).toBe('werewolves')
  })
  it('ongoing when 2 wolves and 3+ villagers alive', () => {
    const s = mk({ w1: true, w2: true, s: true, wi: true, v1: true, v2: false })
    expect(checkWin(s).settled).toBe(false)
  })
  it('tie at day >= 40', () => {
    const s = { ...mk({ w1: true, w2: true, s: true, wi: true, v1: true, v2: true }), day: 40 }
    expect(checkWin(s).winner).toBe('tie')
  })
})
```

Run: `npx vitest run tests/games/werewolf/engine/win-condition.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/engine/win-condition.ts tests/games/werewolf/engine/win-condition.test.ts
git commit -m "feat(p3-1): werewolf win condition"
```

---

## Task 4: 阶段机（phase-machine）

**Files:**
- Create: `games/werewolf/engine/phase-machine.ts`
- Create: `tests/games/werewolf/engine/phase-machine.test.ts`

**Context:** 纯函数 `advancePhase(state)` 负责：
- 根据当前 phase 和 state 决定 next phase
- 初始化 new phase 的 `currentActor` / `speechQueue` / `werewolfDiscussionQueue`
- night 结束时结算死亡（kill + witch save + poison）
- vote 结束时计票并执行

路径（粗粒度，不含 intra-phase 动作）：
```
night/werewolfDiscussion → night/werewolfKill → night/seerCheck → night/witchAction
→ day/announce → day/speak → day/vote → day/execute
→ (回 night/werewolfDiscussion 进入第 day+1 天)
```

- [ ] **Step 1: 骨架 + 关键分支**

```typescript
// games/werewolf/engine/phase-machine.ts
import type { WerewolfState, WerewolfPhase } from './types'
import { checkWin } from './win-condition'

export function advancePhase(state: WerewolfState): WerewolfState {
  const s: WerewolfState = structuredClone(state)

  switch (s.phase) {
    case 'night/werewolfDiscussion':
      s.phase = 'night/werewolfKill'
      s.currentActor = firstAliveWerewolf(s)
      return s

    case 'night/werewolfKill':
      s.phase = 'night/seerCheck'
      s.currentActor = aliveByRole(s, 'seer')
      return s

    case 'night/seerCheck':
      s.phase = 'night/witchAction'
      s.currentActor = aliveByRole(s, 'witch')
      return s

    case 'night/witchAction':
      settleNight(s)
      s.phase = 'day/announce'
      s.day += 1
      s.currentActor = null
      return postWinCheck(s, 'day/speak')

    case 'day/announce':
      s.phase = 'day/speak'
      s.speechQueue = s.players.filter(p => p.alive).map(p => p.agentId)
      s.currentActor = s.speechQueue.shift() ?? null
      return s

    case 'day/speak':
      if (s.speechQueue.length > 0) {
        s.currentActor = s.speechQueue.shift() ?? null
        return s
      }
      s.phase = 'day/vote'
      s.currentActor = firstAlive(s)
      return s

    case 'day/vote':
      s.phase = 'day/execute'
      s.currentActor = null
      return s

    case 'day/execute':
      settleVote(s)
      s.phase = 'night/werewolfDiscussion'
      s.werewolfDiscussionQueue = s.players.filter(p => p.alive && s.roleAssignments[p.agentId] === 'werewolf').map(p => p.agentId)
      s.currentActor = s.werewolfDiscussionQueue.shift() ?? null
      return postWinCheck(s, null)

    default:
      throw new Error(`unknown phase ${s.phase}`)
  }
}

function postWinCheck(s: WerewolfState, nextPhaseIfOngoing: WerewolfPhase | null): WerewolfState {
  const r = checkWin(s)
  if (r.settled) { s.matchComplete = true; s.winner = r.winner }
  return s
}

function settleNight(s: WerewolfState) {
  let killed = s.lastNightKilled
  if (killed && s.lastNightSaved === killed) killed = null
  const poisoned = s.lastNightPoisoned
  const deaths = [killed, poisoned].filter((x): x is string => !!x)
  for (const id of deaths) {
    const p = s.players.find(pp => pp.agentId === id)
    if (!p) continue
    p.alive = false
    p.deathDay = s.day
    p.deathCause = id === killed ? 'werewolfKill' : 'witchPoison'
  }
  s.lastNightKilled = null
  s.lastNightSaved = null
  s.lastNightPoisoned = null
}

function settleVote(s: WerewolfState) {
  const tally = new Map<string, number>()
  for (const v of s.voteLog.filter(v => v.day === s.day)) {
    if (!v.target) continue
    tally.set(v.target, (tally.get(v.target) ?? 0) + 1)
  }
  let top: string | null = null; let topN = 0; let tied = false
  for (const [k, n] of tally) {
    if (n > topN) { top = k; topN = n; tied = false }
    else if (n === topN) tied = true
  }
  if (top && !tied) {
    const p = s.players.find(pp => pp.agentId === top)
    if (p) { p.alive = false; p.deathDay = s.day; p.deathCause = 'vote' }
  }
}

function firstAlive(s: WerewolfState): string | null {
  return s.players.find(p => p.alive)?.agentId ?? null
}
function firstAliveWerewolf(s: WerewolfState): string | null {
  return s.players.find(p => p.alive && s.roleAssignments[p.agentId] === 'werewolf')?.agentId ?? null
}
function aliveByRole(s: WerewolfState, role: string): string | null {
  const p = s.players.find(p => p.alive && s.roleAssignments[p.agentId] === role)
  return p?.agentId ?? null
}
```

- [ ] **Step 2: 测试（关键路径）**

```typescript
import { describe, it, expect } from 'vitest'
import { advancePhase } from '@/games/werewolf/engine/phase-machine'
import type { WerewolfState } from '@/games/werewolf/engine/types'

function seed(): WerewolfState { /* 6-player state like validator test base */ return null as any }

describe('advancePhase', () => {
  it('night/werewolfKill → sets seer as currentActor', () => {
    const s = { ...seed(), phase: 'night/werewolfKill' } as any
    const next = advancePhase(s)
    expect(next.phase).toBe('night/seerCheck')
    expect(next.currentActor).toBe('s')
  })
  it('night/witchAction → resolves deaths, starts day', () => {
    const s = { ...seed(), phase: 'night/witchAction', lastNightKilled: 'v1' } as any
    const next = advancePhase(s)
    expect(next.phase).toBe('day/announce')
    expect(next.players.find((p: any) => p.agentId === 'v1').alive).toBe(false)
    expect(next.day).toBe(1)
  })
  it('day/execute → top vote executed + goes to next night', () => {
    const s = seed() as any
    s.phase = 'day/execute'
    s.day = 1
    s.voteLog = [
      { day: 1, voter: 'w1', target: 'v2' }, { day: 1, voter: 'w2', target: 'v2' },
      { day: 1, voter: 's', target: 'w1' }, { day: 1, voter: 'v1', target: 'v2' },
    ]
    const next = advancePhase(s)
    expect(next.players.find((p: any) => p.agentId === 'v2').alive).toBe(false)
    expect(next.phase).toBe('night/werewolfDiscussion')
  })
})
```

（`seed()` 复用 Task 2 里的 baseState helper，迁到 `tests/games/werewolf/engine/_helpers.ts`）

Run: `npx vitest run tests/games/werewolf/engine/phase-machine.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/engine/phase-machine.ts tests/games/werewolf/engine/phase-machine.test.ts tests/games/werewolf/engine/_helpers.ts
git commit -m "feat(p3-1): werewolf phase machine"
```

---

## Task 5: WerewolfEngine（实现 GameEngine 契约）

**Files:**
- Create: `games/werewolf/engine/werewolf-engine.ts`
- Create: `tests/games/werewolf/engine/werewolf-engine.test.ts`

**Context:** `GameEngine<A,S>` 定义（P1a-2）：
```typescript
interface GameEngine<A, S> {
  init(opts: InitOpts): S
  currentActor(state: S): string | null
  validActions(state: S, actorId: string): ActionSpec[]
  applyAction(state: S, actorId: string, action: A): ApplyResult<S>
  isComplete(state: S): boolean
  serializeEvent?(state: S, prev: S, action: A | null): GameEvent[]
}
```

- [ ] **Step 1: 实现**

```typescript
// games/werewolf/engine/werewolf-engine.ts
import type { WerewolfAction, WerewolfState } from './types'
import { assignRoles } from './roles'
import { validate } from './validator'
import { advancePhase } from './phase-machine'
import { checkWin } from './win-condition'

export interface InitOpts {
  agentIds: string[]
  agentNames: Record<string, string>
  moderatorAgentId: string
  rng?: () => number
}

export const werewolfEngine = {
  init(opts: InitOpts): WerewolfState {
    const roleAssignments = assignRoles(opts.agentIds, opts.rng)
    const players = opts.agentIds.map((id, i) => ({
      agentId: id, name: opts.agentNames[id] ?? id,
      alive: true, seatOrder: i, deathDay: null, deathCause: null,
    }))
    return {
      day: 0, phase: 'night/werewolfDiscussion',
      players, roleAssignments,
      moderatorAgentId: opts.moderatorAgentId,
      speechQueue: [],
      currentActor: null,
      witchPotions: { save: true, poison: true },
      lastNightKilled: null, lastNightSaved: null, lastNightPoisoned: null,
      seerCheckResults: [], speechLog: [], voteLog: [],
      werewolfDiscussionQueue: opts.agentIds.filter(id => roleAssignments[id] === 'werewolf'),
      matchComplete: false, winner: null,
    }
  },

  currentActor(state: WerewolfState): string | null {
    return state.currentActor
  },

  applyAction(state: WerewolfState, actorId: string, action: WerewolfAction) {
    const v = validate(state, actorId, action)
    if (!v.ok) return { ok: false as const, reason: v.reason }
    const s = structuredClone(state)

    switch (action.type) {
      case 'night/werewolfKill':
        s.lastNightKilled = action.targetId
        // werewolfDiscussion 先走完一轮由 GM 的 queue 推进；单个 kill action 后直接进入 advance
        return finalize(s)

      case 'night/seerCheck':
        s.seerCheckResults.push({
          day: s.day, targetId: action.targetId,
          role: s.roleAssignments[action.targetId],
        })
        return finalize(s)

      case 'night/witchSave':
        s.witchPotions.save = false
        s.lastNightSaved = s.lastNightKilled
        return finalize(s)

      case 'night/witchPoison':
        s.witchPotions.poison = false
        s.lastNightPoisoned = action.targetId
        return finalize(s)

      case 'day/speak':
        s.speechLog.push({ day: s.day, agentId: actorId, content: action.content, claimedRole: action.claimedRole, at: Date.now() })
        return finalizeSpeak(s)

      case 'day/vote':
        s.voteLog.push({ day: s.day, voter: actorId, target: action.targetId, reason: action.reason, at: Date.now() })
        return finalizeVote(s)
    }
  },

  isComplete(state: WerewolfState): boolean { return state.matchComplete },
}

function finalize(s: WerewolfState) {
  const next = advancePhase(s)
  const w = checkWin(next)
  if (w.settled) { next.matchComplete = true; next.winner = w.winner }
  return { ok: true as const, state: next }
}

function finalizeSpeak(s: WerewolfState) {
  // speak 不立刻 advance：GM 看 speechQueue 是否为空决定
  if (s.speechQueue.length === 0) {
    return finalize(s)
  } else {
    s.currentActor = s.speechQueue.shift() ?? null
    return { ok: true as const, state: s }
  }
}

function finalizeVote(s: WerewolfState) {
  const voted = new Set(s.voteLog.filter(v => v.day === s.day).map(v => v.voter))
  const pending = s.players.filter(p => p.alive && !voted.has(p.agentId))
  if (pending.length === 0) return finalize(s)
  s.currentActor = pending[0].agentId
  return { ok: true as const, state: s }
}
```

- [ ] **Step 2: 冒烟测试：跑一局到 settlement**

```typescript
import { describe, it, expect } from 'vitest'
import { werewolfEngine } from '@/games/werewolf/engine/werewolf-engine'

describe('werewolfEngine e2e smoke', () => {
  it('runs a short deterministic game to completion', () => {
    const ids = ['a','b','c','d','e','f']
    let state = werewolfEngine.init({
      agentIds: ids, agentNames: Object.fromEntries(ids.map(x => [x, x.toUpperCase()])),
      moderatorAgentId: 'mod', rng: seeded(1),
    })

    let safety = 0
    while (!werewolfEngine.isComplete(state) && safety++ < 500) {
      const actor = werewolfEngine.currentActor(state)
      if (!actor) { state = advanceOrNoop(state); continue }
      // 决定一个合法动作（固定策略：狼杀第一个非狼活人，预言家验第一个活人，女巫不用药，发言随便，投票投第一个非自己活人）
      const action = scriptedDecide(state, actor)
      const r = werewolfEngine.applyAction(state, actor, action)
      if (!r.ok) throw new Error(`apply fail: ${r.reason}`)
      state = r.state
    }
    expect(state.matchComplete).toBe(true)
    expect(['werewolves', 'villagers', 'tie']).toContain(state.winner)
  })
})

function seeded(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) % 2 ** 32; return s / 2 ** 32 }
}
function advanceOrNoop(state: any): any { return state } // 视骨架需要补
function scriptedDecide(state: any, actor: string): any {
  // 按 phase + role 产出合法动作的简化实现（略）
  throw new Error('TODO - implement scripted strategy in test')
}
```

**注意：** 此冒烟测试在本 plan 不强求全绿（`scriptedDecide` 需要补齐）；允许作为 `.skip` 或 TODO，留到 P3-2 Bot 实现后解除。但必须留一个 smoke "可初始化 + applyAction 能在 night/werewolfKill 合法通过" 的最小版本：

```typescript
it('init + applyAction werewolfKill advances phase', () => {
  const ids = ['a','b','c','d','e','f']
  let state = werewolfEngine.init({ agentIds: ids, agentNames: {}, moderatorAgentId: 'mod', rng: seeded(1) })
  // 强制进入 werewolfKill phase 并设定 currentActor 为第一个狼
  state = { ...state, phase: 'night/werewolfKill' as any }
  const wolf = state.players.find(p => state.roleAssignments[p.agentId] === 'werewolf')!
  state = { ...state, currentActor: wolf.agentId }
  const target = state.players.find(p => state.roleAssignments[p.agentId] !== 'werewolf')!
  const r = werewolfEngine.applyAction(state, wolf.agentId, { type: 'night/werewolfKill', targetId: target.agentId, reasoning: 't' })
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.state.phase).toBe('night/seerCheck')
})
```

Run: `npx vitest run tests/games/werewolf/engine/werewolf-engine.test.ts`
Expected: 最小 smoke PASS；scripted e2e 可 `.skip`。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/engine/werewolf-engine.ts tests/games/werewolf/engine/werewolf-engine.test.ts
git commit -m "feat(p3-1): WerewolfEngine implements GameEngine contract"
```

---

## Done criteria (Phase 3-1)

- [ ] 角色分配单测全绿（含确定性随机）
- [ ] Validator 覆盖 7 个关键场景
- [ ] win-condition 覆盖 5 类情形
- [ ] phase-machine 3 条关键路径测试
- [ ] WerewolfEngine 最小 smoke 测试通过
- [ ] lint / tsc 全绿
- [ ] `games/werewolf/engine/` 内部无 React 依赖

完成后进入 **Phase 3-2 · Werewolf Agent + Memory**。
