# Phase 2-1 — A2A v0.3 协议合规（AgentCard + JSON-RPC + SSE 格式）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 Phase 1 的自定义 agent endpoint 升级为 **A2A v0.3 严格合规**：发布 `.well-known/agent-card.json`、JSON-RPC `message/stream` 方法、`status-update` / `artifact-update` SSE 事件格式，使 `curl` / 第三方 A2A 客户端能直接调用。

**Architecture:**
- 路由：新增 `GET /api/agents/[agentId]/.well-known/agent-card.json`；保留现有 endpoint 但改为 JSON-RPC 分发
- 用 `@a2a-js/sdk` 的服务端构造器包一层（避免手撸 JSON-RPC 帧）
- 请求入参从自定义 body → `Message` 对象；响应从自定义 SSE → `status-update` + `artifact-update`
- 保留 `X-Match-Token` header 鉴权；在 AgentCard 的 `securitySchemes` 里声明

**前置条件：** Phase 1 全绿（P1b-5 M4 Checklist 通过）。

**参考 spec:** 第 4.3 节（Agent Card）、第 4.4 节（请求 / 响应 Schema）、第 4.5 节（Endpoint 内部）、第 4.6 节（Client 封装）。

**不做的事：**
- ❌ 多对局并发强化（Phase 2-2）
- ❌ observability / metrics（Phase 2-2）
- ❌ 非 Next.js 的外部 agent（Phase 5+）

---

## 文件结构

```
Colosseum/
├── app/api/agents/[agentId]/
│   ├── .well-known/agent-card.json/
│   │   └── route.ts                        # 新增：发布 AgentCard
│   ├── route.ts                            # 新增：JSON-RPC 总入口 POST
│   └── message/stream/route.ts             # Modify: 语义对齐 A2A v0.3
├── lib/a2a-core/
│   ├── agent-card.ts                       # AgentCard 构造器
│   ├── jsonrpc.ts                          # JSON-RPC 请求 / 响应帧
│   ├── sse-writer.ts                       # status-update / artifact-update helper
│   ├── types.ts                            # Message/Part/Task/Artifact 类型 re-export
│   └── client.ts                           # A2AClient 封装（替换 Phase 1 的原始 fetch）
├── tests/a2a-core/
│   ├── agent-card.test.ts
│   ├── jsonrpc.test.ts
│   └── sse-writer.test.ts
└── lib/orchestrator/gm.ts                  # Modify: 改用 a2a-core client
```

---

## Task 1: 安装 @a2a-js/sdk + 类型 re-export

**Files:**
- Modify: `package.json`
- Create: `lib/a2a-core/types.ts`

- [ ] **Step 1: 安装**

```bash
npm install @a2a-js/sdk
```

- [ ] **Step 2: 类型 re-export**

```typescript
// lib/a2a-core/types.ts
export type {
  Message,
  Part,
  Task,
  TaskStatus,
  Artifact,
  AgentCard,
  SecurityScheme,
} from '@a2a-js/sdk'

export interface DataPart {
  kind: 'data'
  data: unknown
}

export interface TextPart {
  kind: 'text'
  text: string
}

export interface DecisionRequestData {
  kind: string                  // "poker/decide" | "werewolf/decide-speak" | ...
  gameState: unknown
  validActions: unknown[]
  memoryContext: unknown
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json lib/a2a-core/types.ts
git commit -m "chore(p2-1): install @a2a-js/sdk + type re-exports"
```

---

## Task 2: AgentCard 构造器

**Files:**
- Create: `lib/a2a-core/agent-card.ts`
- Create: `tests/a2a-core/agent-card.test.ts`

**Context:** `buildAgentCard(agent, profile, baseUrl)` 按 spec 4.3 返回合规 AgentCard JSON。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/a2a-core/agent-card.test.ts
import { describe, it, expect } from 'vitest'
import { buildAgentCard } from '@/lib/a2a-core/agent-card'

