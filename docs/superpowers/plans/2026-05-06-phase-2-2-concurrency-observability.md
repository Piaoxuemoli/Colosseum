# Phase 2-2 — 并发多对局 + 观测性

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保证同一服务器进程能同时跑多个 match 互不串扰；结构化 JSON 日志 / 基础 metrics 端点 / agent_errors 观测面板联动。

**Architecture:**
- Redis `lock:match:<id>` 已在 P1a-6 防并发 tick；本 phase 验证多 match 并发不串扰，补漏洞
- `match-token` 改为 HMAC 签名（含 matchId + exp），不再依赖 in-memory 表
- key-cache 每个 match 独立命名空间；match 结束后 cleanup
- 引入 `lib/obs/logger.ts`（pino-like 轻量 JSON logger）
- `GET /api/_health` + `GET /api/_metrics`（基础 counter）

**前置条件：** P2-1 完成。

**参考 spec:** 第 7.5 节（多对局隔离）、第 10 节（错误 / 观测）、第 8.5 节（Match Token 生命周期）。

**不做的事：**
- ❌ OpenTelemetry 全套 tracing（延后）
- ❌ Prometheus scrape（Phase 4 再补）
- ❌ rate limiting（延后）

---

## 文件结构

```
Colosseum/
├── lib/auth/
│   └── match-token.ts                    # Modify: HMAC 签名 + 验签
├── lib/obs/
│   ├── logger.ts                         # JSON logger
│   └── metrics.ts                        # 进程内 counter / histogram
├── app/api/
│   ├── _health/route.ts                  # GET health
│   └── _metrics/route.ts                 # GET metrics
├── lib/agent/
│   └── key-cache.ts                      # Modify: 加 TTL + match cleanup hook
├── lib/orchestrator/
│   ├── gm.ts                             # Modify: logger + metrics 埋点
│   └── match-lifecycle.ts                # Modify: match 结束触发 cleanup
└── tests/
    ├── auth/match-token.test.ts
    ├── obs/metrics.test.ts
    └── e2e/concurrent-matches.test.ts    # 2 match 并发
```

---

## Task 1: HMAC 签名 match-token

**Files:**
- Modify: `lib/auth/match-token.ts`
- Create: `tests/auth/match-token.test.ts`

**Context:** P1 的 token 是内存 Map，进程重启会丢 + 不利于多实例。改为 HMAC-SHA256，payload 含 `matchId + exp`。

- [ ] **Step 1: 实现**

```typescript
// lib/auth/match-token.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function secret(): Buffer {
  const s = process.env.MATCH_TOKEN_SECRET
  if (!s) throw new Error('MATCH_TOKEN_SECRET env missing')
  return Buffer.from(s, 'utf8')
}

export function signMatchToken(matchId: string, ttlSec = 7200): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const payload = `${matchId}.${exp}`
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyMatchToken(token: string | null | undefined, matchId: string): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [mid, expStr, sig] = parts
  if (mid !== matchId) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  const expected = createHmac('sha256', secret()).update(`${mid}.${expStr}`).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { signMatchToken, verifyMatchToken } from '@/lib/auth/match-token'

beforeAll(() => { process.env.MATCH_TOKEN_SECRET = 'test-secret-1234' })

describe('match-token HMAC', () => {
  it('signs and verifies', () => {
    const t = signMatchToken('m1', 60)
    expect(verifyMatchToken(t, 'm1')).toBe(true)
  })
  it('rejects wrong matchId', () => {
    const t = signMatchToken('m1', 60)
    expect(verifyMatchToken(t, 'm2')).toBe(false)
  })
  it('rejects expired token', () => {
    const t = signMatchToken('m1', -10)
    expect(verifyMatchToken(t, 'm1')).toBe(false)
  })
  it('rejects tampered sig', () => {
    const t = signMatchToken('m1', 60)
    const tampered = t.slice(0, -4) + 'abcd'
    expect(verifyMatchToken(tampered, 'm1')).toBe(false)
  })
})
```

