# Phase 3-2 — 狼人杀 Agent + 三层记忆（beliefState 外化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现狼人杀的 Player Agent 四契约（ContextBuilder / ResponseParser / BotStrategy / Memory）。核心差异化：beliefState 外化——LLM 输出必须含更新后的信念分布。

**Architecture:**
- `games/werewolf/agent/`：context / parser / bot / memory
- `memoryContext` 针对 role 定制（狼知道同伴，seer 有验人结果，witch 知道药）
- `beliefState`：存在 working memory；ResponseParser 从 LLM `<belief>{...}</belief>` 区块提取
- 记忆读写接口对齐 P1a-5 的 `MemoryModule<WorkingMemory, EpisodicEntry, SemanticProfile>`

**前置条件：** Phase 3-1 完成（引擎可用）。

**参考 spec:** 第 5.3 节 + 第 6.4 节（Werewolf 记忆三层）+ 第 6.5 节（全量注入）。

**不做的事：**
- ❌ Moderator ContextBuilder（Phase 3-3）
- ❌ UI（Phase 3-4）

---

## 文件结构

```
Colosseum/
├── games/werewolf/agent/
│   ├── werewolf-context.ts         # playerContextBuilder
│   ├── werewolf-parser.ts          # 提取 action + beliefState
│   ├── werewolf-bot.ts             # fallback 策略
│   ├── werewolf-memory.ts          # Memory 实现
│   └── types.ts                    # WerewolfWorkingMemory / EpisodicEntry / SemanticProfile
└── tests/games/werewolf/agent/
    ├── werewolf-context.test.ts
    ├── werewolf-parser.test.ts
    ├── werewolf-bot.test.ts
    └── werewolf-memory.test.ts
```

---

## Task 1: 记忆类型 + 骨架

**Files:**
- Create: `games/werewolf/agent/types.ts`

- [ ] **Step 1: 类型（严格对齐 spec 6.4）**

```typescript
// games/werewolf/agent/types.ts
import type { WerewolfRole, SpeechRecord, VoteRecord, SeerResult } from '../engine/types'

export interface BeliefEntry {
  werewolf: number
  villager: number
  seer: number
  witch: number
  reasoning: string[]               // 最近 3 条
  lastUpdatedAt: { day: number; phase: string }
}

export interface DeathRecord {
  day: number
  agentId: string
  cause: 'werewolfKill' | 'witchPoison' | 'vote'
}

export interface WerewolfWorkingMemory {
  ownRole: WerewolfRole
  ownPrivateEvidence: {
    seerChecks?: SeerResult[]
    werewolfTeammates?: string[]
    witchPotions?: { save: boolean; poison: boolean }
  }
  speechLog: SpeechRecord[]
  voteLog: VoteRecord[]
  deathLog: DeathRecord[]
  beliefState: Record<string, BeliefEntry>
}

export interface WerewolfEpisodicEntry {
  gameId: string
  observer: string
  actualRoles: Record<string, WerewolfRole>
  winnerFaction: 'werewolves' | 'villagers' | 'tie'
  ownOutcome: 'won' | 'lost' | 'tie'
  beliefAccuracy: Record<string, {
    finalBelief: Record<WerewolfRole, number>
    actualRole: WerewolfRole
    mostLikely: WerewolfRole
    correct: boolean
    confidenceCalibration: number
  }>
  keyMoments: string[]
  summary: string
  tags: string[]
}

export interface WerewolfSemanticProfile {
  actingSkill: number
  reasoningDepth: number
  consistency: number
  asWerewolfStyle: { bluffTendency: number; patience: number; targetingPattern: string } | null
  asSeerStyle: { jumpTiming: 'early' | 'mid' | 'late' | 'varies'; informationReveal: number } | null
  asWitchStyle: { saveTendency: number; poisonTiming: 'early' | 'mid' | 'late' | 'varies' } | null
  asVillagerStyle: { suspicionBias: number; followVoting: number } | null
  note: string
  gamesObserved: number
  winLossRecord: {
    asWerewolf: [number, number]
    asSeer: [number, number]
    asVillager: [number, number]
    asWitch: [number, number]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add games/werewolf/agent/types.ts
git commit -m "feat(p3-2): werewolf memory types"
```

---

## Task 2: Bot 策略（fallback）

