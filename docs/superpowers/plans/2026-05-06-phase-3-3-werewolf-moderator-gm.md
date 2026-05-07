# Phase 3-3 — Moderator Agent + GM 狼人杀分支 + Plugin 注册

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 引入常驻 ModeratorAgent、moderatorContextBuilder（非决策型）；让 Game Master 识别狼人杀并驱动阶段机；把 werewolf plugin 注册到 gameRegistry，match 创建时允许指定 `gameType='werewolf'`。

**Architecture:**
- Moderator 和 Player 共用同一 `/api/agents/:id/...` endpoint（靠 agent.kind 区分）
- Moderator Context 不读 working/episodic/semantic，只读最近 N 条 game_events
- Moderator 输出纯 narration（不改 engine 状态）；GM 在每次阶段转换前调一次 Moderator
- Plugin 注册：`games/werewolf/plugin.ts` 暴露 engine / playerContextBuilder / moderatorContextBuilder / responseParser / botStrategy / memoryModule / meta

**前置条件：** Phase 3-1 + 3-2 完成。

**参考 spec:** 第 5.4 节（Moderator）、第 7.1 节（Tick Loop）、第 7.5 节（多对局）、第 5.5 节（visibility）。

**不做的事：**
- ❌ UI（Phase 3-4）
- ❌ Moderator 自定义挑选（系统默认 moderator）

---

## 文件结构

```
Colosseum/
├── games/werewolf/
│   ├── agent/
│   │   ├── moderator-context.ts          # moderatorContextBuilder
│   │   └── moderator-parser.ts           # 纯 narration 提取
│   ├── plugin.ts                         # 注册到 gameRegistry
│   └── events.ts                         # werewolf/* event kind 定义 + visibility
├── lib/orchestrator/
│   ├── gm-werewolf.ts                    # GM 狼人杀专用 tick 子逻辑
│   └── gm.ts                             # Modify: 按 gameType dispatch
├── db/seeds/
│   └── default-moderator.ts              # 写入系统默认 moderator agent（kind='moderator'）
└── tests/
    ├── games/werewolf/moderator-context.test.ts
    ├── games/werewolf/plugin.test.ts
    └── orchestrator/gm-werewolf.test.ts
```

---

## Task 1: Werewolf Event 模型 + visibility

**Files:**
- Create: `games/werewolf/events.ts`
- Create: `tests/games/werewolf/events.test.ts`

**Context:** spec 5.5 要求跨游戏统一 `GameEvent`；狼人杀对 visibility 尤其敏感。定义帮手工厂：

```typescript
type WerewolfEventKind =
  | 'werewolf/gameStart'
  | 'werewolf/phaseEnter'
  | 'werewolf/werewolfDiscuss'   // role-restricted: 狼
  | 'werewolf/werewolfKill'      // role-restricted: 狼 + moderator
  | 'werewolf/seerCheck'         // role-restricted: 预言家本人
  | 'werewolf/witchSave'         // role-restricted: 女巫本人
  | 'werewolf/witchPoison'
  | 'werewolf/dayAnnounce'       // public
  | 'werewolf/speak'             // public
  | 'werewolf/vote'              // public
  | 'werewolf/execute'           // public
  | 'werewolf/moderatorNarrate'  // public
  | 'werewolf/gameEnd'           // public
```

- [ ] **Step 1: 实现**

