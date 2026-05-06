# Phase 1a-1 — Schema 扩张 + 通用工具（Task 1-4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 P1a 所需的所有底层 lib 层：UUID 工具、核心类型（GameEvent/MatchConfig/MatchResult）、Redis 键命名空间、把 Drizzle SQLite schema 从 P0 的 1 张表扩张到 spec §8.1 的 9 张表。

**前置条件：** Phase 0 完成（tag `phase-0`，M1+M2 验证通过）。

**参考 spec:** `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md` 第 8 节（Schema）。

**本 plan 交付后，下一份 plan 是** `2026-05-06-phase-1a-2-queries.md`（DB queries + 契约接口）。

---

## Task 1: UUID + ID 前缀工具

**Files:**
- Create: `lib/core/ids.ts`
- Create: `tests/lib/core/ids.test.ts`

**Context:** 所有表主键是 UUID。为了人类可读（面试演示时），给 matchId/agentId/taskId 加短前缀。

- [ ] **Step 1: 写失败的测试**

Create `tests/lib/core/ids.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { newId, newMatchId, newTaskId, parsePrefix } from '@/lib/core/ids'

describe('lib/core/ids', () => {
  it('newId returns a uuid v4 string', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('newMatchId has "match_" prefix', () => {
    const id = newMatchId()
    expect(id.startsWith('match_')).toBe(true)
    expect(id.length).toBeGreaterThan('match_'.length + 8)
  })

  it('newTaskId composes matchId and agentId and hand number', () => {
    const t = newTaskId({ matchId: 'match_abc', handNumber: 3, agentId: 'agt_xyz' })
    expect(t).toBe('task_match_abc-3-agt_xyz')
  })

  it('parsePrefix extracts prefix', () => {
    expect(parsePrefix('match_abc123')).toBe('match')
    expect(parsePrefix('no-prefix')).toBe(null)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/lib/core/ids.test.ts
```

Expected: 失败 `Cannot find module '@/lib/core/ids'`。

- [ ] **Step 3: 写实现**

Create `lib/core/ids.ts`:

```typescript
import { randomUUID } from 'node:crypto'

/**
 * 生成裸 UUID v4。DB 主键用这个。
 */
export function newId(): string {
  return randomUUID()
}

/**
 * 带 "match_" 前缀的 ID，便于日志/演示时区分。
 * 前缀仅用于新生成；DB 读出来后就是裸 UUID 或前缀形式，应用层不依赖前缀。
 */
export function newMatchId(): string {
  return `match_${randomUUID()}`
}
export function newAgentId(): string {
  return `agt_${randomUUID()}`
}
export function newProfileId(): string {
  return `prof_${randomUUID()}`
}
export function newEventId(): string {
  return `evt_${randomUUID()}`
}

/**
 * 构造 A2A Task ID（spec 第 4.4 节）。
 */
export function newTaskId(input: {
  matchId: string
  handNumber: number
  agentId: string
}): string {
  return `task_${input.matchId}-${input.handNumber}-${input.agentId}`
}

/**
 * 生成短期 match token（用于 X-Match-Token 头）。
 * 32 字节 hex 随机，避免被猜中。
 */
export function newMatchToken(): string {
  return `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`
}

export function parsePrefix(id: string): string | null {
  const m = id.match(/^([a-z]+)_/)
  return m ? m[1] : null
}
```

- [ ] **Step 4: 跑测试验证通过**

Run:
```bash
npm test tests/lib/core/ids.test.ts
```

Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/core/ids.ts tests/lib/core/
git commit -m "feat(p1a): core ID utilities with prefixes + match token"
```

---

## Task 2: 通用核心类型（GameEvent / MatchConfig / MatchResult）

**Files:**
- Create: `lib/core/types.ts`
- Create: `tests/lib/core/types.test.ts`

**Context:** spec 第 5.5 节定义 `GameEvent`，第 7.4 节定义 `MatchConfig`。这些是跨游戏共享的。

- [ ] **Step 1: 写失败的测试**

Create `tests/lib/core/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { gameEventSchema, matchConfigSchema, defaultMatchConfig } from '@/lib/core/types'

