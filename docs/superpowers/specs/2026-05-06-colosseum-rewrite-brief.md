# Colosseum 重写 · 简要设计（Mermaid 图版）

> 日期：2026-05-06
> 状态：简要版（审阅用），完整版见 `2026-05-06-colosseum-rewrite-design.md`

---

## 1. 项目是什么

**一个纯 AI 博弈竞技平台。** 观众在浏览器里配 LLM → 开一局比赛 → 看多个 Agent 自主博弈 → 看赛后排名。

```mermaid
flowchart LR
  U[观众用户] -->|配 Profile / 开局| Web[Colosseum Web Server]
  Web -->|A2A 协议| Agents[多个 Agent<br/>同进程 Route Handler]
  Agents -->|LLM API| Providers[OpenAI / DeepSeek / Claude / Moonshot / ...]
  Web --> PG[(Postgres<br/>持久化)]
  Web --> RD[(Redis<br/>活动对局)]
  U <-.SSE 实时观战.-> Web
```

---

## 2. 19 条锁定决策

```mermaid
flowchart LR
  subgraph A["基础底座"]
    direction TB
    D01["#1 重写范围<br/>一次性完整重写"]
    D02["#2 技术栈<br/>Next.js 15 + TS + Tailwind 4"]
    D05["#5 数据库<br/>Drizzle + SQLite/Postgres"]
    D06["#6 Redis<br/>活动对局与锁"]
    D16["#16 部署<br/>Docker Compose + Caddy<br/>Vercel fallback"]
  end

  subgraph B["Agent 与模型"]
    direction TB
    D03["#3 A2A<br/>@a2a-js/sdk 官方实现"]
    D04["#4 LLM 调用<br/>Vercel AI SDK"]
    D07["#7 Agent 形态<br/>同进程 Route Handler"]
    D18["#18 Moderator<br/>狼人杀系统级 Agent"]
    D19["#19 Token 策略<br/>全量注入，不主动压缩"]
  end

  subgraph C["游戏与体验"]
    direction TB
    D08["#8 游戏模式<br/>德扑 + 简化狼人杀"]
    D09["#9 用户控制<br/>纯观战，无暂停/单步"]
    D10["#10 可观察性<br/>上帝视角 + 思考链日志"]
    D12["#12 实时面板<br/>计分板 + 筹码图"]
    D14["#14 UI 渲染<br/>React 19 + Tailwind + Motion"]
  end

  subgraph D["规则与长期能力"]
    direction TB
    D11["#11 结算<br/>筹码 / 胜率，无 ELO"]
    D13["#13 记忆系统<br/>三层共享架构 + 游戏自治"]
    D15["#15 回放<br/>MVP 不做 UI，事件全落库"]
    D17["#17 时间盒<br/>不设"]
  end
```

---

## 3. 五层架构

```mermaid
flowchart TD
  L1[L1 UI 层<br/>Server + Client 组件]
  L2[L2 Route Handler 层<br/>HTTP 边界 / A2A 端点 / SSE]
  L3[L3 业务协调<br/>Game Master + A2A Client + Memory]
  L4[L4 游戏域层<br/>每游戏自治：引擎 / Agent / 记忆 / UI]
  L5[L5 基础设施<br/>DB / Redis / LLM SDK / A2A SDK]

  L1 -->|依赖| L2
  L2 -->|依赖| L3
  L3 -->|依赖| L4
  L3 -->|依赖| L5
  L4 -->|依赖| L5

  style L1 fill:#e3f2fd
  style L2 fill:#fff3e0
  style L3 fill:#f3e5f5
  style L4 fill:#e8f5e9
  style L5 fill:#fce4ec
```

**铁律**：依赖方向严格向下，不允许反向或跨层跳过。以 ESLint import 规则 + CI 强制。

---

## 4. 游戏自治原则

每个游戏拥有完整的一套（禁止跨游戏 if/else 共享）：