describe('buildAgentCard', () => {
  it('returns v0.3 compliant card', () => {
    const card = buildAgentCard({
      agent: {
        id: 'agt_1', name: 'BluffMaster', gameType: 'poker',
        kind: 'player', systemPrompt: 's', model: 'gpt-4o', profileId: 'p1',
        version: '1.0.0', description: 'test',
      } as any,
      baseUrl: 'https://x.y',
    })
    expect(card.protocolVersion).toBe('0.3.0')
    expect(card.name).toBe('BluffMaster')
    expect(card.url).toBe('https://x.y/api/agents/agt_1')
    expect(card.capabilities.streaming).toBe(true)
    expect(card.skills[0].id).toBe('poker-decision')
    expect(card.securitySchemes.apiKey).toBeDefined()
  })

  it('uses werewolf skill for werewolf agent', () => {
    const card = buildAgentCard({
      agent: { id: 'a2', name: 'W', gameType: 'werewolf', kind: 'player' } as any,
      baseUrl: 'https://x.y',
    })
    expect(card.skills[0].id).toBe('werewolf-decision')
  })

  it('uses moderator skill for werewolf moderator', () => {
    const card = buildAgentCard({
      agent: { id: 'm1', name: 'Judge', gameType: 'werewolf', kind: 'moderator' } as any,
      baseUrl: 'https://x.y',
    })
    expect(card.skills[0].id).toBe('werewolf-moderator')
  })
})
```

Run: `npx vitest run tests/a2a-core/agent-card.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现**

```typescript
// lib/a2a-core/agent-card.ts
import type { AgentCard } from './types'

export interface BuildCardInput {
  agent: {
    id: string
    name: string
    gameType: 'poker' | 'werewolf'
    kind: 'player' | 'moderator'
    version?: string
    description?: string
  }
  baseUrl: string
}

export function buildAgentCard(input: BuildCardInput): AgentCard {
  const { agent, baseUrl } = input
  const skill = skillFor(agent.gameType, agent.kind)
  return {
    protocolVersion: '0.3.0',
    name: agent.name,
    description: agent.description ?? `${agent.gameType} agent`,
    version: agent.version ?? '1.0.0',
    url: `${baseUrl}/api/agents/${agent.id}`,
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    skills: [skill],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    securitySchemes: {
      apiKey: {
        apiKeySecurityScheme: { location: 'header', name: 'X-Match-Token' },
      },
    },
  } as AgentCard
}

function skillFor(gameType: string, kind: string) {
  if (gameType === 'poker') {
    return { id: 'poker-decision', name: 'Poker Hand Decision',
      description: 'Decide a single poker action', tags: ['poker', 'fixed-limit', '6-max'],
      inputModes: ['application/json'], outputModes: ['application/json'] }
  }
  if (kind === 'moderator') {
    return { id: 'werewolf-moderator', name: 'Werewolf Moderator Narration',
      description: 'Narrate werewolf phase transitions', tags: ['werewolf', 'moderator'],
      inputModes: ['application/json'], outputModes: ['application/json'] }
  }
  return { id: 'werewolf-decision', name: 'Werewolf Decision',
    description: 'Decide werewolf night/day action or speech', tags: ['werewolf', '6-player'],
    inputModes: ['application/json'], outputModes: ['application/json'] }
}
```

Run: `npx vitest run tests/a2a-core/agent-card.test.ts`
Expected: PASS。

- [ ] **Step 3: AgentCard Route**