**Files:**
- Create: `games/werewolf/agent/werewolf-bot.ts`
- Create: `tests/games/werewolf/agent/werewolf-bot.test.ts`

**Context:** LLM 失败时快速产出合法动作。策略：
- 狼杀：随机选一个非狼活人
- 预言家验人：随机选一个未验过的活人
- 女巫：**不救不毒**
- 白天发言：固定模板 "我是 {claimedRole}，还在观察。"
- 投票：随机投一个非自己的活人（30% 弃权）

- [ ] **Step 1: 实现**

```typescript
// games/werewolf/agent/werewolf-bot.ts
import type { WerewolfAction, WerewolfState, WerewolfRole } from '../engine/types'

export function decideWerewolfBot(
  state: WerewolfState,
  actorId: string,
  rng: () => number = Math.random,
): WerewolfAction {
  const role = state.roleAssignments[actorId]
  const alive = state.players.filter(p => p.alive)
  const notSelf = alive.filter(p => p.agentId !== actorId)

  switch (state.phase) {
    case 'night/werewolfKill': {
      const nonWolves = alive.filter(p => state.roleAssignments[p.agentId] !== 'werewolf')
      const target = pick(nonWolves, rng)?.agentId ?? alive[0].agentId
      return { type: 'night/werewolfKill', targetId: target, reasoning: 'bot fallback' }
    }
    case 'night/seerCheck': {
      const notChecked = notSelf.filter(p => !state.seerCheckResults.some(r => r.targetId === p.agentId))
      const target = pick(notChecked, rng)?.agentId ?? notSelf[0].agentId
      return { type: 'night/seerCheck', targetId: target }
    }
    case 'night/witchAction':
      return { type: 'night/witchPoison', targetId: null }
    case 'day/speak':
      return { type: 'day/speak', content: '我继续观察，暂不跳身份。', claimedRole: undefined }
    case 'day/vote': {
      if (rng() < 0.3) return { type: 'day/vote', targetId: null }
      const target = pick(notSelf, rng)?.agentId ?? null
      return { type: 'day/vote', targetId: target }
    }
    default:
      throw new Error(`bot: unsupported phase ${state.phase}`)
  }
}

function pick<T>(arr: T[], rng: () => number): T | undefined {
  if (arr.length === 0) return undefined
  return arr[Math.floor(rng() * arr.length)]
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { decideWerewolfBot } from '@/games/werewolf/agent/werewolf-bot'

const base = (phase: any, overrides: any = {}) => ({
  phase,
  day: 1,
  players: [
    { agentId: 'w1', name: 'W1', alive: true }, { agentId: 'w2', name: 'W2', alive: true },
    { agentId: 's', name: 'S', alive: true }, { agentId: 'wi', name: 'Wi', alive: true },
    { agentId: 'v1', name: 'V1', alive: true }, { agentId: 'v2', name: 'V2', alive: true },
  ],
  roleAssignments: { w1: 'werewolf', w2: 'werewolf', s: 'seer', wi: 'witch', v1: 'villager', v2: 'villager' },
  seerCheckResults: [],
  ...overrides,
})

describe('decideWerewolfBot', () => {
  it('werewolfKill picks a non-werewolf', () => {
    const a: any = decideWerewolfBot(base('night/werewolfKill') as any, 'w1')
    expect(['s', 'wi', 'v1', 'v2']).toContain(a.targetId)
  })
  it('seerCheck avoids self', () => {
    const a: any = decideWerewolfBot(base('night/seerCheck') as any, 's')
    expect(a.targetId).not.toBe('s')
  })
  it('witchAction → poison null (skip)', () => {
    const a: any = decideWerewolfBot(base('night/witchAction') as any, 'wi')
    expect(a).toEqual({ type: 'night/witchPoison', targetId: null })
  })
  it('day/vote returns valid target or null', () => {
    const a: any = decideWerewolfBot(base('day/vote') as any, 'v1')
    expect(a.type).toBe('day/vote')
  })
})
```

Run: `npx vitest run tests/games/werewolf/agent/werewolf-bot.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/agent/werewolf-bot.ts tests/games/werewolf/agent/werewolf-bot.test.ts
git commit -m "feat(p3-2): werewolf bot fallback strategy"
```

---