```mermaid
flowchart LR
  subgraph 平台共享[平台共享基础设施]
    A[GameEngine 契约]
    B[MemoryModule 契约]
    C[A2A Core / LLM SDK]
    D[Game Master / Tick Loop]
    E[通用 UI 组件<br/>ThinkingBubble / ActionLog / Scoreboard]
  end

  subgraph 德扑自治[games/poker/]
    P1[engine]
    P2[agent context+parser+bot]
    P3[memory 三层]
    P4[ui 牌桌组件]
    P5[plugin]
  end

  subgraph 狼人杀自治[games/werewolf/]
    W1[engine]
    W2[agent player+moderator]
    W3[memory 三层]
    W4[ui 玩家卡+发言气泡]
    W5[plugin]
  end

  平台共享 --> 德扑自治
  平台共享 --> 狼人杀自治
```

---

## 5. 一手对局的端到端数据流

```mermaid
sequenceDiagram
  autonumber
  participant U as 观众浏览器
  participant GM as Game Master (L3)
  participant Eng as 游戏引擎 (L4)
  participant Mem as MemoryModule (L4)
  participant AC as A2A Client (L3)
  participant AE as Agent Endpoint (L2)
  participant LLM as LLM API (外部)
  participant DB as Postgres
  participant RD as Redis

  U->>GM: POST /api/matches (创建对局)
  GM->>DB: 建 matches + participants
  GM->>RD: 存 keyring + GameState
  GM-->>U: 返回 matchId + streamUrl

  U->>GM: GET /api/matches/:id/stream (SSE)
  GM->>RD: SUBSCRIBE channel:match:id

  loop 每次 Tick（self-triggered）
    GM->>RD: 锁 + 加载 GameState
    GM->>Eng: currentActor()
    Eng-->>GM: actorId
    GM->>Mem: buildMemoryContext()
    Mem->>DB: 读三层记忆
    Mem-->>GM: memoryContext
    GM->>AC: requestAgentDecision(agent, message)
    AC->>AE: POST /agents/:id/message:stream
    AE->>DB: 加载 Agent 配置
    AE->>LLM: streamText(model, messages)
    LLM-->>AE: SSE thinking deltas
    AE-->>AC: A2A artifact-update (text)
    AC-->>GM: onThinking callback
    GM-->>RD: publishSSE thinking-delta
    RD-->>U: 实时思考气泡
    LLM-->>AE: 最终文本
    AE->>AE: ResponseParser 解析 action
    AE-->>AC: A2A artifact-update (data)
    AC-->>GM: decision
    GM->>GM: 三层校验 coerce action
    GM->>Eng: applyAction(state, action)
    Eng-->>GM: nextState + events
    GM->>DB: 写 game_events
    GM->>RD: 保存 nextState + publishSSE events
    RD-->>U: 动作事件
    alt 手结束
      GM->>Mem: synthesizeEpisodic + updateSemantic
      Mem->>DB: 写 episodic + semantic memory
    end
    alt 对局结束
      GM->>Eng: finalize() → ranking
      GM->>DB: 写 finalRanking + status=completed
      GM-->>U: SSE match-end → RankingPanel
    end
  end
```

---

## 6. A2A 层三部分

```mermaid
flowchart TB
  subgraph A[A: Agent Card 资源]
    A1["/api/agents/:id/.well-known/<br/>agent-card.json"]
  end

  subgraph B[B: Agent Server 端点]
    B1["POST message:send 非流式"]
    B2["POST message:stream SSE"]
    B3["GET tasks/:taskId 查询"]
  end

  subgraph C[C: A2A Client GM 侧]
    C1[A2AClient 封装]
    C2[超时 AbortController]
    C3[重试 1 次]
    C4[响应校验]
  end

  GM[Game Master] -->|发起| C1
  C1 -->|fetch| B2
  B2 -->|读取| LLM[Vercel AI SDK]
  LLM -->|流式| B2
  B2 -->|ResponseParser| B2
  B2 -->|SSE artifact| C1

  注[Agent Endpoint 铁律：<br/>禁止 import GM 或其他 Agent 的内存结构<br/>所有上下文来自 HTTP body]
```