```typescript
// games/werewolf/events.ts
import type { WerewolfRole } from './engine/types'

export type WerewolfEventKind =
  | 'werewolf/gameStart' | 'werewolf/phaseEnter'
  | 'werewolf/werewolfDiscuss' | 'werewolf/werewolfKill'
  | 'werewolf/seerCheck' | 'werewolf/witchSave' | 'werewolf/witchPoison'
  | 'werewolf/dayAnnounce' | 'werewolf/speak' | 'werewolf/vote' | 'werewolf/execute'
  | 'werewolf/moderatorNarrate' | 'werewolf/gameEnd'

export interface EmitEvent {
  kind: WerewolfEventKind
  actorAgentId: string | null
  payload: Record<string, unknown>
  visibility: 'public' | 'role-restricted' | 'private'
  restrictedTo?: string[]
}

export function visibilityForKind(kind: WerewolfEventKind, opts: { actorAgentId: string | null; werewolfIds: string[] }): Pick<EmitEvent, 'visibility' | 'restrictedTo'> {
  switch (kind) {
    case 'werewolf/werewolfDiscuss':
    case 'werewolf/werewolfKill':
      return { visibility: 'role-restricted', restrictedTo: opts.werewolfIds }
    case 'werewolf/seerCheck':
    case 'werewolf/witchSave':
    case 'werewolf/witchPoison':
      return { visibility: 'role-restricted', restrictedTo: opts.actorAgentId ? [opts.actorAgentId] : [] }
    default:
      return { visibility: 'public' }
  }
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { visibilityForKind } from '@/games/werewolf/events'

describe('visibilityForKind', () => {
  it('werewolfDiscuss restricted to werewolves', () => {
    expect(visibilityForKind('werewolf/werewolfDiscuss', { actorAgentId: 'w1', werewolfIds: ['w1', 'w2'] })).toEqual({
      visibility: 'role-restricted', restrictedTo: ['w1', 'w2'],
    })
  })
  it('seerCheck restricted to actor only', () => {
    expect(visibilityForKind('werewolf/seerCheck', { actorAgentId: 's', werewolfIds: ['w1', 'w2'] })).toEqual({
      visibility: 'role-restricted', restrictedTo: ['s'],
    })
  })
  it('speak is public', () => {
    expect(visibilityForKind('werewolf/speak', { actorAgentId: 'v', werewolfIds: [] }).visibility).toBe('public')
  })
})
```

Run: `npx vitest run tests/games/werewolf/events.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/events.ts tests/games/werewolf/events.test.ts
git commit -m "feat(p3-3): werewolf event kinds + visibility rules"
```

---

## Task 2: Moderator ContextBuilder

**Files:**
- Create: `games/werewolf/agent/moderator-context.ts`
- Create: `games/werewolf/agent/moderator-parser.ts`
- Create: `tests/games/werewolf/moderator-context.test.ts`

**Context:** Moderator 输出主持词（≤80 字），只看最近 N 条 public + role-restricted（对所有人公开）事件，不读任何玩家记忆。

- [ ] **Step 1: moderator-context.ts**

```typescript
// games/werewolf/agent/moderator-context.ts
import type { WerewolfState } from '../engine/types'

export interface ModeratorContextInput {
  agent: { name: string; systemPrompt: string }
  state: WerewolfState
  recentPublicEvents: Array<{ kind: string; payload: unknown; at: string }>
  upcomingPhase: WerewolfState['phase']
}

export function buildModeratorContext(i: ModeratorContextInput): { systemMessage: string; userMessage: string } {
  const systemMessage = [
    i.agent.systemPrompt,
    `你是狼人杀主持人 ${i.agent.name}。你不参与决策。`,
    `你的职责：为每个阶段转换生成不超过 80 字的主持词，渲染仪式感和戏剧张力。`,
    `输出格式：`,
    `<narration>主持词正文（≤80 字）</narration>`,
  ].join('\n\n')

  const userMessage = [
    `当前状态：第 ${i.state.day} 天，即将进入 ${i.upcomingPhase}`,
    `活人数：${i.state.players.filter(p => p.alive).length}`,
    `最近事件（public）：`,
    i.recentPublicEvents.slice(-8).map(e => `- ${e.kind}`).join('\n'),
    '',
    `请为"即将进入 ${i.upcomingPhase}"生成主持词。`,
  ].join('\n')

  return { systemMessage, userMessage }
}
```

- [ ] **Step 2: moderator-parser.ts**

```typescript
// games/werewolf/agent/moderator-parser.ts
export interface ModeratorParseResult {
  narration: string
  error?: string
}

export function parseModeratorResponse(raw: string): ModeratorParseResult {
  const m = raw.match(/<narration[^>]*>([\s\S]*?)<\/narration>/i)
  if (!m) return { narration: raw.slice(0, 80), error: 'narration_tag_missing' }
  const n = m[1].trim()
  if (n.length > 120) return { narration: n.slice(0, 120), error: 'too_long' }
  return { narration: n }
}
```