```typescript
// app/api/agents/[agentId]/.well-known/agent-card.json/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/db/queries/agents'
import { buildAgentCard } from '@/lib/a2a-core/agent-card'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params
  const agent = await getAgent(agentId)
  if (!agent) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const baseUrl = process.env.BASE_URL ?? `${req.nextUrl.protocol}//${req.nextUrl.host}`
  return NextResponse.json(buildAgentCard({ agent: agent as any, baseUrl }))
}
```

- [ ] **Step 4: 手动验证**

```bash
curl http://localhost:3000/api/agents/<存在的agentId>/.well-known/agent-card.json | jq
```

Expected: 完整 JSON，`protocolVersion=0.3.0`、`url` 正确。

- [ ] **Step 5: Commit**

```bash
git add lib/a2a-core/agent-card.ts app/api/agents/\[agentId\]/.well-known tests/a2a-core/agent-card.test.ts
git commit -m "feat(p2-1): AgentCard publishing at .well-known/agent-card.json"
```

---

## Task 3: JSON-RPC 帧编解码

**Files:**
- Create: `lib/a2a-core/jsonrpc.ts`
- Create: `tests/a2a-core/jsonrpc.test.ts`

**Context:** `@a2a-js/sdk` 有自己的 JSON-RPC 工具，但为控制清晰度，我们封一层：解析请求、生成错误响应、封装方法分发。

- [ ] **Step 1: 测试**

```typescript
// tests/a2a-core/jsonrpc.test.ts
import { describe, it, expect } from 'vitest'
import { parseRpcRequest, rpcError, rpcResult } from '@/lib/a2a-core/jsonrpc'

describe('parseRpcRequest', () => {
  it('parses valid request', () => {
    const r = parseRpcRequest({ jsonrpc: '2.0', id: 1, method: 'message/stream', params: {} })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.method).toBe('message/stream')
  })
  it('rejects missing jsonrpc', () => {
    const r = parseRpcRequest({ id: 1, method: 'x' })
    expect(r.ok).toBe(false)
  })
  it('rejects wrong version', () => {
    const r = parseRpcRequest({ jsonrpc: '1.0', id: 1, method: 'x' })
    expect(r.ok).toBe(false)
  })
})

describe('rpcError / rpcResult', () => {
  it('error envelope', () => {
    const e = rpcError(7, -32601, 'method not found')
    expect(e).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'method not found' } })
  })
  it('result envelope', () => {
    expect(rpcResult(9, { ok: true })).toEqual({ jsonrpc: '2.0', id: 9, result: { ok: true } })
  })
})
```

- [ ] **Step 2: 实现**

```typescript
// lib/a2a-core/jsonrpc.ts
export interface RpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: { code: number; message: string } }

export function parseRpcRequest(raw: unknown): ParseResult<RpcRequest> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: { code: -32700, message: 'parse error' } }
  const o = raw as any
  if (o.jsonrpc !== '2.0') return { ok: false, error: { code: -32600, message: 'invalid request' } }
  if (typeof o.method !== 'string') return { ok: false, error: { code: -32600, message: 'missing method' } }
  if (o.id === undefined) return { ok: false, error: { code: -32600, message: 'missing id' } }
  return { ok: true, value: { jsonrpc: '2.0', id: o.id, method: o.method, params: o.params } }
}

export function rpcError(id: number | string, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: data !== undefined ? { code, message, data } : { code, message } }
}

export function rpcResult(id: number | string, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

export const RpcErrors = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNAUTHORIZED: -32001,
}
```

Run: `npx vitest run tests/a2a-core/jsonrpc.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add lib/a2a-core/jsonrpc.ts tests/a2a-core/jsonrpc.test.ts
git commit -m "feat(p2-1): JSON-RPC request/response helpers"
```

---

## Task 4: SSE Writer（status-update / artifact-update）

**Files:**
- Create: `lib/a2a-core/sse-writer.ts`
- Create: `tests/a2a-core/sse-writer.test.ts`

**Context:** A2A v0.3 SSE 事件：
- `status-update`: `{ kind: 'status-update', taskId, status: { state, timestamp } }`
- `artifact-update`: `{ kind: 'artifact-update', taskId, artifact: { parts: [...] }, delta?: boolean }`

- [ ] **Step 1: 实现**

```typescript
// lib/a2a-core/sse-writer.ts
export class A2ASseWriter {
  private encoder = new TextEncoder()
  constructor(
    private controller: ReadableStreamDefaultController<Uint8Array>,
    private taskId: string,
  ) {}

