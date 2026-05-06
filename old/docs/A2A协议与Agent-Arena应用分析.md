# A2A 协议与 Agent Arena 应用分析

> 日期：2026-05-06 | 基于 A2A v1.0 规范（23.6K stars, Linux Foundation, Google 贡献）

---

## 一、A2A 协议核心要点

### 是什么

A2A（Agent-to-Agent）是 Google 发起、Linux Foundation 托管的开放协议。解决的核心问题：**不同框架、不同厂商构建的 AI Agent，如何在不暴露内部状态和工具的前提下互相发现、通信和协作。**

```
A2A = Agent Card（自描述）+ Task（状态化工作单元）+ Message（多模态通信）
      + Stream/Webhook（实时推送）+ Extensions（扩展机制）
```

### 核心概念速查

| 概念 | 作用 | 类比 |
|------|------|------|
| **Agent Card** | JSON 自描述文件，声明身份、能力、技能、安全方案 | 微服务的 OpenAPI 文档 |
| **Task** | 有状态的工作单元，9 种生命周期状态 | 异步任务/Promise |
| **Message** | 多轮对话的基本通信单元，含 Parts（文本/文件/结构数据） | HTTP 请求体 |
| **Streaming** | SSE 实时推送任务状态和产物的增量更新 | WebSocket 事件流 |
| **Push Notification** | Webhook 回调，适合长任务异步通知 | 回调 URL |
| **Extensions** | 协议扩展机制，URI 标识，支持必选/可选 | 插件系统 |

### A2A vs MCP

```
MCP：LLM ↔ 工具/数据     （"怎么调用一个工具"）
A2A：Agent ↔ Agent       （"怎么让 Agent 协作"）
```

两者互补。A2A 的 Server Agent 内部可能用 MCP 调用工具来完成 A2A 任务。

### 任务生命周期

```
submitted → working → input-required → working → completed
                   ↘ auth-required    ↘ failed
                                      ↘ canceled
                                      ↘ rejected
```

三种更新推送机制：**Polling**（Get Task）、**Streaming**（SSE）、**Push Notification**（Webhook）

---

## 二、A2A 在 Agent Arena 中的应用空间

Agent Arena 是「多 Agent 博弈竞技场」——Agent 在德州扑克/狼人杀/斗地主中互相对战，天然是 A2A 的完美应用场景。

### 2.1 架构映射

```
┌─────────────────────────────────────────────────────────────┐
│                   Agent Arena (A2A 架构)                     │
│                                                             │
│  ┌────────────┐   A2A      ┌────────────┐   A2A    ┌──────┐│
│  │ PokerBot   │◄──────────►│ Werewolf   │◄────────►│Chess ││
│  │ (A2A Svr)  │  Message   │ (A2A Svr)  │  Message │(Svr) ││
│  └─────┬──────┘            └─────┬──────┘          └──┬───┘│
│        │                         │                    │     │
│  ┌─────┴─────────────────────────┴────────────────────┴────┐│
│  │              Game Master (A2A Client)                    ││
│  │  调度回合、验证动作、广播游戏状态、记录计分、控制对局流程   ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**关键设计决策**：
- 每个参赛 Agent 暴露 A2A Server 端点，Game Master 作为 A2A Client
- Agent 之间不直接通信，不暴露内部 prompt、记忆、策略
- Game Master 通过 Agent Card 动态发现参与者能力

### 2.2 Agent Card = 即插即用的 Agent 注册

每个上场的 Agent 发布一张 Agent Card，描述自己的游戏能力：

```json
{
  "name": "BluffMaster-3000",
  "description": "LLM-based poker agent with opponent modeling and GTO approximation",
  "version": "1.2.0",
  "capabilities": { "streaming": false, "pushNotifications": true },
  "skills": [
    {
      "id": "texas-holdem",
      "name": "Texas Hold'em Player",
      "description": "Plays standard No-Limit Texas Hold'em. Supports pre-flop through river.",
      "tags": ["poker", "bluffing", "GTO", "no-limit"],
      "inputModes": ["application/json"],
      "outputModes": ["application/json"],
      "examples": [
        "{\"game_state\": {\"hand\": [\"A♠\",\"K♠\"], \"community\": [\"K♥\",\"7♦\",\"2♣\"], \"pot\": 500, \"position\": \"BTN\"}}"
      ]
    },
    {
      "id": "werewolf",
      "name": "Werewolf Player",
      "description": "Plays werewolf with natural language debate and role deduction",
      "tags": ["werewolf", "social-deduction", "debate"],
      "inputModes": ["application/json", "text/plain"],
      "outputModes": ["text/plain"]
    }
  ],
  "defaultInputModes": ["application/json"],
  "defaultOutputModes": ["application/json"],
  "securitySchemes": {
    "apiKey": {
      "apiKeySecurityScheme": { "location": "header", "name": "X-Agent-Key" }
    }
  }
}
```

### 2.3 Task = 一局游戏

A2A Task 的生命周期和一局游戏完美对应：

| A2A Task State | Agent Arena 对应 |
|----------------|-----------------|
| `submitted` | 玩家加入牌桌，等待发牌 |
| `working` | 游戏中（发牌/下注/投票/辩论） |
| `input-required` | 等待该玩家决策（"你的回合"） |
| `completed` | 一局结束（结算筹码、更新 ELO） |
| `failed` | Agent 异常退出（超时/崩溃） |
| `canceled` | 玩家主动弃权 |

**多轮交互示例**（德州扑克一回合）：

```
Game Master → POST /message:send → PokerBot
  {
    "message": {
      "role": "ROLE_USER",
      "parts": [{"data": {
        "hand": ["A♠","K♠"],
        "community": ["K♥","7♦","2♣"],
        "pot": 500,
        "position": "BTN",
        "action_history": ["UTG: fold", "MP: raise 100"]
      }}],
      "messageId": "turn-12-msg-1",
      "taskId": "game-42-task-bot3"
    }
  }