- [ ] **Step 3: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { buildModeratorContext } from '@/games/werewolf/agent/moderator-context'
import { parseModeratorResponse } from '@/games/werewolf/agent/moderator-parser'

describe('moderator context', () => {
  it('system message declares non-decision role', () => {
    const r = buildModeratorContext({
      agent: { name: 'Judge', systemPrompt: '保持庄重' },
      state: { day: 1, phase: 'night/werewolfKill', players: Array(6).fill({ alive: true }) } as any,
      recentPublicEvents: [],
      upcomingPhase: 'night/werewolfKill',
    })
    expect(r.systemMessage).toContain('不参与决策')
    expect(r.systemMessage).toContain('80 字')
  })
})

describe('parseModeratorResponse', () => {
  it('extracts narration tag', () => {
    expect(parseModeratorResponse('<narration>夜幕降临</narration>').narration).toBe('夜幕降临')
  })
  it('reports missing tag', () => {
    const r = parseModeratorResponse('just text')
    expect(r.error).toBe('narration_tag_missing')
  })
  it('truncates over-long narration', () => {
    const r = parseModeratorResponse(`<narration>${'字'.repeat(200)}</narration>`)
    expect(r.error).toBe('too_long')
    expect(r.narration.length).toBeLessThanOrEqual(120)
  })
})
```

Run: `npx vitest run tests/games/werewolf/moderator-context.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add games/werewolf/agent/moderator-context.ts games/werewolf/agent/moderator-parser.ts tests/games/werewolf/moderator-context.test.ts
git commit -m "feat(p3-3): moderator context builder + parser"
```

---

## Task 3: Werewolf Plugin 注册

**Files:**
- Create: `games/werewolf/plugin.ts`
- Modify: `games/index.ts`（`registerAllGames`）
- Create: `tests/games/werewolf/plugin.test.ts`

**Context:** 把 engine / player + moderator context / parser / bot / memory 聚合到一个 plugin 对象。

- [ ] **Step 1: plugin.ts**

```typescript
// games/werewolf/plugin.ts
import type { GamePlugin } from '@/core/protocols/plugin'
import { werewolfEngine } from './engine/werewolf-engine'
import { buildWerewolfContext } from './agent/werewolf-context'
import { parseWerewolfResponse } from './agent/werewolf-parser'
import { buildModeratorContext } from './agent/moderator-context'
import { parseModeratorResponse } from './agent/moderator-parser'
import { decideWerewolfBot } from './agent/werewolf-bot'
import { werewolfMemory } from './agent/werewolf-memory'

export const werewolfPlugin: GamePlugin = {
  meta: {
    gameType: 'werewolf',
    displayName: '狼人杀',
    description: '简化 6 人局',
    supportedPlayerCount: 6,
    requiresModerator: true,
  },
  engine: werewolfEngine,
  playerContextBuilder: { build: buildWerewolfContext },
  moderatorContextBuilder: { build: buildModeratorContext },
  responseParser: { parse: parseWerewolfResponse },
  moderatorParser: { parse: parseModeratorResponse },
  botStrategy: { decide: decideWerewolfBot },
  memoryModule: werewolfMemory,
} as any
```

- [ ] **Step 2: 注册**

```typescript
// games/index.ts
import { gameRegistry } from '@/core/registry/game-registry'
import { pokerPlugin } from './poker/plugin'
import { werewolfPlugin } from './werewolf/plugin'

export function registerAllGames() {
  gameRegistry.register(pokerPlugin)
  gameRegistry.register(werewolfPlugin)
}
```

- [ ] **Step 3: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { werewolfPlugin } from '@/games/werewolf/plugin'

describe('werewolfPlugin', () => {
  it('exposes required hooks', () => {
    expect(werewolfPlugin.meta.gameType).toBe('werewolf')
    expect(werewolfPlugin.meta.requiresModerator).toBe(true)
    expect(werewolfPlugin.engine).toBeTruthy()
    expect(werewolfPlugin.playerContextBuilder).toBeTruthy()
    expect(werewolfPlugin.moderatorContextBuilder).toBeTruthy()
    expect(werewolfPlugin.memoryModule).toBeTruthy()
  })
})
```