## Task 3: ResponseParser（提取 action + beliefState）

**Files:**
- Create: `games/werewolf/agent/werewolf-parser.ts`
- Create: `tests/games/werewolf/agent/werewolf-parser.test.ts`

**Context:** LLM 输出协议：

```
<thinking>推理</thinking>
<belief>{ "a": { "werewolf": 0.7, "villager": 0.2, ... } }</belief>
<action>{ "type": "day/vote", "targetId": "a" }</action>
```

parser 产出：
```typescript
{
  action: WerewolfAction,
  thinkingText: string,
  beliefUpdate: Record<string, Partial<BeliefEntry>>   // key=agentId
}
```

- [ ] **Step 1: 实现**

```typescript
// games/werewolf/agent/werewolf-parser.ts
import type { WerewolfAction } from '../engine/types'
import type { BeliefEntry } from './types'

export interface WerewolfParseResult {
  action: WerewolfAction | null
  thinkingText: string
  beliefUpdate: Record<string, Partial<BeliefEntry>>
  errors: string[]
}

export function parseWerewolfResponse(raw: string): WerewolfParseResult {
  const errors: string[] = []
  const thinkingText = extract(raw, 'thinking') ?? ''
  const beliefJson = extract(raw, 'belief')
  const actionJson = extract(raw, 'action')

  let beliefUpdate: Record<string, Partial<BeliefEntry>> = {}
  if (beliefJson) {
    try { beliefUpdate = JSON.parse(beliefJson) } catch { errors.push('belief_parse_fail') }
  }

  let action: WerewolfAction | null = null
  if (actionJson) {
    try { action = JSON.parse(actionJson) as WerewolfAction }
    catch { errors.push('action_parse_fail') }
  } else {
    errors.push('action_missing')
  }

  return { action, thinkingText, beliefUpdate, errors }
}

function extract(raw: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = raw.match(re)
  return m ? m[1].trim() : null
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { parseWerewolfResponse } from '@/games/werewolf/agent/werewolf-parser'

describe('parseWerewolfResponse', () => {
  it('parses all three sections', () => {
    const raw = `<thinking>t</thinking><belief>{"a":{"werewolf":0.7,"villager":0.2,"seer":0,"witch":0.1}}</belief><action>{"type":"day/vote","targetId":"a"}</action>`
    const r = parseWerewolfResponse(raw)
    expect(r.thinkingText).toBe('t')
    expect(r.beliefUpdate.a?.werewolf).toBe(0.7)
    expect(r.action).toEqual({ type: 'day/vote', targetId: 'a' })
    expect(r.errors).toHaveLength(0)
  })
  it('reports action_missing', () => {
    const r = parseWerewolfResponse('<thinking>x</thinking>')
    expect(r.errors).toContain('action_missing')
  })
  it('reports belief_parse_fail but still returns action', () => {
    const raw = `<belief>{bad</belief><action>{"type":"day/vote","targetId":null}</action>`
    const r = parseWerewolfResponse(raw)
    expect(r.errors).toContain('belief_parse_fail')
    expect(r.action).toBeTruthy()
  })
})
```

Run: `npx vitest run tests/games/werewolf/agent/werewolf-parser.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/agent/werewolf-parser.ts tests/games/werewolf/agent/werewolf-parser.test.ts
git commit -m "feat(p3-2): werewolf response parser with belief extraction"
```

---

## Task 4: ContextBuilder（按角色差异化）

**Files:**
- Create: `games/werewolf/agent/werewolf-context.ts`
- Create: `tests/games/werewolf/agent/werewolf-context.test.ts`

**Context:** 输出中文 system+user。system 中强制指定输出格式 + 角色专属私密信息 + 当前信念分布。

- [ ] **Step 1: 实现**

```typescript
// games/werewolf/agent/werewolf-context.ts
import type { WerewolfState, WerewolfRole } from '../engine/types'
import type { WerewolfWorkingMemory, WerewolfEpisodicEntry, WerewolfSemanticProfile } from './types'

export interface WerewolfContextInput {
  agent: { id: string; name: string; systemPrompt: string }
  state: WerewolfState
  workingMemory: WerewolfWorkingMemory
  episodic: WerewolfEpisodicEntry[]
  semantic: Record<string, WerewolfSemanticProfile>
  validActionHint: string
}

export function buildWerewolfContext(i: WerewolfContextInput): { systemMessage: string; userMessage: string } {
  const role = i.workingMemory.ownRole
  const alive = i.state.players.filter(p => p.alive).map(p => p.name).join(', ')
  const dead = i.state.players.filter(p => !p.alive).map(p => `${p.name}(第${p.deathDay}天 ${p.deathCause})`).join(', ') || '无'

  const systemMessage = [
    i.agent.systemPrompt,
    `你叫 ${i.agent.name}，真实身份：${zhRole(role)}。`,
    rolePrivateEvidence(role, i.workingMemory),
    `输出格式（严格遵守）：`,
    `<thinking>你的推理（可多段）</thinking>`,
    `<belief>JSON 对象，key=玩家名，value={werewolf,villager,seer,witch,reasoning,lastUpdatedAt}，总和=1</belief>`,
    `<action>${i.validActionHint}</action>`,
  ].join('\n\n')

  const userMessage = [
    `## 本局当前状态`,
    `第 ${i.state.day} 天 · 阶段 ${i.state.phase}`,
    `活人：${alive}`,
    `死亡：${dead}`,
    '',
    `## 最近发言（时间序）`,
    formatSpeeches(i.workingMemory.speechLog),
    '',
    `## 历次投票`,
    formatVotes(i.workingMemory.voteLog),
    '',
    `## 你当前的信念状态`,
    formatBelief(i.workingMemory.beliefState),
    '',
    `## 对每位对手的长期画像`,
    formatSemantic(i.semantic),
    '',
    `## 过去复盘（最多 5 局）`,
    i.episodic.slice(0, 5).map(e => `- ${e.summary}（${e.winnerFaction} 胜；你 ${e.ownOutcome}）`).join('\n') || '（无）',
    '',
    `请输出本阶段动作。`,
  ].join('\n')

  return { systemMessage, userMessage }
}