describe('lib/core/types', () => {
  it('gameEventSchema accepts a valid public poker event', () => {
    const ok = gameEventSchema.safeParse({
      id: 'evt_1',
      matchId: 'match_1',
      gameType: 'poker',
      seq: 1,
      occurredAt: '2026-05-06T00:00:00Z',
      kind: 'poker/deal-hole',
      actorAgentId: null,
      payload: { to: 'agt_a' },
      visibility: 'public',
      restrictedTo: null,
    })
    expect(ok.success).toBe(true)
  })

  it('gameEventSchema rejects bad visibility', () => {
    const bad = gameEventSchema.safeParse({
      id: 'evt_1', matchId: 'match_1', gameType: 'poker', seq: 1,
      occurredAt: '2026-05-06T00:00:00Z', kind: 'x',
      actorAgentId: null, payload: {},
      visibility: 'bogus',
      restrictedTo: null,
    })
    expect(bad.success).toBe(false)
  })

  it('defaultMatchConfig returns sane defaults', () => {
    const cfg = defaultMatchConfig()
    expect(cfg.agentTimeoutMs).toBeGreaterThanOrEqual(30000)
    expect(cfg.minActionIntervalMs).toBeGreaterThanOrEqual(0)
    expect(cfg.tickConcurrencyLockMs).toBeGreaterThan(0)
    expect(cfg.maxConsecutiveErrors).toBe(3)
  })

  it('matchConfigSchema validates known shape', () => {
    const ok = matchConfigSchema.safeParse(defaultMatchConfig())
    expect(ok.success).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/lib/core/types.test.ts
```

Expected: 失败。

- [ ] **Step 3: 写实现**

Create `lib/core/types.ts`:

```typescript
import { z } from 'zod'

// === GameEvent（spec 5.5） ===
export const visibilitySchema = z.enum(['public', 'role-restricted', 'private'])
export type Visibility = z.infer<typeof visibilitySchema>

export const gameTypeSchema = z.enum(['poker', 'werewolf'])
export type GameType = z.infer<typeof gameTypeSchema>

export const gameEventSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  gameType: gameTypeSchema,
  seq: z.number().int().nonnegative(),
  occurredAt: z.string(),          // ISO timestamp
  kind: z.string(),                // e.g. "poker/deal-hole"
  actorAgentId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  visibility: visibilitySchema,
  restrictedTo: z.array(z.string()).nullable(),
})
export type GameEvent = z.infer<typeof gameEventSchema>

// === MatchConfig（spec 7.4） ===
export const matchConfigSchema = z.object({
  agentTimeoutMs: z.number().int().nonnegative().default(60000),
  minActionIntervalMs: z.number().int().nonnegative().default(1000),
  tickConcurrencyLockMs: z.number().int().positive().default(60000),
  maxConsecutiveErrors: z.number().int().positive().default(3),
})
export type MatchConfig = z.infer<typeof matchConfigSchema>

export function defaultMatchConfig(): MatchConfig {
  return matchConfigSchema.parse({})
}

// === MatchResult（spec 5.1） ===
export type MatchResult = {
  winnerFaction: string | null   // e.g. 'werewolves' for werewolf; null for poker
  ranking: Array<{
    agentId: string
    rank: number
    score: number                  // poker: final chips; werewolf: 1 if won else 0
    extra?: Record<string, unknown>
  }>
  stats?: Record<string, unknown>
}

// === Agent kind ===
export const agentKindSchema = z.enum(['player', 'moderator'])
export type AgentKind = z.infer<typeof agentKindSchema>

// === Provider kind（呼应 lib/llm/catalog.ts） ===
export const providerKindSchema = z.enum(['openai-compatible', 'anthropic', 'custom'])
export type ProviderKind = z.infer<typeof providerKindSchema>
```

- [ ] **Step 4: 跑测试**

Run:
```bash
npm test tests/lib/core/types.test.ts
```

Expected: 4 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/core/types.ts tests/lib/core/types.test.ts
git commit -m "feat(p1a): core types (GameEvent / MatchConfig / MatchResult)"
```

---

## Task 3: Redis 键命名空间辅助

**Files:**
- Create: `lib/redis/keys.ts`
- Create: `tests/lib/redis/keys.test.ts`

**Context:** spec 第 8.3 节定义了 Redis 键约定。封成函数防止 typo。

- [ ] **Step 1: 写失败的测试**

Create `tests/lib/redis/keys.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { keys } from '@/lib/redis/keys'

describe('lib/redis/keys', () => {
  it('generates expected key patterns', () => {
    expect(keys.matchState('m1')).toBe('match:m1:state')
    expect(keys.matchToken('m1')).toBe('match:m1:token')
    expect(keys.matchKeyring('m1')).toBe('match:m1:keyring')
    expect(keys.matchWorkingMemory('m1', 'agt_1')).toBe('match:m1:memory:agt_1:working')
    expect(keys.matchChannel('m1')).toBe('channel:match:m1')
    expect(keys.matchLock('m1')).toBe('lock:match:m1')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test tests/lib/redis/keys.test.ts`
Expected: 失败。

- [ ] **Step 3: 写实现**

Create `lib/redis/keys.ts`:

```typescript
/**
 * Redis key 命名空间（spec 第 8.3 节）。
 * 所有业务层 Redis 读写必须通过这些 helper，严禁直接拼字符串。
 */
export const keys = {
  matchState: (matchId: string) => `match:${matchId}:state`,
  matchToken: (matchId: string) => `match:${matchId}:token`,
  matchKeyring: (matchId: string) => `match:${matchId}:keyring`,
  matchWorkingMemory: (matchId: string, agentId: string) =>
    `match:${matchId}:memory:${agentId}:working`,
  matchChannel: (matchId: string) => `channel:match:${matchId}`,
  matchLock: (matchId: string) => `lock:match:${matchId}`,
} as const
```

- [ ] **Step 4: 跑测试**

Run: `npm test tests/lib/redis/keys.test.ts`
Expected: 1 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/redis/keys.ts tests/lib/redis/keys.test.ts
git commit -m "feat(p1a): redis key namespace helpers"
```

---

## Task 4: Drizzle SQLite schema 扩张到 9 张表

**Files:**
- Modify: `lib/db/schema.sqlite.ts`（大幅扩张）
- Create: `tests/lib/db/schema.test.ts`

**Context:** 把 P0 只有 `api_profiles` 的 schema 扩到 spec 第 8.1 节定义的 9 张表。SQLite 差异：`jsonb → text({mode: 'json'})`，`timestamp → integer({mode: 'timestamp'})`，`uuid → text`。

- [ ] **Step 1: 写失败的测试（验证每张表可被 import）**

Create `tests/lib/db/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import * as schema from '@/lib/db/schema.sqlite'

describe('lib/db/schema.sqlite', () => {
  it('exports all 9 tables', () => {
    const expected = [
      'apiProfiles',
      'agents',
      'matches',
      'matchParticipants',
      'gameEvents',
      'agentErrors',
      'workingMemory',
      'episodicMemory',
      'semanticMemory',
    ] as const
    for (const name of expected) {
      expect(schema).toHaveProperty(name)
      expect((schema as Record<string, unknown>)[name]).toBeDefined()
    }
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test tests/lib/db/schema.test.ts`
Expected: 失败（仅 apiProfiles 存在）。

- [ ] **Step 3: 写完整 schema**

覆盖 `lib/db/schema.sqlite.ts` 为以下内容：

```typescript
/**
 * SQLite schema（开发用）。生产用 schema.pg.ts（Phase 4 实现）。
 * 类型差异：jsonb → text json mode；timestamp → integer timestamp mode；uuid → text。
 * 参见 spec 第 8.1 / 8.2 节。
 */
import { sql } from 'drizzle-orm'
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core'

// === 1. API Profile ===
export const apiProfiles = sqliteTable('api_profiles', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  providerId: text('provider_id').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  temperature: integer('temperature').notNull().default(70),
  maxTokens: integer('max_tokens'),
  contextWindowTokens: integer('context_window_tokens'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s','now'))`),
})

// === 2. Agents ===
export const agents = sqliteTable(
  'agents',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    gameType: text('game_type').notNull(),       // 'poker' | 'werewolf'
    kind: text('kind').notNull().default('player'), // 'player' | 'moderator'
    profileId: text('profile_id')
      .notNull()
      .references(() => apiProfiles.id),
    systemPrompt: text('system_prompt').notNull(),
    avatarEmoji: text('avatar_emoji'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (t) => [index('agents_game_type_kind_idx').on(t.gameType, t.kind)],
)

// === 3. Matches ===
export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  gameType: text('game_type').notNull(),
  status: text('status').notNull(), // pending | running | completed | errored | aborted_by_errors
  config: text('config', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  startedAt: integer('started_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s','now'))`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  winnerFaction: text('winner_faction'),
  finalRanking: text('final_ranking', { mode: 'json' }).$type<Record<string, unknown>>(),
  stats: text('stats', { mode: 'json' }).$type<Record<string, unknown>>(),
})

// === 4. Match Participants ===
export const matchParticipants = sqliteTable(
  'match_participants',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    seatIndex: integer('seat_index').notNull(),
    initialData: text('initial_data', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.agentId] }),
    index('match_participants_match_idx').on(t.matchId),
  ],
)

// === 5. Game Events ===
export const gameEvents = sqliteTable(
  'game_events',
  {
    id: text('id').primaryKey(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    seq: integer('seq').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
    kind: text('kind').notNull(),
    actorAgentId: text('actor_agent_id'),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    visibility: text('visibility').notNull().default('public'),
    restrictedTo: text('restricted_to', { mode: 'json' }).$type<string[] | null>(),
  },
  (t) => [index('game_events_match_seq_idx').on(t.matchId, t.seq)],
)

// === 6. Agent Errors ===
export const agentErrors = sqliteTable('agent_errors', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  agentId: text('agent_id').notNull(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s','now'))`),
  layer: text('layer').notNull(), // 'http' | 'structured' | 'parse' | 'validate' | 'fallback'
  errorCode: text('error_code').notNull(),
  rawResponse: text('raw_response'),
  recoveryAction: text('recovery_action', { mode: 'json' }).$type<Record<string, unknown>>(),
})

// === 7. Working Memory ===
export const workingMemory = sqliteTable(
  'working_memory',
  {
    observerAgentId: text('observer_agent_id').notNull(),
    matchId: text('match_id').notNull(),
    gameType: text('game_type').notNull(),
    stateJson: text('state_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (t) => [primaryKey({ columns: [t.observerAgentId, t.matchId] })],
)

// === 8. Episodic Memory ===
export const episodicMemory = sqliteTable(
  'episodic_memory',
  {
    id: text('id').primaryKey(),
    observerAgentId: text('observer_agent_id').notNull(),
    targetAgentId: text('target_agent_id'),
    matchId: text('match_id').notNull(),
    gameType: text('game_type').notNull(),
    entryJson: text('entry_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    tags: text('tags', { mode: 'json' }).$type<string[]>(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (t) => [
    index('episodic_obs_target_idx').on(
      t.observerAgentId,
      t.targetAgentId,
      t.gameType,
      t.createdAt,
    ),
    index('episodic_obs_gametype_idx').on(t.observerAgentId, t.gameType, t.createdAt),
  ],
)

// === 9. Semantic Memory ===
export const semanticMemory = sqliteTable(
  'semantic_memory',
  {
    observerAgentId: text('observer_agent_id').notNull(),
    targetAgentId: text('target_agent_id').notNull(),
    gameType: text('game_type').notNull(),
    profileJson: text('profile_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    gamesObserved: integer('games_observed').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(strftime('%s','now'))`),
  },
  (t) => [
    primaryKey({
      columns: [t.observerAgentId, t.targetAgentId, t.gameType],
    }),
  ],
)
```

- [ ] **Step 4: 生成并应用 migration**

Run:
```bash
# 先删掉旧的 dev.db（有旧 schema），让新 migration 从零开始
rm -f dev.db dev.db-journal dev.db-wal dev.db-shm
npm run db:generate
npm run db:migrate
```

Expected: 生成 `lib/db/migrations/0001_*.sql`（P0 的 0000 还在），应用成功。

- [ ] **Step 5: 跑测试**

Run: `npm test tests/lib/db/schema.test.ts`
Expected: 1 passed。

- [ ] **Step 6: 全量测试回归**

Run: `npm test`
Expected: 之前所有测试仍通过（包括 P0 的 client.test.ts）。

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.sqlite.ts lib/db/migrations/ tests/lib/db/schema.test.ts
git commit -m "feat(p1a): expand sqlite schema to 9 tables per spec §8.1"
```

---


---

## 本 plan 验收标准

- `npm test` 全绿（新增 schema / ids / types / keys 单测）
- `npx tsc --noEmit` 零错
- `npm run db:generate` + `npm run db:migrate` 成功
- 新增 9 张 SQLite 表可以被 drizzle 正常 select/insert
- Git 有 4 个 feat(p1a) commits

**下一份：** `2026-05-06-phase-1a-2-queries.md` —— 封装所有 DB queries + 定义 GameEngine/MemoryModule/Registry 契约。