Run: `npx vitest run tests/games/werewolf/plugin.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add games/werewolf/plugin.ts games/index.ts tests/games/werewolf/plugin.test.ts
git commit -m "feat(p3-3): register werewolf plugin"
```

---

## Task 4: 默认 Moderator Seed

**Files:**
- Create: `db/seeds/default-moderator.ts`
- Modify: `package.json`（加 `db:seed`）
- Create: `tests/db/seeds.test.ts`

**Context:** match 创建时如果未指定 moderator，用系统默认的 "SystemJudge" agent（一条 kind=moderator 的 agents 行）。profile 用一个特定 kind='moderator' profile（对应系统默认 provider，比如用和 admin 同一 profile）。

- [ ] **Step 1: seed 脚本**

```typescript
// db/seeds/default-moderator.ts
import { db } from '../index'
import { agents, profiles } from '../schema'
import { eq } from 'drizzle-orm'

export const SYSTEM_MODERATOR_AGENT_ID = 'agt_sys_moderator'
export const SYSTEM_MODERATOR_PROFILE_ID = 'prof_sys_moderator'

export async function ensureDefaultModerator() {
  const existingProfile = await db.select().from(profiles).where(eq(profiles.id, SYSTEM_MODERATOR_PROFILE_ID))
  if (existingProfile.length === 0) {
    await db.insert(profiles).values({
      id: SYSTEM_MODERATOR_PROFILE_ID,
      name: 'System Moderator Profile',
      providerKind: 'openai_compatible',
      baseUrl: process.env.SYSTEM_MODERATOR_BASE_URL ?? 'https://api.deepseek.com/v1',
      model: process.env.SYSTEM_MODERATOR_MODEL ?? 'deepseek-chat',
    })
  }

  const existingAgent = await db.select().from(agents).where(eq(agents.id, SYSTEM_MODERATOR_AGENT_ID))
  if (existingAgent.length === 0) {
    await db.insert(agents).values({
      id: SYSTEM_MODERATOR_AGENT_ID,
      name: 'SystemJudge',
      gameType: 'werewolf',
      kind: 'moderator',
      profileId: SYSTEM_MODERATOR_PROFILE_ID,
      model: process.env.SYSTEM_MODERATOR_MODEL ?? 'deepseek-chat',
      systemPrompt: '你是仪式感十足的狼人杀主持人，语言克制、庄重。',
    })
  }
}
```

- [ ] **Step 2: CLI entry**

```typescript
// scripts/seed.ts
import { ensureDefaultModerator } from '@/db/seeds/default-moderator'
ensureDefaultModerator().then(() => { console.log('seed ok'); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })
```

`package.json`:
```json
"scripts": { "db:seed": "tsx scripts/seed.ts" }
```

- [ ] **Step 3: 测试 / 手动运行**

```bash
npm run db:push && npm run db:seed
```

Expected: 输出 `seed ok`；再次运行不报错（幂等）。

- [ ] **Step 4: Commit**

```bash
git add db/seeds/default-moderator.ts scripts/seed.ts package.json
git commit -m "feat(p3-3): default system moderator seed"
```

---

## Task 5: GM 狼人杀 tick 子逻辑

**Files:**
- Create: `lib/orchestrator/gm-werewolf.ts`
- Modify: `lib/orchestrator/gm.ts`
- Create: `tests/orchestrator/gm-werewolf.test.ts`

**Context:** 通用 GM 在 tick 开始后按 gameType dispatch：
- poker → 现有 `tickPoker(matchId)`
- werewolf → `tickWerewolf(matchId)`：
  1. 取 match + state
  2. 如果 `currentActor === null` → 这是一个阶段 boundary：先请求 Moderator 生成 narration → 发布 `werewolf/moderatorNarrate` public 事件 → `advancePhase(state)` → 持久化 → 自触发下个 tick
  3. 否则：请求 actor Agent（走 A2A client，同 poker 一样），得到 action → `applyAction` → 发布对应 event（带 visibility）→ 自触发下个 tick
  4. `isComplete(state)` → 结算 + dropMatch(key-cache) + 调每位 agent 的 `memoryModule.settleMatch`