**关键概念分离**：

```mermaid
flowchart LR
  Profile[APIProfile<br/>例：我的 GPT-4o 低温<br/>含 baseUrl + model]
  Agent1[Agent: BluffMaster<br/>绑 Profile + 德扑人设]
  Agent2[Agent: TightAlice<br/>绑 Profile + 德扑稳健人设]
  Agent3[Agent: Moderator<br/>绑 Profile + 狼人杀法官]

  Profile --> Agent1
  Profile --> Agent2
  Profile --> Agent3
```

**一个 Profile 可被多个 Agent 共用**。Agent 有 `gameType` 和 `kind (player/moderator)`。

---

## 7. 记忆系统三层

```mermaid
flowchart TB
  subgraph 共享层[平台共享接口]
    I[MemoryModule 契约<br/>initWorking / updateWorking<br/>synthesizeEpisodic<br/>updateSemantic<br/>buildMemoryContext]
    T1[(working_memory<br/>跨游戏共用表<br/>JSONB)]
    T2[(episodic_memory<br/>跨游戏共用表<br/>JSONB)]
    T3[(semantic_memory<br/>跨游戏共用表<br/>JSONB)]
  end

  subgraph 德扑记忆[Poker MemoryModule]
    PW[Working:<br/>本局完整 action log]
    PE[Episodic:<br/>每手对每对手复盘<br/>summary 80 字]
    PS[Semantic:<br/>L/A/S/H 四维 EMA]
  end

  subgraph 狼人杀记忆[Werewolf MemoryModule]
    WW[Working:<br/>发言+投票+信念状态<br/>beliefState 外化]
    WE[Episodic:<br/>每局完整复盘<br/>信念准确度评估]
    WS[Semantic:<br/>跨角色元画像<br/>演技/逻辑/一致性]
  end

  I --> 德扑记忆
  I --> 狼人杀记忆
  德扑记忆 -.JSONB 序列化.-> T1
  德扑记忆 -.JSONB 序列化.-> T2
  德扑记忆 -.JSONB 序列化.-> T3
  狼人杀记忆 -.JSONB 序列化.-> T1
  狼人杀记忆 -.JSONB 序列化.-> T2
  狼人杀记忆 -.JSONB 序列化.-> T3
```

**策略**：全量注入，不做主动压缩；超过模型窗口让 LLM API 原生报错，fallback 到 BotStrategy。

---

## 8. 三层动作校验

```mermaid
flowchart TD
  Start[Agent 决策请求] --> L1{第一层<br/>Structured Output}
  L1 -->|成功| Valid[Action Validator]
  L1 -->|失败<br/>SDK 重试 1 次仍失败| L2{第二层<br/>ResponseParser<br/>模糊匹配}
  L2 -->|成功| Valid
  L2 -->|失败<br/>无法提取| L3{第三层<br/>BotStrategy<br/>规则兜底}
  L3 --> Valid

  Valid -->|合法| Apply[applyAction]
  Valid -->|非法| Coerce[coerce 或 fold/default]
  Coerce --> Apply

  L1 -.记录.-> Err[(agent_errors)]
  L2 -.记录.-> Err
  L3 -.记录.-> Err

  style L1 fill:#c8e6c9
  style L2 fill:#fff59d
  style L3 fill:#ffab91
```

每层失败都写 `agent_errors`。观战页 Badge 显示本局 fallback 次数。

---

## 9. 狼人杀特有：Moderator Agent

```mermaid
flowchart LR
  GM[Game Master] -->|阶段转换触发| Mod[ModeratorAgent<br/>A2A 端点]
  Mod -->|主持词 ≤80 字| GM
  GM -->|publishSSE narration| U[观众]

  GM -->|决策请求| P1[Player Agent 1]
  GM -->|决策请求| P2[Player Agent 2]
  GM -->|...| PN[Player Agent 6]

  style Mod fill:#fff9c4
```