PokerBot → Response
  {
    "task": {
      "id": "game-42-task-bot3",
      "status": { "state": "TASK_STATE_COMPLETED" },
      "artifacts": [{
        "artifactId": "action-12",
        "parts": [{"data": {
          "action": "raise",
          "amount": 300,
          "reasoning": "T♠K with top pair on dry board, value raise 3x"
        }}]
      }]
    }
  }
```

### 2.4 Streaming = 实时对局可视化

前端订阅 SSE 流，实时渲染牌桌动画和动作日志：

```
GET /tasks/game-42:subscribe → SSE stream:

data: {"statusUpdate": {"taskId": "game-42", "status": {"state": "working",
      "message": {"parts": [{"text": "Flop dealt: K♠ 7♥ 2♦"}]}}}}

data: {"statusUpdate": {"taskId":"game-42-task-bot3","status":{"state":"input-required",
      "message": {"parts": [{"text": "Player 3 (BluffMaster-3000) to act"}]}}}}

data: {"artifactUpdate": {"taskId":"game-42-task-bot3",
      "artifact": {"artifactId":"action-12","parts":[{"data":{"action":"raise","amount":300}}]}}}

data: {"statusUpdate": {"taskId": "game-42", "status": {"state": "completed",
      "message": {"parts": [{"text": "Player 3 wins pot: 1100 chips"}]}}}}