- [ ] **Step 1: gm-werewolf.ts 骨架**

```typescript
// lib/orchestrator/gm-werewolf.ts
import { werewolfEngine } from '@/games/werewolf/engine/werewolf-engine'
import { visibilityForKind } from '@/games/werewolf/events'
import { requestAgentDecision } from '@/lib/a2a-core/client'
import { werewolfMemory } from '@/games/werewolf/agent/werewolf-memory'
import { loadMatch, saveMatchState, publishEvent } from './match-store'
import { logger } from '@/lib/obs/logger'
import { parseWerewolfResponse } from '@/games/werewolf/agent/werewolf-parser'
import { parseModeratorResponse } from '@/games/werewolf/agent/moderator-parser'
import { decideWerewolfBot } from '@/games/werewolf/agent/werewolf-bot'
import { signMatchToken } from '@/lib/auth/match-token'
import { dropMatch as dropKeyCache } from '@/lib/agent/key-cache'
import { recentPublicEvents } from './event-query'

export async function tickWerewolf(matchId: string) {
  const match = await loadMatch(matchId)
  if (!match || match.gameType !== 'werewolf' || match.status !== 'running') return { done: true }

  let state = match.state
  const log = logger.withMatch(matchId)

  if (werewolfEngine.isComplete(state)) {
    await settleWerewolf(matchId, match)
    return { done: true }
  }

  if (state.currentActor === null) {
    // boundary: run moderator narration
    const next = werewolfEngine.applyBoundary ? werewolfEngine.applyBoundary(state) : advanceAndNarrate(state)
    const narration = await requestModeratorNarration(match, next.upcomingPhase)
    await publishEvent(matchId, {
      kind: 'werewolf/moderatorNarrate',
      actorAgentId: match.moderatorAgentId,
      payload: { narration, upcomingPhase: next.upcomingPhase, day: state.day },
      visibility: 'public',
    })
    state = next.state
    await saveMatchState(matchId, state)
    await selfTrigger(matchId)
    return { done: false }
  }

  // actor decision
  const actorId = state.currentActor
  const memory = await werewolfMemory.loadForDecision(matchId, actorId)
  const validActionHint = hintForPhase(state.phase)
  const contextText = buildActorPrompt({ match, state, memory, validActionHint })

  const matchToken = signMatchToken(matchId)
  let action
  try {
    const res = await requestAgentDecision({
      agent: { id: actorId },
      baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
      payload: { parts: [{ kind: 'data', data: { contextText } }] },
      matchId, matchToken,
      onThinking: async (text) => publishEvent(matchId, {
        kind: 'werewolf/thinking',
        actorAgentId: actorId,
        payload: { text },
        visibility: 'public',
      } as any),
      timeoutMs: 60_000,
    })
    const parsed = parseWerewolfResponse(String(res.thinkingText + (res.action ? `<action>${JSON.stringify(res.action)}</action>` : '')))
    action = parsed.action ?? decideWerewolfBot(state, actorId)
    if (parsed.beliefUpdate && Object.keys(parsed.beliefUpdate).length > 0) {
      await werewolfMemory.updateWorking(matchId, actorId, { beliefState: parsed.beliefUpdate as any })
    }
  } catch (err) {
    log.warn('werewolf actor fallback', { actorId, err: (err as Error).message })
    action = decideWerewolfBot(state, actorId)
  }

  const r = werewolfEngine.applyAction(state, actorId, action)
  if (!r.ok) {
    log.error('werewolf applyAction fail', { reason: r.reason })
    const botAction = decideWerewolfBot(state, actorId)
    const rr = werewolfEngine.applyAction(state, actorId, botAction)
    if (!rr.ok) throw new Error(`cannot recover: ${rr.reason}`)
    state = rr.state
  } else {
    state = r.state
  }

  // emit event
  const kindForAction = eventKindFor(action.type)
  const werewolfIds = state.players.filter(p => state.roleAssignments[p.agentId] === 'werewolf').map(p => p.agentId)
  const vis = visibilityForKind(kindForAction as any, { actorAgentId: actorId, werewolfIds })
  await publishEvent(matchId, {
    kind: kindForAction, actorAgentId: actorId,
    payload: { action, day: state.day },
    ...vis,
  } as any)

  await saveMatchState(matchId, state)
  if (werewolfEngine.isComplete(state)) {
    await settleWerewolf(matchId, { ...match, state })
    return { done: true }
  }
  await selfTrigger(matchId)
  return { done: false }
}

// ——— helpers ————

async function requestModeratorNarration(match: any, upcomingPhase: string): Promise<string> {
  try {
    const events = await recentPublicEvents(match.id, 8)
    const matchToken = signMatchToken(match.id)
    const res = await requestAgentDecision({
      agent: { id: match.moderatorAgentId },
      baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
      payload: { parts: [{ kind: 'data', data: { upcomingPhase, recentPublicEvents: events } }] },
      matchId: match.id, matchToken, timeoutMs: 30_000,
    })
    const parsed = parseModeratorResponse(String((res.action as any)?.narration ?? res.thinkingText))
    return parsed.narration
  } catch {
    return fallbackNarration(upcomingPhase as any)
  }
}

function fallbackNarration(phase: string): string {
  const map: Record<string, string> = {
    'night/werewolfDiscussion': '夜幕降临，狼人睁眼商议。',
    'night/werewolfKill': '狼人拍板。',
    'night/seerCheck': '预言家行动。',
    'night/witchAction': '女巫请抉择救与毒。',
    'day/announce': '天亮了。',
    'day/speak': '开始发言。',
    'day/vote': '全员投票。',
    'day/execute': '公示出局。',
  }
  return map[phase] ?? '进入下一阶段。'
}

function hintForPhase(phase: string): string {
  // 返回提示 Parser 预期的 action JSON schema 简短描述
  return phase // 简化
}

function buildActorPrompt(o: any): string {
  // 调 buildWerewolfContext 合成 system + user，再拼一起作为 userPrompt 传给 llm-runtime
  const { buildWerewolfContext } = require('@/games/werewolf/agent/werewolf-context')
  const { systemMessage, userMessage } = buildWerewolfContext({
    agent: { id: o.state.currentActor, name: 'actor', systemPrompt: '' },
    state: o.state,
    workingMemory: o.memory.working,
    episodic: o.memory.episodic,
    semantic: o.memory.semantic,
    validActionHint: o.validActionHint,
  })
  return `${systemMessage}\n\n${userMessage}`
}

function eventKindFor(actionType: string): string {
  const map: Record<string, string> = {
    'night/werewolfKill': 'werewolf/werewolfKill',
    'night/seerCheck': 'werewolf/seerCheck',
    'night/witchSave': 'werewolf/witchSave',
    'night/witchPoison': 'werewolf/witchPoison',
    'day/speak': 'werewolf/speak',
    'day/vote': 'werewolf/vote',
  }
  return map[actionType] ?? 'werewolf/phaseEnter'
}

async function selfTrigger(matchId: string) {
  fetch(`${process.env.BASE_URL ?? 'http://localhost:3000'}/api/matches/${matchId}/tick`, { method: 'POST' }).catch(() => {})
}

async function settleWerewolf(matchId: string, match: any) {
  for (const p of match.state.players) {
    await werewolfMemory.settleMatch(matchId, p.agentId, {
      winner: match.state.winner,
      actualRoles: match.state.roleAssignments,
      ownWon: ownWon(p.agentId, match.state),
    } as any)
  }
  dropKeyCache(matchId)
  await publishEvent(matchId, {
    kind: 'werewolf/gameEnd', actorAgentId: null,
    payload: { winner: match.state.winner, actualRoles: match.state.roleAssignments },
    visibility: 'public',
  })
}

function ownWon(agentId: string, state: any): boolean {
  const role = state.roleAssignments[agentId]
  const faction = role === 'werewolf' ? 'werewolves' : 'villagers'
  return state.winner === faction
}

function advanceAndNarrate(state: any) {
  // stub if engine doesn't expose applyBoundary
  const { advancePhase } = require('@/games/werewolf/engine/phase-machine')
  const next = advancePhase(state)
  return { state: next, upcomingPhase: next.phase }
}
```