  status(state: 'submitted' | 'working' | 'completed' | 'failed', extra?: Record<string, unknown>) {
    this.write({
      kind: 'status-update',
      taskId: this.taskId,
      status: { state, timestamp: new Date().toISOString(), ...extra },
    })
  }

  artifactText(text: string, delta = true) {
    this.write({
      kind: 'artifact-update',
      taskId: this.taskId,
      artifact: { parts: [{ kind: 'text', text }] },
      delta,
    })
  }

  artifactData(data: unknown) {
    this.write({
      kind: 'artifact-update',
      taskId: this.taskId,
      artifact: { parts: [{ kind: 'data', data }] },
      delta: false,
    })
  }

  close() {
    this.controller.close()
  }

  private write(payload: unknown) {
    this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
  }
}
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect } from 'vitest'
import { A2ASseWriter } from '@/lib/a2a-core/sse-writer'

describe('A2ASseWriter', () => {
  it('writes status + artifact frames', async () => {
    const chunks: string[] = []
    const decoder = new TextDecoder()
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const w = new A2ASseWriter(ctrl, 'task1')
        w.status('working')
        w.artifactText('hello', true)
        w.artifactData({ action: { type: 'fold' } })
        w.status('completed')
        w.close()
      },
    })
    const reader = stream.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value))
    }
    const joined = chunks.join('')
    expect(joined).toContain('"kind":"status-update"')
    expect(joined).toContain('"state":"working"')
    expect(joined).toContain('"text":"hello"')
    expect(joined).toContain('"state":"completed"')
  })
})
```

Run: `npx vitest run tests/a2a-core/sse-writer.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add lib/a2a-core/sse-writer.ts tests/a2a-core/sse-writer.test.ts
git commit -m "feat(p2-1): A2ASseWriter for status/artifact frames"
```

---

## Task 5: Agent Endpoint 升级到 JSON-RPC `message/stream`

**Files:**
- Modify: `app/api/agents/[agentId]/message/stream/route.ts`
- Modify: `tests/api/agent-stream.test.ts`

**Context:** Endpoint 接收 JSON-RPC 请求，方法 `message/stream`，params 里含 `message`。内部调 `runDecision` + SseWriter 输出合规帧。保留 `X-Match-Token` 鉴权；错误走 JSON-RPC error 或 `status-update failed`。

**路由路径说明：** spec 要求 `message:stream`（冒号），但 Next.js 路由不支持文件名冒号。我们的做法：文件路径 `message/stream`，但在 AgentCard 的 `url` 字段和 JSON-RPC 的 `method` 字符串里使用 `"message/stream"` 或等价，文档里说明这一偏差。

- [ ] **Step 1: 改 route**

```typescript
// app/api/agents/[agentId]/message/stream/route.ts
import { NextRequest } from 'next/server'
import { parseRpcRequest, RpcErrors } from '@/lib/a2a-core/jsonrpc'
import { A2ASseWriter } from '@/lib/a2a-core/sse-writer'
import { verifyMatchToken } from '@/lib/auth/match-token'
import { getAgent, getProfile } from '@/db/queries/agents'
import { runDecision } from '@/lib/agent/llm-runtime'
import { LlmError } from '@/lib/agent/llm-errors'
import { getApiKey } from '@/lib/agent/key-cache'
import { runBotDecision } from '@/games/poker/agent/bot'
import { logAgentError } from '@/db/queries/errors'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params
  const raw = await req.json().catch(() => null)
  const rpc = parseRpcRequest(raw)
  if (!rpc.ok) {
    return jsonResponse(400, { jsonrpc: '2.0', id: null, error: rpc.error })
  }
  const { id, method, params: rpcParams } = rpc.value
  if (method !== 'message/stream') {
    return jsonResponse(404, { jsonrpc: '2.0', id, error: { code: RpcErrors.METHOD_NOT_FOUND, message: method } })
  }

  const token = req.headers.get('X-Match-Token')
  const body = rpcParams as any
  const message = body?.message
  const matchId = body?.matchId
  const taskId = message?.taskId ?? `task_${agentId}_${Date.now()}`

  if (!token || !matchId || !verifyMatchToken(token, matchId)) {
    return jsonResponse(401, { jsonrpc: '2.0', id, error: { code: RpcErrors.UNAUTHORIZED, message: 'invalid token' } })
  }

  const agent = await getAgent(agentId)
  if (!agent) {
    return jsonResponse(404, { jsonrpc: '2.0', id, error: { code: RpcErrors.INVALID_PARAMS, message: 'agent not found' } })
  }
  const profile = await getProfile(agent.profileId)
  if (!profile) {
    return jsonResponse(500, { jsonrpc: '2.0', id, error: { code: RpcErrors.INTERNAL, message: 'profile missing' } })
  }
  const apiKey = getApiKey(matchId, profile.id)
  if (!apiKey) {
    return jsonResponse(400, { jsonrpc: '2.0', id, error: { code: RpcErrors.INVALID_PARAMS, message: 'no api key' } })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const w = new A2ASseWriter(ctrl, taskId)
      w.status('submitted')
      w.status('working')

      try {
        const contextText = String(message?.parts?.[0]?.data?.contextText ?? '')
        const res = await runDecision({
          profile: {
            providerKind: profile.providerKind as any,
            baseUrl: profile.baseUrl,
            apiKey,
            model: agent.model,
          },
          agent: { systemPrompt: agent.systemPrompt },
          userPrompt: contextText,
          timeoutMs: 60_000,
          onThinkingDelta: (text) => w.artifactText(text, true),
        })
        w.artifactData({ action: res.action, thinkingText: res.thinkingText })
        w.status('completed')
      } catch (err) {
        const kind = err instanceof LlmError ? err.kind : 'api_error'
        await logAgentError({ matchId, agentId, kind, message: (err as Error).message, raw: null })
        const fallbackAction = runBotDecision(message?.parts?.[0]?.data?.fallbackInput)
        w.artifactData({ action: fallbackAction, fallback: true, errorKind: kind })
        w.status('failed', { error: { code: -32000, message: kind } })
      } finally {
        w.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Rpc-Id': String(id),
    },
  })
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: 更新测试**

