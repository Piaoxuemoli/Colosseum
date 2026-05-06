# Colosseum（原 LLM Poker Arena）整体重写设计

> 日期：2026-05-06
> 状态：设计定稿，等待审阅
> 作者：user + AI 共同 brainstorm
> 参考：`docs/A2A协议与Agent-Arena应用分析.md`、`docs/agent-arena-项目规划.md`

---

## 0. 项目定位与本次重写动机

Colosseum 是一个**纯 AI 博弈竞技平台**。用户在浏览器里配置多个 LLM Profile（各自 API key）→ 选游戏和座位分配 → 点"开始比赛" → 观战 AI 自主博弈 → 对局结束看排名 / 筹码图 / 思考链日志。没有人类玩家上桌、没有暂停、没有单步。

现状代码（纯前端 Vite + React 19 + Zustand + Dexie）已经跑通了 poker 对局闭环，但随着项目目标升级到"符合 A2A 协议的 Agent Arena"，有几处结构性瓶颈：

- 所有 Agent 逻辑在浏览器端，无法暴露标准 A2A HTTP 端点
- IndexedDB 没有 JSONB / 无服务端查询能力，记忆系统难以真正做三层
- 无服务端编排能力，多对局 / 跨会话 / 可观测性都做不了
- 插件化不够彻底，新增游戏仍要大量粘合工作

**本次重写：完整推倒、仅参考老项目的游戏规则实现和 UI 视觉，其他一律重做。**

目标：打造一个"符合 A2A v0.3 规范 + 可部署到生产 + 带完整记忆系统和三层动作校验 + 同时支持德扑和狼人杀"的面试级项目。

---

## 1. 已锁定的高层决策（Frozen Decisions）

| # | 决策 | 选择 |
|---|---|---|
| 1 | 重写范围 | 一次性完整重写；老项目仅参考游戏规则与 UI 视觉 |
| 2 | 技术栈 | Next.js 15 (App Router) + TypeScript + Tailwind 4 + shadcn/ui（按需复制） |
| 3 | ORM + DB | Drizzle；开发 SQLite，生产 Postgres 16（Docker 容器） |
| 4 | 缓存 / 活动对局状态 | Redis 7（Docker 容器） |
| 5 | Agent 协议 | `@a2a-js/sdk` 官方 SDK + Route Handler + JSON-RPC/SSE + 同进程多 Agent |
| 6 | LLM SDK | Vercel AI SDK（`@ai-sdk/openai-compatible` + `@ai-sdk/anthropic`） |
| 7 | API Key 策略 | 服务端 provider catalog（URL + model，无 key），客户端 key 存 localStorage，开局临时注入服务端内存 keyring |
| 8 | 游戏 | 德扑（6-max 固定限注）+ 狼人杀（简化 6 人局：狼 2 神 2 民 2） |
| 9 | 人机交互 | 纯 AI 竞技，无人类玩家接口，无暂停 / 单步 |
| 10 | 视角 | 全程上帝视角，单一模式 |
| 11 | 结算 | 无 ELO 天梯。德扑比筹码，狼人杀算胜率 |
| 12 | 实时面板 | 计分板 + 筹码图（仅德扑），对局中和赛后都展示 |
| 13 | 记忆系统 | 共享三层架构（working/episodic/semantic 三张表）+ 各游戏独立 MemoryModule + 自定义 JSONB schema |
| 14 | UI 渲染 | React 19 + Tailwind + Framer Motion；视觉样式复用老项目，其他全部重写 |
| 15 | 回放 | MVP 不做 UI，但 game_events 全量落库（为后续留口） |
| 16 | 部署 | 云服务器 Docker Compose + Caddy 反代（Vercel + Supabase + Upstash 作 fallback 方案） |
| 17 | 时间盒 | 不设 |
| 18 | 狼人杀 Moderator | 常驻一个 ModeratorAgent（系统级，可替换），经 A2A 端点被 GM 调度 |
| 19 | Token 策略 | 全量注入，不做主动压缩；超过模型窗口则 LLM API 原生报错 → fallback；输出 `max_tokens` 跟随模型默认 |

---

## 2. 系统边界与核心角色

### 2.1 用户故事

用户打开浏览器 → 配置 APIProfile（选厂商、填 key、key 只存 localStorage）→ 创建 Agent（绑定 Profile + 角色描述 + 游戏类型）→ 开一局比赛（选游戏 + 6 个座位分别指定 Agent + 参数） → 观战 + 看赛后数据。

### 2.2 高层架构

```
┌───────────────────────────────────────────────────────────────┐
│ 用户（Spectator）                                              │
│ - 配置 APIProfile（选厂商、填 key）                            │
│ - 创建 Agent                                                   │
│ - 开一局比赛 + 观战                                            │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────▼───────────────────────────────────┐
│ Web Server（Next.js 15）                                       │
│                                                                │
│ ┌──────────────┐  ┌───────────────────┐  ┌─────────────────┐ │
│ │ UI Pages     │  │ Game Master       │  │ Agent Endpoints │ │
│ │ (Server+Cli) │  │ (orchestrator)    │  │ (A2A Servers)   │ │
│ └──────────────┘  └─────────┬─────────┘  └─────────┬───────┘ │
│                             │ A2A Client            │         │
│                             └───────────────────────┘         │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Game Engines (纯 TS) │ Memory Modules (按游戏) │ Agent   │ │
│ │                                                   Modules│ │
│ └──────────────────────────────────────────────────────────┘ │
└───────────────────────────┬───────────────────────────────────┘
                            │
          ┌─────────────────┼────────────────────┐
          ▼                 ▼                    ▼
    ┌─────────┐       ┌─────────┐          ┌─────────┐
    │Postgres │       │ Redis   │          │外部 LLM │
    │持久化   │       │活动对局 │          │API      │
    │+ JSONB  │       │ keyring │          │(厂商)   │
    └─────────┘       └─────────┘          └─────────┘
```

### 2.3 五条架构铁律（spec 级约束）

1. **游戏引擎是纯函数层** —— 输入 `(state, action) → newState`，不碰 LLM、不碰 DB、不碰 HTTP。可 100% 单测覆盖。
2. **Agent Endpoint 彼此不共享进程状态** —— 即使同进程，Route Handler 也禁止 import GM 或其他 Agent 的内存结构。所有输入来自 HTTP 请求 body。这是"位置透明性"。
3. **Game Master 是唯一真相来源** —— 只有它能执行引擎 transition。Agent 决策回来必须经过 GM 验证后才更新状态。
4. **持久化时机固定** —— 每个动作后写 game_events，每手/每局结束后更新 memory 三张表。其他时候全在内存/Redis。
5. **游戏自治** —— 每个游戏拥有自己的 engine / memory module / context builder / response parser / bot strategy / plugin / UI 子目录。平台只提供接口和基础设施。

### 2.4 明确不做的事

- ❌ 人类玩家 API / 下注操作 UI / 暂停控制
- ❌ ELO 天梯 / 赛季 / 跨局排行榜
- ❌ 回放播放器 UI（但事件落库）
- ❌ 向量检索 / pgvector / embedding
- ❌ 服务端持久化用户 API key
- ❌ 用户体系 / 登录注册（单用户浏览器体验）
- ❌ 移动端适配
- ❌ 主动上下文压缩 / token 预算裁剪

---