function zhRole(r: WerewolfRole): string {
  return { werewolf: '狼人', seer: '预言家', witch: '女巫', villager: '平民' }[r]
}

function rolePrivateEvidence(role: WerewolfRole, mem: WerewolfWorkingMemory): string {
  switch (role) {
    case 'werewolf':
      return `你的狼队友：${mem.ownPrivateEvidence.werewolfTeammates?.join(', ') ?? '未知'}。`
    case 'seer':
      return `你历次验人结果：${(mem.ownPrivateEvidence.seerChecks ?? []).map(c => `第${c.day}天查${c.targetId}=${zhRole(c.role)}`).join('; ') || '暂无'}`
    case 'witch': {
      const p = mem.ownPrivateEvidence.witchPotions
      return `你的药剂：救药 ${p?.save ? '剩' : '已用'}，毒药 ${p?.poison ? '剩' : '已用'}。`
    }
    default:
      return '你是平民，无特殊能力。'
  }
}

function formatSpeeches(log: WerewolfWorkingMemory['speechLog']): string {
  return log.slice(-12).map(s => `- [Day${s.day}] ${s.agentId}${s.claimedRole ? `（自称${zhRole(s.claimedRole)}）` : ''}：${s.content}`).join('\n') || '（无）'
}
function formatVotes(log: WerewolfWorkingMemory['voteLog']): string {
  return log.slice(-12).map(v => `- [Day${v.day}] ${v.voter} → ${v.target ?? '弃票'}`).join('\n') || '（无）'
}
function formatBelief(b: WerewolfWorkingMemory['beliefState']): string {
  return Object.entries(b).map(([id, e]) => `- ${id}: 狼${e.werewolf.toFixed(2)} 神${(e.seer + e.witch).toFixed(2)} 民${e.villager.toFixed(2)}`).join('\n') || '（首次更新）'
}
function formatSemantic(s: Record<string, WerewolfSemanticProfile>): string {
  return Object.entries(s).map(([id, p]) => `- ${id}: 演技${p.actingSkill}/10 推理${p.reasoningDepth}/10 note:${p.note}`).join('\n') || '（无历史）'
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { buildWerewolfContext } from '@/games/werewolf/agent/werewolf-context'

describe('buildWerewolfContext', () => {
  const baseInput = () => ({
    agent: { id: 'a', name: 'Alice', systemPrompt: '严谨推理' },
    state: {
      day: 1, phase: 'day/speak' as any,
      players: [
        { agentId: 'a', name: 'Alice', alive: true, seatOrder: 0, deathDay: null, deathCause: null },
        { agentId: 'b', name: 'Bob', alive: false, seatOrder: 1, deathDay: 1, deathCause: 'werewolfKill' as const },
      ],
    } as any,
    workingMemory: {
      ownRole: 'seer' as const,
      ownPrivateEvidence: { seerChecks: [{ day: 0, targetId: 'b', role: 'werewolf' as const }] },
      speechLog: [], voteLog: [], deathLog: [],
      beliefState: {},
    },
    episodic: [],
    semantic: {},
    validActionHint: 'JSON action',
  })

  it('mentions seer private evidence in system message', () => {
    const r = buildWerewolfContext(baseInput())
    expect(r.systemMessage).toContain('预言家')
    expect(r.systemMessage).toContain('第0天查b=狼人')
  })

  it('lists dead players', () => {
    const r = buildWerewolfContext(baseInput())
    expect(r.userMessage).toContain('Bob(第1天 werewolfKill)')
  })

  it('werewolf role reveals teammates', () => {
    const inp = baseInput()
    inp.workingMemory.ownRole = 'werewolf'
    inp.workingMemory.ownPrivateEvidence = { werewolfTeammates: ['Charlie'] }
    const r = buildWerewolfContext(inp)
    expect(r.systemMessage).toContain('Charlie')
  })
})
```

Run: `npx vitest run tests/games/werewolf/agent/werewolf-context.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/agent/werewolf-context.ts tests/games/werewolf/agent/werewolf-context.test.ts
git commit -m "feat(p3-2): werewolf context builder (role-specific private info)"
```

---

## Task 5: Memory 模块（三层）

**Files:**
- Create: `games/werewolf/agent/werewolf-memory.ts`
- Create: `tests/games/werewolf/agent/werewolf-memory.test.ts`

**Context:** 实现 P1a-5 的 `MemoryModule<W, E, S>` 三接口：
- `loadForDecision(matchId, agentId)` → `{ working, episodic[], semantic{}  }`
- `updateWorking(matchId, agentId, patch)`（动作后追加事件 + 写回 beliefState）
- `settleMatch(matchId, agentId, result)`（match 结束：把 working 结算为一条 episodic + EMA 更新 semantic）

Working 存 Redis；Episodic / Semantic 存 DB (JSONB)。

- [ ] **Step 1: 接口实现骨架**

```typescript
// games/werewolf/agent/werewolf-memory.ts
import type { MemoryModule } from '@/core/protocols/memory'
import type { WerewolfWorkingMemory, WerewolfEpisodicEntry, WerewolfSemanticProfile, BeliefEntry } from './types'
import type { WerewolfState, WerewolfRole } from '../engine/types'
import { getRedis } from '@/lib/redis'
import { db } from '@/db'
import { werewolfEpisodic, werewolfSemantic } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

const wKey = (matchId: string, agentId: string) => `mem:ww:${matchId}:${agentId}`

export const werewolfMemory: MemoryModule<
  WerewolfWorkingMemory,
  WerewolfEpisodicEntry,
  WerewolfSemanticProfile
> = {
  async loadForDecision(matchId, agentId) {
    const r = getRedis()
    const raw = await r.get(wKey(matchId, agentId))
    const working = raw ? (JSON.parse(raw) as WerewolfWorkingMemory) : null
    const episodicRows = await db.select().from(werewolfEpisodic).where(eq(werewolfEpisodic.observer, agentId))
    const semanticRows = await db.select().from(werewolfSemantic).where(eq(werewolfSemantic.observer, agentId))
    const semantic: Record<string, WerewolfSemanticProfile> = {}
    for (const row of semanticRows) semantic[row.targetAgentId] = row.data as WerewolfSemanticProfile
    return {
      working: working ?? initialWorking(),
      episodic: episodicRows.map(r => r.data as WerewolfEpisodicEntry),
      semantic,
    }
  },

  async updateWorking(matchId, agentId, patch) {
    const r = getRedis()
    const key = wKey(matchId, agentId)
    const raw = await r.get(key)
    const current: WerewolfWorkingMemory = raw ? JSON.parse(raw) : initialWorking()
    const merged = mergeWorking(current, patch as Partial<WerewolfWorkingMemory>)
    await r.set(key, JSON.stringify(merged), 'EX', 7 * 24 * 3600)
  },

  async settleMatch(matchId, agentId, result) {
    const r = getRedis()
    const raw = await r.get(wKey(matchId, agentId))
    if (!raw) return
    const working: WerewolfWorkingMemory = JSON.parse(raw)
    const episodic = buildEpisodic(working, result as any)
    await db.insert(werewolfEpisodic).values({
      matchId, observer: agentId, data: episodic, createdAt: new Date(),
    })
    await updateSemantic(agentId, episodic)
    await r.del(wKey(matchId, agentId))
  },
}

function initialWorking(): WerewolfWorkingMemory {
  return {
    ownRole: 'villager',
    ownPrivateEvidence: {},
    speechLog: [], voteLog: [], deathLog: [],
    beliefState: {},
  }
}

function mergeWorking(cur: WerewolfWorkingMemory, patch: Partial<WerewolfWorkingMemory>): WerewolfWorkingMemory {
  return {
    ...cur,
    ...patch,
    speechLog: patch.speechLog ? [...cur.speechLog, ...patch.speechLog] : cur.speechLog,
    voteLog: patch.voteLog ? [...cur.voteLog, ...patch.voteLog] : cur.voteLog,
    deathLog: patch.deathLog ? [...cur.deathLog, ...patch.deathLog] : cur.deathLog,
    beliefState: patch.beliefState ? mergeBelief(cur.beliefState, patch.beliefState) : cur.beliefState,
    ownPrivateEvidence: { ...cur.ownPrivateEvidence, ...(patch.ownPrivateEvidence ?? {}) },
  }
}

function mergeBelief(
  cur: Record<string, BeliefEntry>,
  patch: Record<string, Partial<BeliefEntry>>,
): Record<string, BeliefEntry> {
  const out = { ...cur }
  for (const [id, p] of Object.entries(patch)) {
    out[id] = {
      werewolf: p.werewolf ?? cur[id]?.werewolf ?? 0.25,
      villager: p.villager ?? cur[id]?.villager ?? 0.25,
      seer: p.seer ?? cur[id]?.seer ?? 0.25,
      witch: p.witch ?? cur[id]?.witch ?? 0.25,
      reasoning: p.reasoning ?? cur[id]?.reasoning ?? [],
      lastUpdatedAt: p.lastUpdatedAt ?? cur[id]?.lastUpdatedAt ?? { day: 0, phase: 'init' },
    }
  }
  return out
}

function buildEpisodic(w: WerewolfWorkingMemory, result: { winner: string; actualRoles: Record<string, WerewolfRole>; ownWon: boolean }): WerewolfEpisodicEntry {
  const beliefAccuracy: WerewolfEpisodicEntry['beliefAccuracy'] = {}
  for (const [id, b] of Object.entries(w.beliefState)) {
    const actual = result.actualRoles[id]
    if (!actual) continue
    const mostLikely = argmax(b) as WerewolfRole
    beliefAccuracy[id] = {
      finalBelief: { werewolf: b.werewolf, villager: b.villager, seer: b.seer, witch: b.witch },
      actualRole: actual,
      mostLikely,
      correct: mostLikely === actual,
      confidenceCalibration: b[actual],
    }
  }
  return {
    gameId: 'TBD', observer: 'TBD',
    actualRoles: result.actualRoles,
    winnerFaction: (result.winner as any) ?? 'tie',
    ownOutcome: result.ownWon ? 'won' : 'lost',
    beliefAccuracy,
    keyMoments: w.deathLog.slice(-5).map(d => `Day${d.day} ${d.agentId} ${d.cause}`),
    summary: `${result.winner} 胜；本人 ${result.ownWon ? '赢' : '输'}`,
    tags: [],
  }
}

function argmax(b: BeliefEntry): string {
  return (['werewolf', 'villager', 'seer', 'witch'] as const).reduce((best, k) => b[k] > b[best as keyof BeliefEntry] ? k : best, 'werewolf' as string)
}

async function updateSemantic(observer: string, ep: WerewolfEpisodicEntry) {
  // 简化：只记录 gamesObserved++；详细的 EMA 留给 P3 Moderator 后再完善
  for (const [targetId] of Object.entries(ep.beliefAccuracy)) {
    const existing = await db.select().from(werewolfSemantic)
      .where(and(eq(werewolfSemantic.observer, observer), eq(werewolfSemantic.targetAgentId, targetId)))
    const prior = existing[0]?.data as WerewolfSemanticProfile | undefined
    const next: WerewolfSemanticProfile = {
      actingSkill: prior?.actingSkill ?? 5,
      reasoningDepth: prior?.reasoningDepth ?? 5,
      consistency: prior?.consistency ?? 5,
      asWerewolfStyle: prior?.asWerewolfStyle ?? null,
      asSeerStyle: prior?.asSeerStyle ?? null,
      asWitchStyle: prior?.asWitchStyle ?? null,
      asVillagerStyle: prior?.asVillagerStyle ?? null,
      note: prior?.note ?? '',
      gamesObserved: (prior?.gamesObserved ?? 0) + 1,
      winLossRecord: prior?.winLossRecord ?? { asWerewolf: [0, 0], asSeer: [0, 0], asVillager: [0, 0], asWitch: [0, 0] },
    }
    if (existing[0]) {
      await db.update(werewolfSemantic).set({ data: next }).where(eq(werewolfSemantic.id, existing[0].id))
    } else {
      await db.insert(werewolfSemantic).values({ observer, targetAgentId: targetId, data: next })
    }
  }
}
```

（`werewolfEpisodic` / `werewolfSemantic` 两张表需在 `db/schema.ts` 补；定义字段：`id uuid PK, matchId text, observer text, targetAgentId text?, data jsonb, createdAt timestamp`。这一 step 可作为独立 sub-step，见 Step 2。）

- [ ] **Step 2: 补 schema**

在 `db/schema.ts` 增：

```typescript
export const werewolfEpisodic = pgTable('werewolf_episodic', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: text('match_id').notNull(),
  observer: text('observer').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const werewolfSemantic = pgTable('werewolf_semantic', {
  id: uuid('id').primaryKey().defaultRandom(),
  observer: text('observer').notNull(),
  targetAgentId: text('target_agent_id').notNull(),
  data: jsonb('data').notNull(),
})
```

运行 `npm run db:push` 应用到 SQLite dev。

- [ ] **Step 3: 测试（Redis/DB 用 mock 或真实 docker）**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { werewolfMemory } from '@/games/werewolf/agent/werewolf-memory'

describe('werewolfMemory', () => {
  beforeAll(async () => {
    // 确保 redis + db 可用（CI 开 docker compose）
  })

  it('updateWorking merges speech + belief', async () => {
    await werewolfMemory.updateWorking('m1', 'a1', {
      speechLog: [{ day: 1, agentId: 'a1', content: 'hi', at: 0 }] as any,
      beliefState: { a2: { werewolf: 0.8, villager: 0.1, seer: 0.05, witch: 0.05, reasoning: ['acts suspicious'], lastUpdatedAt: { day: 1, phase: 'day/speak' } } },
    })
    const r = await werewolfMemory.loadForDecision('m1', 'a1')
    expect(r.working.speechLog).toHaveLength(1)
    expect(r.working.beliefState.a2.werewolf).toBe(0.8)
  })
})
```

Run: `npx vitest run tests/games/werewolf/agent/werewolf-memory.test.ts`
Expected: PASS（需 docker compose redis / dev db）。

- [ ] **Step 4: Commit**

```bash
git add games/werewolf/agent/werewolf-memory.ts db/schema.ts tests/games/werewolf/agent/werewolf-memory.test.ts
git commit -m "feat(p3-2): werewolf memory module (working/episodic/semantic)"
```

---

## Done criteria (Phase 3-2)

- [ ] Memory 类型对齐 spec 6.4
- [ ] Bot 策略覆盖 5 阶段
- [ ] Parser 能提取 thinking / belief / action 三段
- [ ] ContextBuilder 按角色注入私密信息
- [ ] Memory 三层读写通过单测
- [ ] DB schema 补两张表，`db:push` 成功
- [ ] lint / tsc 全绿

完成后进入 **Phase 3-3 · Moderator + GM 分支**。