在 `tests/api/agent-stream.test.ts` 里确保：
1. 缺 `jsonrpc` → 400
2. `method !== "message/stream"` → 404 + `-32601`
3. 正常请求输出含 `status-update` × 4 + 至少 1 条 `artifact-update`
4. LLM 抛错时，SSE 含 `failed` 状态且 `agent_errors` 入库

Run: `npx vitest run tests/api/agent-stream.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add app/api/agents/\[agentId\]/message/stream/route.ts tests/api/agent-stream.test.ts
git commit -m "feat(p2-1): agent endpoint conforms to A2A v0.3 JSON-RPC"
```

---

## Task 6: A2AClient 封装 + GM 接入

**Files:**
- Create: `lib/a2a-core/client.ts`
- Modify: `lib/orchestrator/gm.ts`

**Context:** 封装 `requestAgentDecision(agent, payload, matchToken, onThinking, timeoutMs)`：内部发 JSON-RPC 请求、解析 SSE、回调 thinking delta、返回最终 action。

- [ ] **Step 1: client**

```typescript
// lib/a2a-core/client.ts
export interface AgentDecisionResult {
  action: unknown
  thinkingText: string
  fallback?: boolean
  errorKind?: string
}

export async function requestAgentDecision(opts: {
  agent: { id: string }
  baseUrl: string
  payload: unknown
  matchId: string
  matchToken: string
  onThinking?: (text: string) => void
  timeoutMs?: number
}): Promise<AgentDecisionResult> {
  const { agent, baseUrl, payload, matchId, matchToken, onThinking, timeoutMs = 60_000 } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${baseUrl}/api/agents/${agent.id}/message/stream`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Match-Token': matchToken, 'Accept': 'text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'message/stream',
        params: { matchId, message: payload },
      }),
    })
    if (!res.ok || !res.body) throw new Error(`agent endpoint ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let thinkingText = ''
    let finalAction: unknown = null
    let fallback = false
    let errorKind: string | undefined

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      for (const frame of extractFrames(buf)) {
        buf = buf.slice(frame.end)
        const obj = safeJsonParse(frame.data)
        if (!obj) continue
        if (obj.kind === 'artifact-update') {
          const p = obj.artifact?.parts?.[0]
          if (p?.kind === 'text') {
            thinkingText += p.text
            onThinking?.(p.text)
          } else if (p?.kind === 'data') {
            finalAction = (p.data as any)?.action ?? null
            fallback = Boolean((p.data as any)?.fallback)
            errorKind = (p.data as any)?.errorKind
          }
        }
      }
    }

    if (!finalAction) throw new Error('no action artifact received')
    return { action: finalAction, thinkingText, fallback, errorKind }
  } finally {
    clearTimeout(timer)
  }
}

function extractFrames(buf: string): Array<{ data: string; end: number }> {
  const out: Array<{ data: string; end: number }> = []
  let idx = 0
  while (true) {
    const sep = buf.indexOf('\n\n', idx)
    if (sep === -1) break
    const block = buf.slice(idx, sep)
    const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n')
    out.push({ data, end: sep + 2 })
    idx = sep + 2
  }
  return out
}

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s) } catch { return null }
}
```

- [ ] **Step 2: GM 接入**

在 `lib/orchestrator/gm.ts` 把之前 `fetch(agentEndpoint, ...)` 的手写代码替换为 `requestAgentDecision(...)`；thinking delta 累积→发 `agent_thinking` 事件逻辑不变。

- [ ] **Step 3: 手动冒烟**

运行 dev stack + 创建 6-bot match 跑通一局；断点 / 日志确认 SSE 帧 kind 全是 `status-update` / `artifact-update`。

- [ ] **Step 4: Commit**

```bash
git add lib/a2a-core/client.ts lib/orchestrator/gm.ts
git commit -m "feat(p2-1): GM uses A2AClient with A2A v0.3 frames"
```

---

## Task 7: curl 合规性验证 + 文档

**Files:**
- Create: `docs/demo/a2a-compliance-check.md`

- [ ] **Step 1: 写验证清单**

```markdown
# A2A v0.3 合规 · 手动验证

## AgentCard
- [ ] `curl http://localhost:3000/api/agents/<id>/.well-known/agent-card.json` 返回 200 + 正确 JSON
- [ ] 字段齐全：protocolVersion / name / url / capabilities / skills / securitySchemes

## JSON-RPC
- [ ] POST `message/stream` 带 `jsonrpc:"2.0"` + `method:"message/stream"`，响应 SSE
- [ ] 错误 method 返回 `-32601`
- [ ] 缺 `X-Match-Token` 返回 `-32001`

## SSE 帧
- [ ] 流里按顺序有：`status-update:submitted` → `status-update:working` → 0-N `artifact-update`(text,delta=true) → 1 `artifact-update`(data) → `status-update:completed|failed`

## 第三方客户端（可选）
- [ ] 用 `@a2a-js/sdk` 的 `A2AClient` 直接调用我们 endpoint 能收到 action
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo/a2a-compliance-check.md
git commit -m "docs(p2-1): A2A v0.3 compliance check"
```

---

## Done criteria (Phase 2-1)

- [ ] `.well-known/agent-card.json` 发布合规 AgentCard
- [ ] Endpoint 接收标准 JSON-RPC，方法 `message/stream`
- [ ] SSE 帧只含 `status-update` / `artifact-update`
- [ ] A2AClient 替换 GM 原 fetch 手写代码
- [ ] 合规 checklist 全绿
- [ ] 所有测试 + lint 通过