**Moderator 与 Player 走同一套 A2A 路由**（`agentId` 区分）。Moderator 不读 memory，只读最近事件生成旁白。面试话术：多 Agent GroupChat 的 A2A 原生实现。

---

## 10. Match 生命周期状态机

```mermaid
stateDiagram-v2
  [*] --> pending: POST /api/matches
  pending --> running: 初始化引擎 + 首次 tick
  running --> running: self-triggered tick loop
  running --> completed: match-end boundary
  running --> errored: Redis/DB 断线
  running --> aborted_by_errors: 连续 3 次 agent_errors
  completed --> [*]
  errored --> [*]: 7 天后清理
  aborted_by_errors --> [*]: 7 天后清理
```

---

## 11. 部署拓扑

```mermaid
flowchart TB
  user["观众浏览器"]
  dns["域名 / HTTPS"]
  caddy["Caddy 反代"]
  app["Next.js 容器<br/>Web + API + SSE"]
  pg[("Postgres 16<br/>持久化数据")]
  redis[("Redis 7<br/>活动对局与锁")]
  backup["每日备份<br/>保留 14 天"]
  llm["外部 LLM API"]

  user --> dns
  dns --> caddy
  caddy --> app
  app --> pg
  app --> redis
  app -.-> llm
  pg -.-> backup

  subgraph server["云服务器 Docker Compose"]
    caddy
    app
    pg
    redis
    backup
  end
```

**Fallback 方案**：Vercel + Supabase + Upstash，同一份代码通过环境变量切换。

---

## 12. Phase 实施顺序

```mermaid
flowchart LR
  p0["P0<br/>工程骨架<br/>Next.js / Drizzle / SDK 接入"]
  p1["P1<br/>Poker MVP<br/>端到端跑通一局"]
  p2["P2<br/>A2A 正规化<br/>并发与观测性"]
  p3["P3<br/>Werewolf<br/>Moderator 与 beliefState"]
  p4["P4<br/>生产部署<br/>公网演示与录屏"]
  p5["P5 可选<br/>回放播放器<br/>备用部署"]

  p0 --> p1 --> p2 --> p3 --> p4 --> p5

  style p1 fill:#c8e6c9
  style p3 fill:#fff59d
  style p4 fill:#ffab91
```

**每 Phase 里程碑**：
- **P0**：Hello World LLM 调通 + A2A toy agent
- **P1**：6 个 LLM 自主打完一局德扑，实时思考链 + 筹码图 + 排名
- **P2**：Agent Card curl 可读 + 2 对局并发不串扰 + fallback Badge
- **P3**：狼人杀 6 玩家 + 1 Moderator 打完一局
- **P4**：公网 URL + 录屏 demo
- **P5**：回放 UI + 备用部署

---

## 13. 风险地图

```mermaid
flowchart LR
  subgraph risks["风险"]
    direction TB
    r1["A2A SDK 理解偏差"]
    r2["Tick loop 在 Next.js 中踩坑"]
    r3["LLM 调用费用过高"]
    r4["狼人杀 Agent 决策不可靠"]
    r5["服务器宕机影响演示"]
    r6["数据库备份损坏"]
  end

  subgraph actions["应对"]
    direction TB
    m1["P0 先跑 toy agent"]
    m2["P1 使用 setInterval 兜底"]
    m3["演示优先低价模型与 Bot"]
    m4["beliefState 外化 + 三层校验"]
    m5["P5 建备用部署链路"]
    m6["14 天滚动备份 + 本地副本"]
  end

  r1 --> m1
  r2 --> m2
  r3 --> m3
  r4 --> m4
  r5 --> m5
  r6 --> m6
```

---

## 14. 你现在要决定什么

1. **这份简要设计的骨架和决策，对不对？** 对 → 批准执行仓库迁移 + 进入 writing-plans
2. **某处要改？** 指出具体章节，我改完再 review
3. **完整 spec 里有些细节还想加 mermaid？** 告诉我哪节

---

> 完整技术 spec（含代码示例、DB schema、类型定义）见 `2026-05-06-colosseum-rewrite-design.md`