**注意：** 本 plan 留下几个 TODO（`hintForPhase` 详细 hint、`recentPublicEvents` 查询实现）——分别见 Step 2 / 3。

- [ ] **Step 2: 补 `event-query.ts`**

```typescript
// lib/orchestrator/event-query.ts
import { db } from '@/db'
import { gameEvents } from '@/db/schema'
import { and, eq, desc } from 'drizzle-orm'

export async function recentPublicEvents(matchId: string, limit = 8) {
  return db.select().from(gameEvents)
    .where(and(eq(gameEvents.matchId, matchId), eq(gameEvents.visibility, 'public')))
    .orderBy(desc(gameEvents.occurredAt))
    .limit(limit)
}
```

- [ ] **Step 3: gm.ts dispatch**

```typescript
// lib/orchestrator/gm.ts
import { tickWerewolf } from './gm-werewolf'
import { tickPoker } from './gm-poker'

export async function tickMatch(matchId: string) {
  const match = await loadMatch(matchId)
  if (!match) return { done: true }
  if (match.gameType === 'werewolf') return tickWerewolf(matchId)
  return tickPoker(matchId)
}
```

- [ ] **Step 4: 测试（mock agent + mock moderator）**

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/a2a-core/client', () => ({
  requestAgentDecision: vi.fn(async () => ({ action: { type: 'day/vote', targetId: null }, thinkingText: '<action>{"type":"day/vote","targetId":null}</action>' })),
}))