## 3. 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│ L1  UI 层                                                         │
│     app/ 下的 Server/Client 组件，Tailwind + Framer Motion        │
│     职责: 呈现、采集输入、订阅 SSE、无业务逻辑                    │
├─────────────────────────────────────────────────────────────────┤
│ L2  Route Handler 层（HTTP 边界）                                 │
│     app/api/ 下 GET/POST 函数                                    │
│     子类: ① Agent Endpoints (A2A Server)                         │
│          ② Game Master Endpoints                                 │
│          ③ 配置 / 查询类                                          │
├─────────────────────────────────────────────────────────────────┤
│ L3  业务协调层                                                    │
│     lib/orchestrator/ lib/a2a-core/ lib/memory/                  │
│     职责: 编排回合、调 Agent、写 DB、SSE 广播                     │
├─────────────────────────────────────────────────────────────────┤
│ L4  游戏域层（每游戏一套，游戏自治）                              │
│     games/poker/{engine,agent,memory,ui}                         │
│     games/werewolf/{engine,agent,memory,ui}                      │
├─────────────────────────────────────────────────────────────────┤
│ L5  基础设施层                                                    │
│     lib/db/ lib/redis/ lib/llm/ lib/a2a-core/                    │
│     职责: 外部依赖的纯技术 adapter                               │
└─────────────────────────────────────────────────────────────────┘
```

依赖方向严格向下：L1 → L2 → L3 → L4 → L5。以 ESLint import 规则 + CI 检查作为强制。

### 3.1 一局德扑完整数据流

```
Spectator 点"开始" → POST /api/matches (L2)
  ↓
Match Controller (L3)
  - 提取 keyring 存 Redis TTL 2h
  - Postgres 建 matches + match_participants
  - 引擎初始化（L4 纯函数）
  - Redis 存初始 GameState
  - 返回 matchId + streamUrl
  ↓
客户端打开 GET /api/matches/:id/stream (SSE)
  ↓
Game Master self-triggered tick loop (L3)
  while !complete:
    actor = engine.currentActor()
    memContext = MemoryModule.buildContext()      ← L4
    message = buildA2AMessage(state, memContext)
    decision = A2AClient.messageStream(...)       ← L5
      ↓  (Agent Endpoint / L2 / A2A Server)
      ↓  从 body 读上下文 → streamText() → 流式响应
    action = coerceToValidAction(decision)        ← 三层校验
    {nextState, events} = engine.applyAction()    ← L4
    appendEvents(events)                          ← L5 db
    publishSSE(events where visibility=public)    ← L2
    saveMatchState(redis)
    if boundary: updateMemory() / finalize()
  ↓
match status=completed → SSE terminal → RankingPanel
```

### 3.2 Game Master 伪无状态

所有真相在 Redis（GameState）+ Postgres（events）。GM 实例不持有内存状态。崩溃重启后任何请求都能接过对局继续 tick。

### 3.3 SSE 两类流

| 流 | 方向 | 协议 |
|---|---|---|
| **Match Stream** | GM → Spectator | 自定义 JSON events |
| **Agent Stream** | Agent Endpoint → GM | A2A SDK 的 `message:stream` |

两者 schema、消费者、生命周期独立，不复用。

---

## 4. A2A 层详细设计

### 4.1 三部分组成

```
(A) Agent Card 资源
    app/api/agents/[agentId]/.well-known/agent-card.json/route.ts

(B) Agent Server（每个 Agent 一套端点）
    app/api/agents/[agentId]/message:send/route.ts    non-streaming
    app/api/agents/[agentId]/message:stream/route.ts  streaming (SSE)
    app/api/agents/[agentId]/tasks/[taskId]/route.ts  task query

(C) A2A Client（GM 用来调 Agent）
    lib/a2a-core/client.ts
    封装 @a2a-js/sdk 的 A2AClient + 超时 + 重试 + 响应校验
```

### 4.2 AgentId vs ProfileId（关键概念分离）

| 概念 | 含义 | 例 |
|---|---|---|
| **APIProfile** | 用户创建的 LLM 配置 | "我的 GPT-4o（低温）" |
| **Agent** | 会玩某个游戏的实体 = Profile + 系统 Prompt + gameType + kind | "BluffMaster"（绑 GPT-4o Profile）|

一个 Profile 可被多个 Agent 共用。一个 Agent 属于一个 gameType 和一个 kind（`player` 或 `moderator`）。

### 4.3 Agent Card 示例

```json
GET /api/agents/agt_xyz789/.well-known/agent-card.json
{
  "protocolVersion": "0.3.0",
  "name": "BluffMaster",
  "description": "A poker agent backed by gpt-4o with a bluff-heavy personality",
  "version": "1.0.0",
  "url": "https://<host>/api/agents/agt_xyz789",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "skills": [{
    "id": "poker-decision",
    "name": "Poker Hand Decision",
    "description": "Decides one poker action given game state",
    "tags": ["poker", "fixed-limit", "6-max"],
    "inputModes": ["application/json"],
    "outputModes": ["application/json"]
  }],
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json"],
  "securitySchemes": {
    "apiKey": {
      "apiKeySecurityScheme": { "location": "header", "name": "X-Match-Token" }
    }
  }
}
```

`X-Match-Token`：每局开始时 GM 生成短期 token，Agent endpoint 用它做基础鉴权（防外部乱调）。

### 4.4 请求 / 响应 Schema

**请求**（GM → Agent，JSON-RPC `message:stream`）：

```json
{
  "message": {
    "messageId": "msg_<uuid>",
    "taskId": "task_<matchId>-<handId>-<agentId>",
    "role": "user",
    "parts": [{
      "kind": "data",
      "data": {
        "kind": "poker/decide" | "werewolf/decide-speak" | "werewolf/moderate-narrate",
        "gameState": { ... 结构化局面（经 visibility 过滤） ... },
        "validActions": [ ... ],
        "memoryContext": {
          "working": { ... },
          "episodic": [ ... ],
          "semantic": { ... }
        }
      }
    }]
  }
}
```

**响应**（SSE 流）：

- `status-update`: submitted → working → completed/failed
- `artifact-update (delta=true, kind=text)`：思考 CoT 增量，UI 透传到 ThinkingBubble
- `artifact-update (kind=data)`：最终结构化 action 或 narration

### 4.5 Agent Endpoint 内部结构

```typescript
// app/api/agents/[agentId]/message:stream/route.ts
export const runtime = 'nodejs'