Run: `npx vitest run tests/auth/match-token.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add lib/auth/match-token.ts tests/auth/match-token.test.ts
git commit -m "feat(p2-2): HMAC-signed match-token"
```

---

## Task 2: Key cache TTL + match cleanup

**Files:**
- Modify: `lib/agent/key-cache.ts`
- Modify: `lib/orchestrator/match-lifecycle.ts`

**Context:** in-process `Map` 缓存，match 结束或 2 小时 TTL 后清理。

- [ ] **Step 1: 升级 key-cache**

```typescript
// lib/agent/key-cache.ts
interface Entry { apiKey: string; expAt: number }
const cache = new Map<string, Entry>()
const TTL_MS = 2 * 60 * 60 * 1000

export function putApiKey(matchId: string, profileId: string, apiKey: string) {
  cache.set(`${matchId}:${profileId}`, { apiKey, expAt: Date.now() + TTL_MS })
}

export function getApiKey(matchId: string, profileId: string): string | undefined {
  const k = `${matchId}:${profileId}`
  const e = cache.get(k)
  if (!e) return undefined
  if (e.expAt < Date.now()) { cache.delete(k); return undefined }
  return e.apiKey
}

export function dropMatch(matchId: string) {
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(`${matchId}:`)) cache.delete(k)
  }
}

export function _stats() {
  return { size: cache.size }
}
```

- [ ] **Step 2: match 结束钩子**

在 `lib/orchestrator/match-lifecycle.ts` 的 `settleMatch(matchId)` 成功后调用：

```typescript
import { dropMatch } from '@/lib/agent/key-cache'
// ...
dropMatch(matchId)
logger.info({ event: 'match.settled', matchId })
```

- [ ] **Step 3: Commit**

```bash
git add lib/agent/key-cache.ts lib/orchestrator/match-lifecycle.ts
git commit -m "feat(p2-2): key-cache TTL + cleanup on match settle"
```

---

## Task 3: JSON logger

**Files:**
- Create: `lib/obs/logger.ts`

**Context:** 不引入 pino，用轻量自写：每行 JSON，字段 `ts/level/msg/...extra`。避免破坏 stdout 流。

- [ ] **Step 1: 实现**

```typescript
// lib/obs/logger.ts
type Level = 'debug' | 'info' | 'warn' | 'error'
const levelRank: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const min = (process.env.LOG_LEVEL as Level) ?? 'info'

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (levelRank[level] < levelRank[min]) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(ctx ?? {}) })
  if (level === 'error') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, ctx),
  withMatch: (matchId: string) => ({
    debug: (m: string, c?: any) => write('debug', m, { matchId, ...c }),
    info: (m: string, c?: any) => write('info', m, { matchId, ...c }),
    warn: (m: string, c?: any) => write('warn', m, { matchId, ...c }),
    error: (m: string, c?: any) => write('error', m, { matchId, ...c }),
  }),
}
```

- [ ] **Step 2: 在 GM 关键点埋点**

在 `lib/orchestrator/gm.ts` 替换 `console.log` 为 `logger.info`：
- `tick.start` / `tick.end`（附 matchId + handNumber + phase）
- `agent.request`（agentId + 耗时）
- `agent.fallback`（errorKind）
- `match.settled`

- [ ] **Step 3: Commit**

```bash
git add lib/obs/logger.ts lib/orchestrator/gm.ts
git commit -m "feat(p2-2): JSON logger + GM instrumentation"
```

---

## Task 4: Metrics（进程内 counter）

**Files:**
- Create: `lib/obs/metrics.ts`
- Create: `tests/obs/metrics.test.ts`
- Create: `app/api/_metrics/route.ts`
- Create: `app/api/_health/route.ts`

- [ ] **Step 1: 实现 metrics**