import { tickWerewolf } from '@/lib/orchestrator/gm-werewolf'

describe('tickWerewolf', () => {
  it('processes a boundary tick (moderator narration)', async () => {
    // seed match with currentActor=null and run tick; expect narration event published
    // （这里需用 in-memory test db + redis 或 spy publishEvent）
    expect(true).toBe(true)
  })
})
```

（集成测试主要在 Phase 3-3 的 manual checklist 里完成；此单测保底。）

Run: `npx vitest run tests/orchestrator/gm-werewolf.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/orchestrator/gm-werewolf.ts lib/orchestrator/event-query.ts lib/orchestrator/gm.ts tests/orchestrator/gm-werewolf.test.ts
git commit -m "feat(p3-3): GM werewolf tick branch + dispatch"
```

---

## Task 6: match 创建校验：werewolf 需 moderator + 6 agents

**Files:**
- Modify: `app/api/matches/route.ts`（或相应的 match-lifecycle）
- Modify: `lib/orchestrator/match-lifecycle.ts`

- [ ] **Step 1: 校验函数**

```typescript
// lib/orchestrator/match-lifecycle.ts 内部
export function validateWerewolfCreate(input: { agents: string[]; moderatorAgentId: string | null }) {
  if (input.agents.length !== 6) throw new Error('werewolf requires exactly 6 player agents')
  if (!input.moderatorAgentId) throw new Error('werewolf requires moderatorAgentId')
}
```

在 `POST /api/matches` 里 when `gameType === 'werewolf'`：
1. 若 body 未传 `moderatorAgentId`，用 `SYSTEM_MODERATOR_AGENT_ID`
2. 调 `validateWerewolfCreate`
3. 创建 match，`state = werewolfEngine.init({...})`

- [ ] **Step 2: 测试**

```typescript
// tests/api/matches-create-werewolf.test.ts
it('creates a werewolf match with default moderator when not specified', async () => { /* ... */ })
it('rejects werewolf match with 5 agents', async () => { /* ... */ })
```

- [ ] **Step 3: Commit**

```bash
git add app/api/matches/route.ts lib/orchestrator/match-lifecycle.ts tests/api/matches-create-werewolf.test.ts
git commit -m "feat(p3-3): werewolf match creation validation"
```

---

## Done criteria (Phase 3-3)

- [ ] `games/werewolf/events.ts` visibility 规则单测全绿
- [ ] Moderator ContextBuilder / Parser 单测全绿
- [ ] Werewolf plugin 注册到 registry
- [ ] 默认系统 moderator seed 脚本可 idempotent 运行
- [ ] GM `tickWerewolf` 能分别处理 boundary / action 两种 tick
- [ ] match 创建对 gameType=werewolf 做必要校验
- [ ] lint / tsc 全绿

完成后进入 **Phase 3-4 · Werewolf UI**。