export async function POST(req: Request, { params }) {
  const { agentId } = await params
  const body = await req.json()
  const token = req.headers.get('X-Match-Token')

  // 1. 基础鉴权：token 对应活动 match
  const matchContext = await validateMatchToken(token, agentId)
  if (!matchContext) return new Response('Unauthorized', { status: 401 })

  // 2. 加载 Agent 配置
  const agent = await db.select().from(agents).where(eq(agents.id, agentId)).get()
  const profile = await getProfile(agent.profileId)
  const apiKey = matchContext.keyring[agent.profileId]

  // 3. 调游戏 ContextBuilder 构造 messages
  const gameModule = gameRegistry.get(agent.gameType)
  const contextBuilder = agent.kind === 'moderator'
    ? gameModule.moderatorContextBuilder
    : gameModule.playerContextBuilder
  const messages = contextBuilder.build({
    agent, gameState: body.message.parts[0].data.gameState,
    memoryContext: body.message.parts[0].data.memoryContext,
    systemPrompt: agent.systemPrompt,
  })

  // 4. 流式调 LLM，返回 A2A SSE
  return createA2AStreamResponse({
    taskId: body.message.taskId,
    async *execute(emit) {
      const stream = streamText({
        model: providerFactory(profile, apiKey),
        messages,
      })
      for await (const delta of stream.textStream) {
        emit.artifactUpdate({ parts: [{ kind: 'text', text: delta }], delta: true })
      }
      const fullText = await stream.text
      const parsed = gameModule.responseParser.parse(fullText, body.message.parts[0].data.validActions)
      emit.artifactUpdate({ parts: [{ kind: 'data', data: parsed }] })
    }
  })
}
```

**位置透明性铁律落地**：此 handler 不 import GameMaster / matchState / 其他 Agent 的数据——所有输入来自 HTTP body 和 DB 查询。

### 4.6 A2A Client 封装

```typescript
// lib/a2a-core/client.ts
export async function requestAgentDecision(
  agent: Agent,
  message: Message,
  matchToken: string,
  onThinking?: (delta: string) => void,
  timeoutMs: number = 60000,
): Promise<AgentDecisionResult> {
  const client = new A2AClient({
    url: `${process.env.BASE_URL}/api/agents/${agent.id}`,
    headers: { 'X-Match-Token': matchToken },
  })
  const abort = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : null
  try {
    const stream = await client.messageStream({ message }, { signal: abort.signal })
    let finalAction = null
    for await (const event of stream) {
      if (event.kind === 'artifact-update') {
        const part = event.artifact.parts[0]
        if (part.kind === 'text') onThinking?.(part.text)
        else if (part.kind === 'data') finalAction = part.data
      }
    }
    if (!finalAction) throw new Error('No action artifact')
    return finalAction
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

### 4.7 位置透明性的三个好处

1. **可搬迁** —— 把某 agent 的 `agents.url` 字段改成远程 URL，GM 代码零改动
2. **可观测** —— 每次 Agent 调用都有 HTTP trace，浏览器 Network 面板可查
3. **可互操作** —— 真的能和 Python `a2a-sdk` 写的外部 Agent 互操作

---

## 5. 游戏引擎（L4 域层）

### 5.1 通用 GameEngine 接口

```typescript
// lib/engine/contracts.ts
export interface GameEngine<TState, TAction, TConfig> {
  createInitialState(config: TConfig, playerIds: string[]): TState

  currentActor(state: TState): string | null
  // null = 需要 GM 处理边界（hand-end / match-end）

  availableActions(state: TState, playerId: string): ActionSpec<TAction>[]

  applyAction(state: TState, playerId: string, action: TAction): {
    nextState: TState
    events: GameEvent[]
  }

  boundary(prevState: TState, nextState: TState): 'hand-end' | 'round-end' | 'match-end' | null

  finalize(state: TState): MatchResult
}
```

**applyAction 不抛异常**。非法 action 在 availableActions 阶段过滤；parser bug 导致的非法 action 返回降级 state + rejection event，GM 处理 rejection。

### 5.2 Poker 引擎

**规则（沿袭现有）**：
- 6-max 固定限注（$2/$4 小/大盲）
- preflop/flop 下注 $2，turn/river 下注 $4
- 每街最多 4 次下注（1bet + 3 raise），cap 后只能 call/fold
- 单挑无 raise cap
- 筹码不足自动 all-in

**老代码可直接抄**：
- `evaluator.ts`、`equity.ts`、`pot-manager.ts`、`deck.ts`（算法正确）

**重写**：
- `poker-engine.ts`（接口对齐新契约）
- action 类型向 zod schema 靠拢

**核心类型**：

```typescript
type PokerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'bet'; amount: number }
  | { type: 'raise'; toAmount: number }
  | { type: 'allIn' }
  | { type: 'postSmallBlind' }
  | { type: 'postBigBlind' }

type PokerState = {
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
  handNumber: number
  dealerIndex: number
  players: PokerPlayerState[]   // chips, holeCards, status, currentBet
  communityCards: Card[]
  pot: number
  sidePots: SidePot[]
  currentActor: string | null
  actionHistory: PokerActionRecord[]
  betsThisStreet: number        // for 4bet cap
  smallBlind: number
  bigBlind: number
  handComplete: boolean
  matchComplete: boolean
}
```

### 5.3 Werewolf 引擎（简化 6 人局）

**角色**：狼 2 / 预言家 1 / 女巫 1 / 平民 2

**阶段机**：

```
Night 0 (第一夜特殊)
  → night/werewolf-discussion    狼轮流发言讨论刀口
  → night/werewolf-kill          狼头拍板
  → night/seer-check              预言家验人
  → night/witch-action            女巫救 / 毒（首夜不可自救）
Day 1
  → day/announce                  公布死亡
  → day/speak-round               每人按顺序发言一次（≤200 字）
  → day/vote                      全员投票
  → day/execute                   公布出局 + 遗言
Night N, Day N+1, ...
```

**胜利条件**：
- **阵营归属**：`werewolves = { 2 只狼 }`；`villagers = { 预言家 + 女巫 + 2 平民 }`（注：神职和平民合并为一个阵营）
- **狼胜**：非狼全死 或 狼数 ≥ 非狼数
- **村胜**：所有狼死
- **平局**：40 天未分 → tie（防止 Agent 死循环）

**核心类型**：

```typescript
type WerewolfAction =
  | { type: 'night/werewolfKill'; targetId: string; reasoning: string }
  | { type: 'night/seerCheck'; targetId: string }
  | { type: 'night/witchSave' }
  | { type: 'night/witchPoison'; targetId: string | null }
  | { type: 'day/speak'; content: string; claimedRole?: WerewolfRole }
  | { type: 'day/vote'; targetId: string | null; reason?: string }
  | { type: 'moderator/narrate'; narration: string }

type WerewolfRole = 'werewolf' | 'seer' | 'witch' | 'villager'

type WerewolfState = {
  day: number
  phase: /* union of 8 phases above */
  players: WerewolfPlayerState[]
  roleAssignments: Record<string, WerewolfRole>
  moderatorAgentId: string
  moderatorNarration: Array<{ day: number; phase: string; narration: string; createdAt: number }>
  speechQueue: string[]
  speechLog: SpeechRecord[]
  voteLog: VoteRecord[]
  currentActor: string | null
  witchPotions: { save: boolean; poison: boolean }
  lastNightKilled: string | null
  lastNightSaved: string | null
  lastNightPoisoned: string | null
  seerCheckResult: Array<{ day: number; targetId: string; role: WerewolfRole }> | null
  matchComplete: boolean
  winner: 'werewolves' | 'villagers' | 'tie' | null
}
```

**关键**：狼集体决策 = 狼 A 发言 → 狼 B 回应 → 狼头拍板。GM 轮流调用对应 Agent，直到 phase 转移。

### 5.4 Moderator Agent（狼人杀专属）

**职责**：
- 阶段转换时生成主持词（≤80 字）
- 监控发言，生成简要旁白
- 游戏结束生成复盘词

**实现**：
- `agents` 表行，`kind='moderator'`, `gameType='werewolf'`
- 独立 A2A endpoint（和 player 走同一套路由，`agentId` 区分）
- 独立 ContextBuilder（`moderatorContextBuilder`），不读 working/episodic/semantic memory，只读最近 N 条 game_events
- **非决策性**——不影响引擎状态，只输出 narration 事件
- 创建狼人杀 match 时必须指定一个 moderator（用户可选 / 系统默认提供）

**德扑不设 Moderator**。应用层校验：当 `gameType='poker'` 时，新建 Agent 强制 `kind='player'`；当 `gameType='werewolf'` 且 `kind='moderator'` 时，新建 match 时必须为该 match 指定 moderator agent。DB 层 enum 不强制这一约束，由 `lib/orchestrator/match-lifecycle.ts` 做 validation。

### 5.5 事件模型（跨游戏统一）

```typescript
type GameEvent = {
  id: string
  matchId: string
  gameType: 'poker' | 'werewolf'
  seq: number
  occurredAt: timestamp
  kind: string                     // e.g. "poker/deal" | "werewolf/kill"
  actorAgentId: string | null
  payload: Record<string, unknown> // 游戏特定 JSONB
  visibility: 'public' | 'role-restricted' | 'private'
  restrictedTo: string[] | null
}
```

**visibility** 决定事件分发：
- `public`：SSE 广播 + 所有 Agent Context
- `role-restricted`：只对 `restrictedTo` 中的 agentId 在 Agent Context 中可见（例：预言家验人结果、狼队友之间的讨论）
- `private`：仅观众（上帝视角），Agent Context 过滤

### 5.6 老项目代码复用清单

| 老项目代码 | 新项目待遇 |
|---|---|
| `evaluator.ts`, `equity.ts`, `pot-manager.ts`, `deck.ts` | **直接抄** |
| `poker-engine.ts` | **参考逻辑重写**（接口对齐新契约） |
| `poker-context.ts` (prompt) | **参考文本，整体重写** |
| `poker-parser.ts` | **参考思路重写**（输入格式变了） |
| `poker-ema.ts` | **直接抄**（EMA 数学） |
| 牌桌 UI 组件（PlayerSeat / BetChip / Cards） | **视觉抄，业务重写** |
| 样式 tokens / Tailwind 配置 | **直接抄** |
| 其他所有（store / plugin / gateway / CORS proxy） | **丢弃** |

---

## 6. Agent + 记忆系统

### 6.1 Agent 模块四契约

每个游戏 `games/<game>/agent/` 必须实现：

```typescript
interface ContextBuilder<TGameState, TMemoryContext> {
  build(input: {
    agent: Agent
    gameState: TGameState
    validActions: ActionSpec[]
    memoryContext: TMemoryContext
    systemPrompt: string
  }): { systemMessage: string; userMessage: string }
}

interface ResponseParser<TAction> {
  parse(rawText: string, validActions: ActionSpec[]): ParsedResponse<TAction>
  // 失败时返回 fallback action
}

interface BotStrategy<TGameState, TAction> {
  decide(gameState: TGameState, validActions: ActionSpec[]): TAction
}

interface MemoryModule<TWorking, TEpisodic, TSemantic> { ... }  // 见 6.2
```

狼人杀额外：`moderatorContextBuilder`（不用 parser，不用 memory）

### 6.2 记忆模块接口

```typescript
interface MemoryModule<TWorking, TEpisodic, TSemantic> {
  gameType: 'poker' | 'werewolf'

  initWorking(matchId: string, agentId: string): TWorking
  updateWorking(prev: TWorking, event: GameEvent): TWorking

  synthesizeEpisodic(
    working: TWorking,
    finalState: unknown,
    asObservedBy: string,
  ): TEpisodic

  updateSemantic(
    current: TSemantic | null,
    newEpisodic: TEpisodic,
  ): TSemantic

  buildMemoryContext(input: {
    working: TWorking
    allEpisodic: TEpisodic[]      // 全量（受 200 条硬上限自然截断）
    semanticByTarget: Map<string, TSemantic>
  }): MemoryContextSnapshot
  // 注：不接受 tokenBudget 参数，全量注入（见决策 #19）

  serialize: { working: (w: TWorking) => unknown; episodic: ...; semantic: ... }
  deserialize: { ... }
}
```

### 6.3 Poker 三层记忆

**Working Memory**：

```typescript
type PokerWorkingMemory = {
  matchActionsLog: PokerActionRecord[]   // 整个 match 全部动作，不截断
  currentHand: {
    handNumber: number
    actionsByStreet: Record<Phase, PokerActionRecord[]>
  }
}
```

**Episodic Memory**：

```typescript
type PokerEpisodicEntry = {
  handId: string
  observer: agentId
  target: agentId
  observedActions: string[]          // ["BTN open 3bb", "called 3bet", "folded to river"]
  outcome: 'won' | 'lost' | 'folded' | 'showdown'
  targetShowdownHand: Card[] | null
  summary: string                    // LLM 生成 ≤80 字
  tags: string[]                     // ["bluff", "value-bet", ...]
  createdAt: timestamp
}
```

**Semantic Memory**（沿袭现有 L/A/S/H）：

```typescript
type PokerSemanticProfile = {
  looseness: number     // 1-10, EMA
  aggression: number
  stickiness: number
  honesty: number
  note: string          // ≤30 字
  handCount: number
  lastUpdatedHandId: string
}
```

**EMA 参数**：α=0.3。冷启动（handCount=0）直接用 raw。

**poker buildMemoryContext 输出示例**：

```
## 对手画像
- Alice: L=5.3 A=7.1 S=4.2 H=3.0 | 强力进攻,爱3bet (42手观察)
- Bob:   L=2.1 A=3.0 S=2.8 H=8.5 | 紧弱玩家 (42手观察)

## 对手情景
- [#38 vs Alice] Alice river 过牌加注被我 call 摊出 7-high bluff
- [#41 vs Alice] Alice flop check-raise 后 turn barrel，我 fold AQ
- [#40 vs Bob]   Bob 从不 3bet，今天第一次 3bet，翻回 KK
... 全量注入，不裁剪

## 本手（#43）
- Preflop: Alice BTN raise 2→4, Bob SB fold, 我 BB call 4
- Flop [Kh 7d 2c]: check-check
- Turn [Js]: 现在你的行动
```

### 6.4 Werewolf 三层记忆（差异化）

**Working Memory**（承担主要推理）：

```typescript
type WerewolfWorkingMemory = {
  ownRole: WerewolfRole
  ownPrivateEvidence: {
    seerChecks?: SeerCheckResult[]       // 预言家：历次验人结果
    werewolfTeammates?: string[]          // 狼：同伴
    witchPotions?: { save: boolean; poison: boolean }
  }
  speechLog: SpeechRecord[]
  voteLog: VoteRecord[]
  deathLog: DeathRecord[]

  // 核心：本局对每个玩家的身份信念分布
  beliefState: Record<string, {
    werewolf: number    // 0-1
    villager: number
    seer: number
    witch: number
    reasoning: string[]                  // 最近 3 条推理原因
    lastUpdatedAt: { day: number; phase: string }
  }>
}
```

**beliefState 外化**：Agent 在 thinking 阶段**必须输出更新后的 beliefState**，ResponseParser 从 thinking 提取写回 working memory。面试话术："我让 Agent 把内部信念状态外化为显式输出，可观测可调试可评估。"

**Episodic Memory**：

```typescript
type WerewolfEpisodicEntry = {
  gameId: string
  observer: agentId
  actualRoles: Record<agentId, WerewolfRole>
  winnerFaction: 'werewolves' | 'villagers' | 'tie'
  ownOutcome: 'won' | 'lost'
  beliefAccuracy: Record<agentId, {
    finalBelief: Record<WerewolfRole, number>
    actualRole: WerewolfRole
    mostLikely: WerewolfRole
    correct: boolean
    confidenceCalibration: number
  }>
  keyMoments: string[]
  summary: string                        // ≤150 字
  tags: string[]
}
```

**Semantic Memory**（元画像）：

```typescript
type WerewolfSemanticProfile = {
  actingSkill: number                    // 1-10 演技
  reasoningDepth: number                 // 1-10 逻辑深度
  consistency: number                    // 1-10 前后一致

  asWerewolfStyle: {
    bluffTendency: number
    patience: number
    targetingPattern: string
  } | null
  asSeerStyle: {
    jumpTiming: 'early' | 'mid' | 'late' | 'varies'
    informationReveal: number
  } | null
  asWitchStyle: {
    saveTendency: number
    poisonTiming: 'early' | 'mid' | 'late' | 'varies'
  } | null
  asVillagerStyle: {
    suspicionBias: number
    followVoting: number
  } | null

  note: string                           // ≤30 字
  gamesObserved: number
  winLossRecord: {
    asWerewolf: [number, number]
    asSeer: [number, number]
    asVillager: [number, number]
    asWitch: [number, number]
  }
}
```

### 6.5 上下文注入策略（替代"token 预算"）

**原则**：全量注入，不做主动压缩，超过模型窗口则让 LLM API 原生报错 → fallback 到 BotStrategy。

**具体**：
- Working memory：整个 match 全部事件，不截断
- Episodic：observer 对 target（或全局）的全部历史（受"200 条硬上限自然封顶"，这是数据清理策略不是 prompt 策略）
- Semantic：观察者对所有在场对手的完整画像
- 规则 + 私密证据 + 当前状态 + 合法动作：全量

**长度约束仅作为生成质量约束**（而非节省 token）：
- `semantic.note` ≤ 30 字
- `episodic.summary` ≤ 80 字（poker）/ ≤ 150 字（werewolf）
- `moderator.narration` ≤ 80 字

**`max_tokens`（输出上限）**：跟随模型默认（通常 4-8k）。用户可在 APIProfile 里覆盖。

---

## 7. Game Master & Orchestration

### 7.1 Tick Loop 驱动：Self-Triggered Fetch

```typescript
export async function tickMatch(matchId: string): Promise<TickResult> {
  // 1. Redis 分布式锁，防并发 tick
  await acquireLock(`lock:match:${matchId}`, 60)

  try {
    const match = await loadMatch(matchId)
    if (match.status !== 'running') return { done: true }

    const engine = gameRegistry.get(match.gameType).engine
    const actorId = engine.currentActor(match.state)

    if (!actorId) return await handleBoundary(match, engine)

    const actor = await loadAgent(actorId)
    const memContext = await buildMemoryContextForActor(match, actorId)
    const message = buildA2AMessage(match, actorId, memContext)

    const decision = await requestAgentDecision(
      actor, message, match.token,
      (delta) => publishSSE(matchId, { kind: 'thinking-delta', agentId: actorId, delta }),
      match.config.agentTimeoutMs,
    )

    const validActions = engine.availableActions(match.state, actorId)
    const action = coerceToValidAction(decision, validActions)    // 三层校验

    const { nextState, events } = engine.applyAction(match.state, actorId, action)

    await appendEvents(matchId, events)
    await saveMatchState(matchId, nextState)
    for (const ev of events.filter(e => e.visibility === 'public'))
      publishSSE(matchId, { kind: 'event', event: ev })

    const boundary = engine.boundary(match.state, nextState)
    if (boundary === 'hand-end') await updateMemoryOnHandEnd(matchId, nextState)
    if (boundary === 'match-end') await finalizeMatch(matchId, nextState)

    return { done: boundary === 'match-end' }
  } finally {
    await releaseLock(`lock:match:${matchId}`)
  }
}

// Route Handler
// app/api/matches/[matchId]/tick/route.ts
export async function POST(req, { params }) {
  const result = await tickMatch(params.matchId)
  if (!result.done) {
    // 触发下一次 tick（不等待，返回本次 tick 结果）
    fetch(`${process.env.BASE_URL}/api/matches/${params.matchId}/tick`, { method: 'POST' })
      .catch(() => {})   // 失败不影响本次响应
  }
  return Response.json(result)
}
```

**为什么 self-triggered**：
- 不需长连接 handler（Next.js 友好）
- 不需独立 worker 进程（部署简单）
- 自然支持崩溃恢复（状态全在 Redis）
- 面试话术：**"我用 self-triggered tick loop 替代传统 worker，对局是 pull 模型的，状态在 Redis，任何进程都能接手。"**

### 7.2 Match 生命周期

```
[创建] POST /api/matches
  → 验证参数 → 建 matches + match_participants
  → 存 keyring 到 Redis
  → 引擎初始化 → 存 Redis
  → status='running' → 触发首次 tick
  → 返回 { matchId, streamUrl }

[进行中] self-triggered tick loop
  Spectator 通过 GET /api/matches/:id/stream 订阅 SSE

[完成] match-end boundary
  → engine.finalize() → 排名
  → 写 matches.finalRanking / winnerFaction
  → 所有 Agent 的 semantic memory 更新
  → status='completed'
  → Redis 保留 5 分钟供末观战 → 清理
  → keyring 立即清理

[异常]
  Agent 超时 / 响应解析失败 / 引擎 rejection
  → 按降级规则走（BotStrategy）
  → 记 agent_errors
  → 继续推进
  → 连续 3 次失败 → match='aborted_by_errors'
```

### 7.3 三层动作校验

```
第一层：结构化输出强约束
  Vercel AI SDK 的 generateObject + zod schema
  格式错 → SDK 自动 retry 1 次（built-in）→ 失败进第二层

第二层：模糊解析 + 容错映射
  ResponseParser 从自然语言提取
  模糊匹配：bet ≈ raise (poker), "投 Alice" ≈ vote Alice (werewolf)
  超额动作截断：raise > chips → allIn
  失败 → 进第三层

第三层：降级到 BotStrategy
  游戏自己的规则 Bot
  poker：简单胜率阈值
  werewolf：随机 / 跟大流
  永远返回合法动作
```

每层失败都写 `agent_errors`。观战 UI 有 Badge 显示 fallback 次数。

### 7.4 超时配置

```typescript
type MatchConfig = {
  agentTimeoutMs: number           // 默认 60000，=0 表示不限时
  minActionIntervalMs: number      // 默认 1000，决策完后的等待
  tickConcurrencyLockMs: number    // 默认 60000
}
```

### 7.5 多对局隔离

- 每 match 独立 `X-Match-Token`
- Redis key prefix：`match:<matchId>:*`
- Working memory 主键 `(observer_agent_id, match_id)`，不串扰

---

## 8. 数据库 Schema

### 8.1 Postgres Schema（生产）

```typescript
// lib/db/schema.pg.ts

// 1. API Profile
export const apiProfiles = pgTable('api_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  providerId: text('provider_id').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  temperature: integer('temperature').notNull().default(70),  // × 100 (避免浮点；0.70 存 70)；兼容 SQLite
  maxTokens: integer('max_tokens'),                            // null = 跟随模型默认
  contextWindowTokens: integer('context_window_tokens'),       // 参考值（从 catalog 同步）；仅作观测信息展示，不做 prompt 侧裁剪
  createdAt: timestamp('created_at').defaultNow(),
})
// apiKey 不入库

// 2. Agents
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  gameType: text('game_type', { enum: ['poker', 'werewolf'] }).notNull(),
  kind: text('kind', { enum: ['player', 'moderator'] }).notNull().default('player'),
  profileId: uuid('profile_id').notNull().references(() => apiProfiles.id),
  systemPrompt: text('system_prompt').notNull(),
  avatarEmoji: text('avatar_emoji'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('agents_game_type_kind_idx').on(t.gameType, t.kind),
])

// 3. Matches
export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameType: text('game_type', { enum: ['poker', 'werewolf'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'errored', 'aborted_by_errors']
  }).notNull(),
  config: jsonb('config').notNull(),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
  winnerFaction: text('winner_faction'),
  finalRanking: jsonb('final_ranking'),
  stats: jsonb('stats'),
})

// 4. Match Participants
export const matchParticipants = pgTable('match_participants', {
  matchId: uuid('match_id').notNull().references(() => matches.id),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  seatIndex: integer('seat_index').notNull(),
  initialData: jsonb('initial_data'),
}, (t) => [
  primaryKey({ columns: [t.matchId, t.agentId] }),
  index('match_participants_match_idx').on(t.matchId),
])

// 5. Game Events
export const gameEvents = pgTable('game_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').notNull().references(() => matches.id),
  seq: integer('seq').notNull(),
  occurredAt: timestamp('occurred_at').defaultNow(),
  kind: text('kind').notNull(),
  actorAgentId: uuid('actor_agent_id'),
  payload: jsonb('payload').notNull(),
  visibility: text('visibility', {
    enum: ['public', 'role-restricted', 'private']
  }).notNull().default('public'),
  restrictedTo: jsonb('restricted_to'),   // string[] | null
}, (t) => [
  index('game_events_match_seq_idx').on(t.matchId, t.seq),
])

// 6. Agent Errors
export const agentErrors = pgTable('agent_errors', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').notNull(),
  agentId: uuid('agent_id').notNull(),
  occurredAt: timestamp('occurred_at').defaultNow(),
  layer: text('layer', {
    enum: ['http', 'structured', 'parse', 'validate', 'fallback']
  }).notNull(),
  errorCode: text('error_code').notNull(),
  rawResponse: text('raw_response'),       // 截 2000 字
  recoveryAction: jsonb('recovery_action'),
})

// 7-9. Memory（跨游戏共享三张表）
export const workingMemory = pgTable('working_memory', {
  observerAgentId: uuid('observer_agent_id').notNull(),
  matchId: uuid('match_id').notNull(),
  gameType: text('game_type', { enum: ['poker', 'werewolf'] }).notNull(),
  stateJson: jsonb('state_json').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.observerAgentId, t.matchId] }),
])

export const episodicMemory = pgTable('episodic_memory', {
  id: uuid('id').primaryKey().defaultRandom(),
  observerAgentId: uuid('observer_agent_id').notNull(),
  targetAgentId: uuid('target_agent_id'),   // null = whole-match entry
  matchId: uuid('match_id').notNull(),
  gameType: text('game_type', { enum: ['poker', 'werewolf'] }).notNull(),
  entryJson: jsonb('entry_json').notNull(),
  tags: jsonb('tags'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('episodic_observer_target_idx').on(t.observerAgentId, t.targetAgentId, t.gameType, t.createdAt),
  index('episodic_observer_gametype_idx').on(t.observerAgentId, t.gameType, t.createdAt),
])

export const semanticMemory = pgTable('semantic_memory', {
  observerAgentId: uuid('observer_agent_id').notNull(),
  targetAgentId: uuid('target_agent_id').notNull(),
  gameType: text('game_type', { enum: ['poker', 'werewolf'] }).notNull(),
  profileJson: jsonb('profile_json').notNull(),
  gamesObserved: integer('games_observed').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.observerAgentId, t.targetAgentId, t.gameType] }),
])
```

### 8.2 SQLite Schema（开发）

差异：
- `jsonb` → `text({ mode: 'json' })`
- `timestamp` → `integer({ mode: 'timestamp' })`
- `uuid` → `text` + 应用层生成 UUID

`DB_DRIVER` env 切换 schema 文件和驱动。

### 8.3 Redis 键空间

```
match:<matchId>:state                      JSON GameState, TTL 24h
match:<matchId>:token                      String match token, TTL 24h
match:<matchId>:keyring                    Hash {profileId → apiKey}, TTL 2h
match:<matchId>:memory:<agentId>:working   JSON Working Memory, TTL 24h
channel:match:<matchId>                    Pub/Sub (SSE 广播)
lock:match:<matchId>                       NX EX 60
```

### 8.4 SSE 流转路径

浏览器的 `GET /api/matches/:id/stream` Route Handler 内部：

1. 通过 `ioredis` 的 `subscribe` 订阅 `channel:match:<matchId>`
2. 把每条 Pub/Sub 消息转成 SSE `data:` 行 `write` 到 Response 流
3. 客户端 `disconnect` / `AbortController.abort()` 时，unsubscribe 并 close

Game Master 的 `publishSSE()` 底层用 `ioredis.publish('channel:match:<id>', JSON.stringify(event))`。

**这样设计的好处**：GM 和 Stream Handler 不需要在同一进程。未来 GM 可拆到 worker，Stream Handler 依然在 Next.js 里。

### 8.5 Match Token 生命周期

- **生成**：`POST /api/matches` 创建 match 时，用 `crypto.randomUUID() + crypto.randomUUID()` 拼成 64 字符 token
- **存储**：Redis `match:<matchId>:token`，TTL = 24h（match 完成后立即 delete）
- **验证**：Agent endpoint `validateMatchToken(token, agentId)` 做两件事：
  1. `GET match:<matchId>:token` 比较
  2. 确认 agentId 是本 match 的参与者（查 Redis state 里的 participants）
- **暴露给 client**：仅传给 GM 用于 A2A Client 调用，**不返回给浏览器**（浏览器只需要 matchId）

### 8.4 SSE 流转路径

浏览器的 `GET /api/matches/:id/stream` Route Handler 内部：

1. 通过 `ioredis` 的 `subscribe` 订阅 `channel:match:<matchId>`
2. 把每条 Pub/Sub 消息转成 SSE `data:` 行 `write` 到 Response 流
3. 客户端 `disconnect` / `AbortController.abort()` 时，unsubscribe 并 close

Game Master 的 `publishSSE()` 底层用 `ioredis.publish('channel:match:<id>', JSON.stringify(event))`。

**这样设计的好处**：GM 和 Stream Handler 不需要在同一进程。未来 GM 可拆到 worker，Stream Handler 依然在 Next.js 里。

### 8.5 Match Token 生命周期

- **生成**：`POST /api/matches` 创建 match 时，用 `crypto.randomUUID() + crypto.randomUUID()` 拼成 64 字符 token
- **存储**：Redis `match:<matchId>:token`，TTL = 24h（match 完成后立即 delete）
- **验证**：Agent endpoint `validateMatchToken(token, agentId)` 做两件事：
  1. `GET match:<matchId>:token` 比较
  2. 确认 agentId 是本 match 的参与者（查 Redis state 里的 participants）
- **暴露给 client**：仅传给 GM 用于 A2A Client 调用，**不返回给浏览器**（浏览器只需要 matchId）

### 8.4 数据生命周期

| 数据 | 保留时长 |
|---|---|
| apiProfiles, agents | 永久 |
| matches (completed) | 永久 |
| matches (errored / aborted) | 7 天清理 |
| matchParticipants | 随 matches |
| gameEvents | **永久**（为 Phase 5 回放） |
| agentErrors | 30 天 |
| workingMemory | match 完成时清除（Redis TTL + Postgres delete） |
| episodicMemory | 每 (observer, target) 保留最近 200 条，自动清旧 |
| semanticMemory | 永久（EMA 持续更新） |

---

## 9. 前端结构

### 9.1 页面地图

```
app/
├── layout.tsx
├── page.tsx                       # Lobby
├── agents/page.tsx                # Agent CRUD
├── profiles/page.tsx              # APIProfile CRUD
├── matches/
│   ├── new/page.tsx               # 建新对局（选游戏/Agent/参数）
│   └── [matchId]/page.tsx         # 观战（进行中或已结束都走这里）
└── api/ (见第 4 节、第 8 节)
```

### 9.2 观战页（最复杂）

```
┌─────────────────────────────────────────────────────────┐
│ Header: "德州扑克 · #43 · Preflop"  ⏱                   │
├─────────────────────────────────────────────────────────┤
│ ┌───────────────┐  ┌───────────────────────────────┐  │
│ │               │  │ LiveScoreboard                │  │
│ │  GameBoard    │  │ Alice $120 ↑ / Bob $98 ↓ ...  │  │
│ │  (poker/      ├──┤                               │  │
│ │   werewolf    │  │ ChipChart (poker only)        │  │
│ │   各有各的)   │  │                               │  │
│ │               │  │ ActionLog [日志][思考链]tabs  │  │
│ └───────────────┘  └───────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

SSE 四类事件：
- `game-event` → 更新 GameBoard + ActionLog
- `thinking-delta` → 更新 ThinkingBubble
- `agent-action-ready` → 播 action 动画
- `match-end` → 弹 RankingPanel

### 9.3 GameBoard 两套实现

```
games/poker/ui/
  PokerBoard.tsx
  PlayerSeat.tsx, Card.tsx, BetChip.tsx,
  CommunityCards.tsx, Pot.tsx

games/werewolf/ui/
  WerewolfBoard.tsx
  PlayerCard.tsx, SpeechBubble.tsx,
  NightOverlay.tsx, VotePanel.tsx, DeathMarker.tsx
```

观战页通过 `gameRegistry.get(gameType).BoardComponent` 动态选择。

### 9.4 Zustand（仅 Client Component）

```typescript
// store/profile-store.ts - localStorage persist
type ProfileStore = {
  profiles: APIProfile[]                 // 服务端 + localStorage key
  keys: Record<profileId, string>        // 仅 localStorage
  loadFromServer(): Promise<void>
  setKey(profileId, key): void
}

// store/match-view-store.ts - session 级
type MatchViewStore = {
  matchId: string
  events: GameEvent[]
  thinkingByAgent: Record<agentId, string>
  scores: Array<{ agentId; current; delta }>
  chipHistory: Array<{ hand; chips: Record<agentId, number> }>   // poker only
  subscribeSse(url): () => void
}
```

Server Component 和 Route Handler 直接 await DB，不用 store。

### 9.5 shadcn/ui

按需复制（不全量安装）：Button / Input / Dialog / Select / Tabs / Card / Avatar / Badge / Progress / Tooltip。复制到 `components/ui/`。

### 9.6 动画（Framer Motion）

仅关键事件：
- 发底牌（stagger 200ms）
- 公共牌翻出（Y 轴 180°）
- 下注筹码飞向底池
- 赢池筹码散落
- 死亡闪烁 + 灰化（werewolf）
- 发言打字机（werewolf）
- Thinking bubble fade-in + 呼吸
- 回合高亮 ring + pulse

Framer Motion `layout` prop 用于筹码变化、排名变化自动位移。

### 9.7 老项目视觉复用清单

| 老资产 | 新项目去向 |
|---|---|
| Tailwind MD3 tokens (`styles/index.css`) | 直接抄 |
| 牌桌椭圆 + 6 座位 + 中央公共区 | 参考 |
| PlayerSeat 视觉（头像/筹码/hole cards） | 视觉抄，业务重写 |
| ThinkingBubble backdrop-blur + 箭头 | 抄 |
| 卡牌 CSS | 抄 |
| 回合高亮 ring + pulse | 抄 |
| LiveRanking / ChipChart / RankingPanel | 抄视觉，换数据源 |
| PlayerActionLog tabs | 抄 |
| `@floating-ui/react` 智能气泡定位 | 保留 |

---

## 10. 错误处理、超时、观测性

### 10.1 错误分类总表

| 发生地 | 错误类型 | 处理 | 记录位置 |
|---|---|---|---|
| Agent HTTP | network / 5xx / 超时 | retry 1 → fallback | `agent_errors.layer='http'` |
| LLM SDK | structured output 格式 | SDK auto retry 1 → fallback | `layer='structured'` |
| ResponseParser | 提取失败 | fallback | `layer='parse'` |
| Engine validation | action 非法 | coerce / fallback | `layer='validate'` |
| BotStrategy | 理论不失败 | 硬降级到 action spec 首项 | `layer='fallback'` |
| Redis 断线 | tick 时命中 | match → errored | `matches.status` |
| Postgres 断线 | tick 时命中 | retry 1 → stderr 不中止 | stderr |
| 连续 3 次 agent_errors | - | match → aborted_by_errors | `matches.status` |

### 10.2 观测性

- **结构化 JSON 日志到 stdout**（Docker 收集）
- **对局观战页 Badge**：X 次 fallback，点开看错误列表
- **赛后 RankingPanel**：每个 Agent 的总调用 / 平均 latency / fallback 次数 / 累计 token

---

## 11. 测试策略

```
单元测试（Vitest，最多，最快，最稳）
├── games/poker/engine/__tests__/
│     shuffle / 发牌 / action apply / evaluator / equity / pot-manager
├── games/werewolf/engine/__tests__/
│     角色分配 / 夜间交互 / 发言队列 / 胜利判定 / 边界
├── lib/memory/__tests__/ EMA 数学 / 200 条清理
├── lib/orchestrator/__tests__/ tick 推进 / 三层 fallback / 边界触发
└── games/**/agent/__tests__/ Response parser 模糊匹配 / 超额截断

集成测试（Vitest + msw，次要）
├── A2A endpoint 端到端（mock LLM）
├── Match lifecycle（Bot Profile 跑完整局）

E2E（Playwright，最少但必须）
└── happy path：建 Profile → 建 Agent → 开局 poker → 跑完 → RankingPanel
```

目标：单测 pass 100%，引擎覆盖率 ≥ 90%。

---

## 12. 部署

### 12.1 Docker Compose

```yaml
# ops/deploy/docker-compose.yml
services:
  nextjs:
    build: { context: ../.., dockerfile: ops/deploy/Dockerfile }
    environment:
      - DATABASE_URL=postgres://arena:${DB_PASSWORD}@postgres:5432/arena
      - REDIS_URL=redis://redis:6379
      - BASE_URL=${BASE_URL}
      - NODE_ENV=production
    depends_on: [postgres, redis]
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=arena
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=arena
    volumes: [pgdata:/var/lib/postgresql/data]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes: [redisdata:/data]
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [nextjs]
    restart: unless-stopped

volumes: { pgdata: {}, redisdata: {}, caddy_data: {}, caddy_config: {} }
```

### 12.2 Caddyfile

```
# 阶段 1（无域名）
:80 {
  reverse_proxy nextjs:3000
}

# 阶段 2（有域名）
# your-domain.com {
#   reverse_proxy nextjs:3000
# }
```

### 12.3 Dockerfile 多阶段

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### 12.4 Migrations

- 本地：`drizzle-kit generate` → 生成 SQL → `drizzle-kit migrate` 应用
- 生产：Next.js 容器 entry point 启动时自动 `drizzle-kit migrate`
- **禁止** `drizzle-kit push` 到生产

### 12.5 备份

```bash
# /etc/cron.d/poker-arena-backup
0 3 * * * root docker exec poker-arena-postgres-1 pg_dump -U arena arena | gzip > /var/backups/arena-$(date +\%F).sql.gz && find /var/backups/ -mtime +14 -delete
```

### 12.6 Vercel Fallback

- DB → Supabase（同 Drizzle postgres 驱动，换 `DATABASE_URL`）
- Redis → Upstash（加 adapter 层）
- 所有 Route Handler `export const runtime = 'nodejs'`
- `vercel.json` 一个即可

---

## 13. 项目目录结构

```
colosseum/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                              # Lobby
│   ├── agents/page.tsx
│   ├── profiles/page.tsx
│   ├── matches/
│   │   ├── new/page.tsx
│   │   └── [matchId]/page.tsx
│   └── api/
│       ├── agents/
│       │   ├── route.ts
│       │   └── [agentId]/
│       │       ├── .well-known/agent-card.json/route.ts
│       │       ├── message:send/route.ts
│       │       ├── message:stream/route.ts
│       │       └── tasks/[taskId]/route.ts
│       ├── matches/
│       │   ├── route.ts
│       │   └── [matchId]/
│       │       ├── route.ts
│       │       ├── tick/route.ts
│       │       └── stream/route.ts
│       ├── profiles/route.ts
│       └── providers/route.ts
│
├── games/
│   ├── poker/
│   │   ├── engine/
│   │   │   ├── poker-engine.ts
│   │   │   ├── deck.ts, evaluator.ts, equity.ts, pot-manager.ts
│   │   │   └── __tests__/
│   │   ├── agent/
│   │   │   ├── context-builder.ts
│   │   │   ├── response-parser.ts
│   │   │   ├── bot-strategy.ts
│   │   │   └── preflop-ranges.ts
│   │   ├── memory/
│   │   │   ├── working.ts, episodic.ts, semantic.ts, ema.ts
│   │   ├── ui/
│   │   │   ├── PokerBoard.tsx, PlayerSeat.tsx, ...
│   │   └── poker-plugin.ts
│   └── werewolf/
│       ├── engine/
│       │   ├── werewolf-engine.ts
│       │   ├── role-assignment.ts, vote-resolver.ts
│       │   └── __tests__/
│       ├── agent/
│       │   ├── player-context-builder.ts
│       │   ├── moderator-context-builder.ts
│       │   ├── response-parser.ts
│       │   ├── bot-strategy.ts
│       │   └── belief-update.ts
│       ├── memory/
│       │   ├── working.ts, episodic.ts, semantic.ts
│       ├── ui/
│       │   ├── WerewolfBoard.tsx, PlayerCard.tsx, SpeechBubble.tsx, ...
│       └── werewolf-plugin.ts
│
├── lib/
│   ├── db/
│   │   ├── schema.pg.ts
│   │   ├── schema.sqlite.ts
│   │   ├── client.ts
│   │   └── migrations/
│   ├── redis/client.ts
│   ├── llm/
│   │   ├── provider-factory.ts
│   │   └── catalog.ts
│   ├── a2a-core/
│   │   ├── client.ts
│   │   ├── server-helpers.ts
│   │   └── types.ts
│   ├── orchestrator/
│   │   ├── game-master.ts
│   │   ├── match-lifecycle.ts
│   │   ├── action-validator.ts
│   │   └── __tests__/
│   ├── memory/
│   │   ├── contracts.ts
│   │   └── registry.ts
│   ├── engine/contracts.ts
│   └── registry/game-registry.ts
│
├── components/
│   ├── ui/                                    # shadcn，按需 copy
│   ├── common/
│   │   ├── ThinkingBubble.tsx
│   │   ├── LiveScoreboard.tsx
│   │   ├── ChipChart.tsx
│   │   ├── RankingPanel.tsx
│   │   └── ActionLog.tsx
│   └── layout/Sidebar.tsx
│
├── store/
│   ├── profile-store.ts
│   └── match-view-store.ts
│
├── ops/deploy/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── README.md
│
├── docs/superpowers/specs/
│   └── 2026-05-06-colosseum-rewrite-design.md    # 本 spec
│
├── drizzle.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## 14. Phase 划分

不设时间盒，但实施顺序必须明确。每 Phase 有可演示里程碑。

### Phase 0 — 骨架
- Next.js 15 项目初始化（App Router / Tailwind 4 / shadcn 按需）
- Drizzle schema（SQLite dev 版优先跑通）
- Vercel AI SDK + provider factory
- `@a2a-js/sdk` 基础封装
- **本地开发模式**：`npm run dev` 本机起 Next.js（热更新）；Postgres / Redis 用 docker compose 起，Next.js **不入容器**（开发体验优先）
- 单独一个 `docker-compose.prod.yml` 用于生产镜像构建和集成测试

**里程碑**：Hello World Route Handler 调通 LLM；A2A SDK 启动 toy agent 并响应。

### Phase 1 — Poker MVP
- Poker 引擎（抄老代码 + 按新接口重写）
- Poker Agent（ContextBuilder / Parser / BotStrategy）
- Poker Memory 三层（EMA 同老项目）
- Game Master + tick loop + 三层校验
- 观战页（基础渲染 + SSE）
- 牌桌 UI（抄视觉）
- 赛后 RankingPanel + ChipChart

**里程碑**：6 个 LLM Agent 自主打完一局德扑，观众看到实时思考链 + 筹码图 + 最终排名。

### Phase 2 — A2A 正规化 + 多对局
- Agent 端点升级到 A2A v0.3 规范完整合规
- Agent Card 发布端点
- JSON-RPC 严格遵循
- 并发多对局不串扰
- agent_errors 全链路记录 + 观战面板 Badge

**里程碑**：curl 能读 Agent Card；同时跑 2 个对局；错误面板可见 fallback 记录。

### Phase 3 — Werewolf
- Werewolf 引擎（昼夜 / 投票 / 角色 / 胜负）
- ModeratorAgent + moderatorContextBuilder
- Werewolf Agent（beliefState 外化）
- Werewolf Memory 三层（元画像）
- Werewolf UI（PlayerCard 网格 + SpeechBubble）
- 赛后胜率面板

**里程碑**：狼 2 神 2 民 2 + 1 Moderator 打完一局狼人杀；观众看到完整发言 timeline + 角色揭露。

### Phase 4 — 生产部署
- Docker compose + Caddy（云服务器）
- Postgres 生产 schema
- 备份 cron
- nip.io 或 IP 访问
- 演示视频

**里程碑**：公网 URL 可访问；录屏可演示。

### Phase 5（可选）— Polish
- 回放播放器 UI（gameEvents 已有数据）
- shadcn 组件精修
- Vercel fallback 部署（一条命令备用链接）
- 移动端适配（延后）

---

## 15. 风险与应对

| 风险 | 应对 |
|---|---|
| @a2a-js/sdk API 与我理解有偏差 | Phase 0 先起 toy agent 跑通一个调用链，再开工 Phase 1 |
| self-triggered tick loop 在 Next.js 里有隐藏坑 | Phase 1 用简单 setInterval worker 兜底，Phase 2 再切 self-fetch |
| LLM API 费用过高 | 默认 BotStrategy 可对 LLM Agent，演示时用 DeepSeek / Moonshot 低价模型 |
| 狼人杀 Agent 决策不可靠（语言推理偏软） | beliefState 外化 + 三层校验 + 40 天平局上限防死循环 |
| 服务器宕了面试没地方演示 | Phase 5 把 Vercel fallback 做起来，两条路线同时在线 |
| 数据库备份损坏 | 保留 14 天 + 每周手动把最新一份 copy 到本地机器 |

---

## 16. 面试话术预备（基于本设计可直接讲）

- **项目一句话定位**：
  > "我做了一个符合 Google A2A 协议的多 Agent 博弈竞技平台——Agent 之间通过标准 A2A 端点通信，支持德州扑克和狼人杀两种博弈场景，有完整的三层记忆系统、三层动作校验和 Docker 生产部署。"

- **A2A 亮点**：
  > "每个 Agent 基于官方 @a2a-js/sdk 实现 AgentExecutor，暴露在 Next.js Route Handler。Game Master 用 A2AClient 通过 JSON-RPC 调用，长任务走 SSE 流式推送。因为走标准 A2A，我的 Agent 能和生态任何 A2A 合规的外部 Agent（包括 Python）互操作。"

- **记忆系统亮点**：
  > "三层记忆架构：工作记忆是本局完整事件日志，情景记忆是跨局结构化复盘，语义记忆是对手长期画像。不用向量检索——博弈场景对手行为可量化，结构化维度（德扑 L/A/S/H，狼人杀元画像）比 embedding 更可解释、更稳定、更省 token。"

- **Orchestration 亮点**：
  > "Game Master 伪无状态，self-triggered tick loop 替代 worker 进程——每次 tick 结束触发下一次 tick，状态全在 Redis，任何进程都能接手。"

- **工程化亮点**：
  > "三层动作校验（structured output → fuzzy parse → BotStrategy fallback），agent_errors 全链路记录，观战 UI 可见 fallback 次数。这是 12-Factor Agents 的直接落地。"

- **多 Agent 编排亮点（狼人杀）**：
  > "狼人杀常驻一个 ModeratorAgent 作为法官，和 6 个 Player Agent 同样走 A2A 协议通信。这是 AutoGen GroupChat 模式的 A2A 原生实现。"

---

## 17. 后续步骤

1. **用户审阅本 spec**（下一步）
2. 批准后 → 调用 `superpowers:writing-plans` skill 生成可执行 implementation plan
3. 按 Phase 顺序实施，每 Phase 完成后跑 `superpowers:requesting-code-review`