```typescript
// lib/obs/metrics.ts
const counters = new Map<string, number>()
const histograms = new Map<string, number[]>()

export function inc(name: string, value = 1, labels?: Record<string, string>) {
  const k = key(name, labels)
  counters.set(k, (counters.get(k) ?? 0) + value)
}

export function observe(name: string, value: number, labels?: Record<string, string>) {
  const k = key(name, labels)
  const arr = histograms.get(k) ?? []
  arr.push(value)
  if (arr.length > 1000) arr.shift()
  histograms.set(k, arr)
}

export function snapshot() {
  const hist: Record<string, { count: number; avg: number; p95: number }> = {}
  for (const [k, arr] of histograms) {
    const sorted = [...arr].sort((a, b) => a - b)
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length
    hist[k] = { count: sorted.length, avg, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 }
  }
  return { counters: Object.fromEntries(counters), histograms: hist }
}

export function _reset() { counters.clear(); histograms.clear() }

function key(name: string, labels?: Record<string, string>): string {
  if (!labels) return name
  const ordered = Object.keys(labels).sort().map(k => `${k}=${labels[k]}`).join(',')
  return `${name}{${ordered}}`
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { inc, observe, snapshot, _reset } from '@/lib/obs/metrics'

describe('metrics', () => {
  beforeEach(() => _reset())
  it('counters', () => {
    inc('req')
    inc('req')
    inc('req', 1, { path: '/x' })
    const s = snapshot()
    expect(s.counters.req).toBe(2)
    expect(s.counters['req{path=/x}']).toBe(1)
  })
  it('histograms', () => {
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) observe('lat', v)
    const s = snapshot()
    expect(s.histograms.lat.count).toBe(10)
    expect(s.histograms.lat.avg).toBeCloseTo(5.5, 1)
    expect(s.histograms.lat.p95).toBe(10)
  })
})
```

Run: `npx vitest run tests/obs/metrics.test.ts`
Expected: PASS。

- [ ] **Step 3: API routes**

```typescript
// app/api/_metrics/route.ts
import { NextResponse } from 'next/server'
import { snapshot } from '@/lib/obs/metrics'
export async function GET() { return NextResponse.json(snapshot()) }
```

```typescript
// app/api/_health/route.ts
import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json({ status: 'ok', ts: new Date().toISOString(), uptime: process.uptime() })
}
```

- [ ] **Step 4: GM 埋点**

在 `lib/orchestrator/gm.ts`：

```typescript
import { inc, observe } from '@/lib/obs/metrics'
// tick start
const t0 = performance.now()
// ... work
observe('tick.duration_ms', performance.now() - t0, { gameType: match.gameType })
inc('tick.count', 1, { gameType: match.gameType })

// agent request
observe('agent.request_ms', ms, { agentId })
// agent fallback
inc('agent.fallback', 1, { kind: errorKind })
```

- [ ] **Step 5: Commit**

```bash
git add lib/obs/metrics.ts app/api/_metrics app/api/_health tests/obs/metrics.test.ts lib/orchestrator/gm.ts
git commit -m "feat(p2-2): in-process metrics + health/metrics endpoints"
```

---

## Task 5: 并发隔离验证（冒烟测试）

**Files:**
- Create: `tests/e2e/concurrent-matches.test.ts`

**Context:** 启用 `M4_MOCK_LLM=1`（P1b-5 已做），并发跑 2 个 match，每手 / 最终筹码都互不污染。

- [ ] **Step 1: 测试**

```typescript
import { describe, it, expect } from 'vitest'
// 具体 helper 从 M4 smoke 抽出，这里声明伪代码结构

describe('concurrent matches isolation', () => {
  it('two parallel matches settle independently', async () => {
    process.env.M4_MOCK_LLM = '1'
    const [m1, m2] = await Promise.all([
      createAndRunMatch({ seed: 'A', agents: 6, hands: 3 }),
      createAndRunMatch({ seed: 'B', agents: 6, hands: 3 }),
    ])
    expect(m1.id).not.toBe(m2.id)
    expect(m1.status).toBe('settled')
    expect(m2.status).toBe('settled')
    // 筹码守恒（每个 match 内部）
    expect(m1.totalChips).toBe(6 * 1000)
    expect(m2.totalChips).toBe(6 * 1000)
    // 事件流 matchId 分得开
    expect(m1.events.every(e => e.matchId === m1.id)).toBe(true)
    expect(m2.events.every(e => e.matchId === m2.id)).toBe(true)
  }, 60_000)
})

async function createAndRunMatch(opts: any): Promise<any> {
  // TODO 复用 M4 smoke helper：createMatch → uploadKeys → tick loop → 读取最终 state
  throw new Error('not implemented - reuse M4 helper')
}
```