```

---

## 三、从 Agent 面经知识库提取的工程能力落地

以下模式来自 `面试资料/agent-interview-report.md`，直接可落地到 Agent Arena。

### 3.1 记忆系统（对应面经 1.3 节）

> 参考 MemGPT/Mem0 的分层记忆设计

| 层级 | 实现 | 技术栈 |
|------|------|--------|
| **工作记忆** | 当前对局的上下文窗口（最近 N 轮动作） | Prompt context |
| **短期记忆** | 当前会话所有对局的滑动窗口 | Redis List |
| **长期记忆** | 对局摘要 + 对手画像，向量化存储 | pgvector / Chroma |
| **检索策略** | 相似局面检索 → 注入决策 prompt | Embedding + Cosine Similarity |

### 3.2 Multi-Agent 协作模式（对应面经 1.6 节）

| 模式 | 在 Agent Arena 中的应用 |
|------|------------------------|
| **Orchestrator-Worker**（AutoGen） | Game Master 调度回合，各 Agent 作为 Worker |
| **GroupChat**（AutoGen） | 狼人杀讨论阶段，Agent 之间 A2A Message 辩论 |
| **Handoff**（OpenAI Agents SDK） | 当 Agent 需要精确计算赔率时，handoff 给专用计算 Agent |
| **Pipeline** | 斗地主：叫地主 → 出牌 → 结算，顺序执行 |

### 3.3 Agent 评估体系（对应面经 1.9 节）

> 参考 GAIA / AgentBench / SWE-bench 的评估方法论

| 维度 | 指标 | 实现 |
|------|------|------|
| **任务完成率** | 胜率、ROI、最终排名 | 每局结算 |
| **效率** | 每局 token 消耗、平均决策延迟 | 日志追踪 |
| **鲁棒性** | 不同对手/不同筹码深度下表现的方差 | 多轮统计 |
| **持续评估** | ELO 天梯系统，随对战局数动态更新 | 每次结算后更新 |

### 3.4 工程化实践（对应面经 1.10 节 & 12-Factor Agents）

| 原则 | 在 Agent Arena 中的落地 |
|------|------------------------|
| **无状态 Game Master** | Game Master 无状态，游戏状态全在 Redis/DB 中 |
| **确定性回合引擎** | 发牌/判定/结算纯逻辑，零 LLM 参与 |
| **结构化输出** | Pydantic Schema 强制 Agent 输出合法 JSON |
| **三层校验** | Structured Output → Action Validator → 重试 3 次 → fallback |
| **可观测性** | 每轮动作日志 + token 消耗追踪 + 计分面板 |
| **Human-in-the-loop** | 可选的人类玩家席位，与 AI Agent 同台竞技 |

### 3.5 Agentic RAG（对应面经 1.7 节）

Agent 在决策前自主检索类似历史局面：

```
当前局面 → Query 变换（生成多种查询）
  → 向量检索（寻找类似的对局状态和结果）
  → Cross-encoder 精排
  → 注入 prompt context
  → LLM 决策
```

面试话术：*"我在 Agent Arena 中实现了 Agentic RAG——Agent 在决策前会自主检索历史对局中类似的博弈局面，不是被动的单次 RAG，而是 Agent 驱动的多步检索 + 重排序。"*

---

## 四、面试项目故事线（建议话术）

> "我做了一个多 Agent 博弈竞技场，Agent 在德州扑克/狼人杀/斗地主中互相对战。技术架构参考了业界最前沿的标准：
>
> **Agent 通信**上，我用了 Google 的 A2A 协议——每个参赛 Agent 暴露 A2A Server 端点，通过 Agent Card 自描述能力，Game Master 作为 A2A Client 动态发现参与者并调度回合。Agent 之间不直接通信、不暴露内部 prompt 和策略——这恰好就是 A2A 设计的核心原则 'Opaque Execution'。
>
> **记忆系统**参考了 MemGPT 的分层设计——工作记忆在上下文窗口，短期记忆用滑动窗口，长期记忆通过 LLM 摘要后向量化存入 pgvector，检索时做相似度匹配注入决策 prompt。
>
> **Multi-Agent 协作**参考了 AutoGen 的对话驱动模式和 CrewAI 的角色委派——Game Master 是 Orchestrator，狼人杀辩论阶段 Agent 通过 A2A Message 互相辩论，复杂计算通过 Handoff 交给专用计算 Agent。
>
> **评估体系**参考了 AgentBench 和 GAIA 的评估方法论，从胜率、效率、鲁棒性三个维度持续评估，还有 ELO 天梯做跨版本对比。
>
> **工程化**遵循 12-Factor Agents 原则——Game Master 无状态、回合引擎确定性、Pydantic 结构化输出保证动作合法性、三层校验防止 Agent 输出异常。
>
> 这个项目的核心价值不是做了多少游戏，而是搭建了一套符合业界标准的 Multi-Agent 博弈框架。"

---

## 五、A2A 关键资源

| 资源 | 链接 |
|------|------|
| A2A 规范 | https://a2a-protocol.org/latest/specification/ |
| GitHub 仓库 | https://github.com/a2aproject/A2A（23.6K stars） |
| Python SDK | `pip install a2a-sdk` |
| DeepLearning.AI 课程 | https://goo.gle/dlai-a2a |
| MCP（互补协议） | https://modelcontextprotocol.io |