- [ ] **Step 2: 实现 helper + 跑**

把 P1b-5 Task 7 的 helper 抽到 `tests/e2e/helpers.ts`，让本文件 import。跑：

```bash
npx vitest run tests/e2e/concurrent-matches.test.ts
```

Expected: PASS（可能 30-50s）。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/concurrent-matches.test.ts tests/e2e/helpers.ts
git commit -m "test(p2-2): concurrent matches isolation e2e"
```

---

## Task 6: 观战面板 fallback Badge 增强

**Files:**
- Modify: `components/match/ErrorBadge.tsx`

**Context:** P1b-4 已有 ErrorBadge。这里补：区分 `kind`（timeout/api_error/parse_fail），在 popover 里分组展示；点击可查看完整 `raw` 字段（折叠）。

- [ ] **Step 1: 增强组件**

在原 Popover 内容替换为分组：

```tsx
// 分组
const groups = items.reduce((acc, e) => {
  (acc[e.kind] ??= []).push(e); return acc
}, {} as Record<string, ErrorItem[]>)

return (
  <Popover>
    {/* trigger 同前 */}
    <PopoverContent className="w-96" align="end">
      <div className="mb-2 text-xs font-semibold text-neutral-300">Agent 错误分布</div>
      {Object.entries(groups).map(([kind, list]) => (
        <details key={kind} className="mb-2">
          <summary className="cursor-pointer text-xs text-red-300">
            {kind} × {list.length}
          </summary>
          <ul className="mt-1 space-y-1 text-[10px]">
            {list.slice(0, 5).map((e, i) => (
              <li key={i} className="rounded bg-red-500/10 px-2 py-1">
                <div>{e.message}</div>
                {(e as any).raw && (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-neutral-400">
                    {String((e as any).raw).slice(0, 500)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </PopoverContent>
  </Popover>
)
```

- [ ] **Step 2: Commit**

```bash
git add components/match/ErrorBadge.tsx
git commit -m "feat(p2-2): ErrorBadge groups by kind + raw preview"
```

---

## Task 7: 手动验收清单

**Files:**
- Create: `docs/demo/phase-2-m5-checklist.md`

- [ ] **Step 1: 文件**

```markdown
# Phase 2 M5 · 合规 + 多对局 + 观测

## 合规（P2-1 已验）
- [ ] AgentCard 可 curl
- [ ] curl JSON-RPC message/stream 正常输出 SSE

## 多对局
- [ ] UI 开两 tab 分别创建 6-bot match，同时进行不串扰
- [ ] 任一 match 的 ErrorBadge 只反映自己 match 的错误
- [ ] 任一 match 结束后另一 match 不受影响

## 观测
- [ ] `GET /api/_health` 200 + JSON
- [ ] `GET /api/_metrics` JSON 包含 `tick.count`, `agent.request_ms`, `agent.fallback`
- [ ] 日志是单行 JSON（grep `"event":"tick.end"` 能找到）

## 安全
- [ ] MATCH_TOKEN_SECRET 未设置时服务启动抛错（或中间件拦截）
- [ ] 过期 token 调 endpoint 返回 401
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo/phase-2-m5-checklist.md
git commit -m "docs(p2-2): Phase 2 M5 checklist"
```

---

## Done criteria (Phase 2-2)

- [ ] HMAC match-token 通过 4 个单测
- [ ] key-cache TTL + cleanup
- [ ] JSON logger + health/metrics endpoints
- [ ] Metrics 埋点覆盖 tick / agent / fallback
- [ ] 并发 match e2e 测试通过
- [ ] ErrorBadge 按 kind 分组
- [ ] M5 手动 checklist 全绿
- [ ] `npm run lint` / `npx vitest run` 全绿

完成后进入 **Phase 3 · Werewolf**。
