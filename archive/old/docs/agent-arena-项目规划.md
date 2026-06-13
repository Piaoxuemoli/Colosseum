# Agent Arena — 多 Agent 博弈竞技场 项目规划

> 创建日期：2026-05-06
> 目标：秋招 Agent 方向核心竞争力项目

---

## 一、项目评估：为什么这个项目比 99% 的秋招项目强

### 1.1 差异化分析

| 维度 | 普通 Agent 项目（Chat/RAG） | Agent Arena（你的项目） |
|------|---------------------------|----------------------|
| 稀缺性 | 遍地都是，面试官看麻了 | 几乎没见过，面试官会主动追问 |
| 技术深度 | 调 API + 存向量，浅层 | 多 Agent 博弈、记忆系统、上下文管理 |
| 可视化 | 基本没有或简单列表 | 竞技场可视化 + 计分曲线 = 展示效果拉满 |
| 学术价值 | 几乎为零 | 可以写成论文投 workshop（Agent 博弈、 emergent behavior） |
| 面试故事性 | "我做了个 chatbot" | "我让 AI 打德州扑克，分析它们的博弈策略" |
| 前端展示 | 无 | 游戏 UI + 数据看板，前端功底一览无余 |

### 1.2 直接命中 Agent 岗位全部考点

| Agent 核心能力 | 项目中的体现 |
|---------------|-------------|
| **Memory 系统** | 每个 Agent 拥有持久记忆（历史对局、对手画像） |
| **上下文管理** | 多轮博弈中的 context window 管理、信息压缩 |
| **Tool Calling** | 棋类游戏的状态解析、德州的计算工具 |
| **Multi-Agent 编排** | 多个 Agent 同时竞技、调度、回合管理 |
| **Planning / Reasoning** | Agent 的博弈决策链（ReAct / Tree of Thoughts） |
| **Evaluation** | 计分系统本身就是 Agent 评估框架 |

### 1.3 三条求职路线全都能用

| 求职方向 | 如何包装这个项目 |
|----------|-----------------|
| **Agent/LLM 应用** | "我实现了一个多 Agent 博弈框架，包含记忆、上下文管理、策略评估" |
| **全栈/后端** | "我设计了一套实时多人 Agent 调度系统，支持多游戏类型的回合引擎" |
| **前端** | "我搭建了竞技场可视化平台，包含实时对局渲染、数据看板、计分曲线" |

> **一个项目，三条路。这就是最好的保底策略。**

---

## 二、项目架构建议

### 2.1 技术栈

```
前端：Next.js 14 (App Router) + TypeScript + Canvas/Konva.js（游戏渲染）
      + ECharts/Recharts（计分曲线） + Tailwind + shadcn/ui
后端：Next.js API Routes + Bun/Node.js
数据层：PostgreSQL（Supabase）+ Redis（实时对战状态）
LLM 调度：Vercel AI SDK / 自建 Agent Loop
游戏引擎：自建（每种游戏一个 engine 模块）
部署：Vercel（前端）+ Railway/Fly.io（后端长任务）
```

### 2.2 核心模块架构

```
agent-arena/
├── src/
│   ├── app/                    # Next.js 页面
│   │   ├── page.tsx            # 首页：竞技场大厅
│   │   ├── arena/[gameId]/     # 对局页面（实时可视化）
│   │   ├── history/            # 历史对局回放
│   │   └── leaderboard/        # 天梯排行榜
│   ├── engine/                 # 游戏引擎（核心）
│   │   ├── types.ts            # 通用类型定义
│   │   ├── base-game.ts        # 游戏基类（回合管理、状态机）
│   │   ├── texas-holdem/       # 德州扑克引擎
│   │   ├── werewolf/           # 狼人杀引擎
│   │   ├── doudizhu/           # 斗地主引擎
│   │   ├── board-game/         # 通用桌游引擎
│   │   └── chess/              # 棋类引擎
│   ├── agents/                 # Agent 系统（核心）
│   │   ├── base-agent.ts       # Agent 基类
│   │   ├── agent-factory.ts    # Agent 工厂（不同策略/模型）
│   │   ├── memory/             # 记忆系统
│   │   │   ├── memory-store.ts     # 记忆存储接口
│   │   │   ├── short-term.ts       # 短期记忆（当前对局）
│   │   │   ├── long-term.ts        # 长期记忆（历史对局摘要）
│   │   │   └── opponent-model.ts   # 对手建模
│   │   ├── context/            # 上下文管理
│   │   │   ├── context-builder.ts  # 上下文构建器
│   │   │   ├── compressor.ts       # 上下文压缩（避免超 token 限制）
│   │   │   └── prompt-templates/   # Prompt 模板
│   │   └── strategies/         # 决策策略
│   │       ├── react.ts            # ReAct 模式
│   │       ├── chain-of-thought.ts # CoT
│   │       └── tree-of-thoughts.ts # ToT（复杂博弈用）
│   ├── orchestration/          # 编排层
│   │   ├── game-master.ts      # 游戏主持人（发牌、判定、回合调度）
│   │   ├── action-validator.ts # 动作合法性校验
│   │   └── scoring.ts          # 计分系统
│   ├── visualization/          # 可视化层
│   │   ├── game-renderer/      # 游戏状态渲染
│   │   ├── score-chart/        # 计分曲线
│   │   ├── agent-dashboard/    # Agent 实时状态面板
│   │   └── replay-player/      # 对局回放播放器
│   └── db/                     # 数据层
│       ├── schema.ts           # Prisma Schema
│       └── queries/            # 数据查询
├── prisma/
│   └── schema.prisma
└── package.json
```

### 2.3 数据库设计（核心表）

```sql
-- Agent 档案
Agent (id, name, model, strategy, elo_rating, created_at)

-- 对局记录
Game (id, game_type, status, started_at, ended_at)

-- 对局参与者
GamePlayer (game_id, agent_id, final_score, final_rank)

-- 对局动作日志（可回放）
GameAction (game_id, round, agent_id, action_type, action_data, timestamp)

-- Agent 长期记忆（跨对局）
AgentMemory (agent_id, game_id, memory_type, content, embedding, created_at)

-- 天梯排名快照
Leaderboard (agent_id, game_type, elo, win_rate, total_games, updated_at)
```

---

## 三、分阶段实施计划

### 阶段 0：现状盘点（现在就做）

- [ ] 梳理已有代码，写一份 `PROGRESS.md` 记录完成了什么
- [ ] 确定一个最先跑通的游戏（建议：**德州扑克**，规则清晰、回合制、信息不完全博弈 = 最体现 Agent 能力）
- [ ] 先 commit 已有代码，别丢了

### 阶段 1：单游戏 MVP — 德州扑克（目标：2 个周末）

**目标**：2 个 Agent 能坐下来打一局完整的德州扑克，有可视化。

```
核心交付：
├── 德州扑克引擎（发牌、公共牌、下注轮、比牌）
├── 2 个 LLM Agent 接入（OpenAI API）
├── 回合调度系统（Game Master）
├── 基础 Prompt（手牌描述 + 公共牌 + 动作空间 + 策略提示）
└── 简单的前端可视化（牌面 + 筹码 + 当前动作）
```

**技术要点**：
- 引擎层和 Agent 层严格解耦——引擎只负责游戏规则，Agent 只负责决策
- Agent 的输出格式：`{ "action": "fold|check|call|raise", "amount": 100, "reasoning": "..." }`
- 用 `structured output`（OpenAI JSON mode）强制 Agent 输出合法动作

### 阶段 2：记忆系统（目标：2 个周末）

**目标**：Agent 能记住对手的牌风，跨对局进化策略。

```
核心交付：
├── 短期记忆：当前对局的关键事件链（谁在什么位置做了什么）
├── 长期记忆：历史对局中对局风格摘要（"Alice 喜欢 bluff"）
├── 对手建模：每个 Agent 维护对其他 Agent 的信念模型
└── 上下文压缩：当对局过长时，自动压缩历史信息
```

**面试亮点**：
> "我实现了一个分层记忆系统：短期记忆用滑动窗口保留最近 N 轮的动作，长期记忆用 LLM 定期对历史对局做摘要并向量化存储，新对局开始时检索最相关的历史模式作为 prompt context。"

### 阶段 3：可视化增强（目标：1-2 个周末）

**目标**：让项目「看起来很强」。

```
核心交付：
├── 实时对局渲染（牌桌、筹码动画、当前行动高亮）
├── 计分曲线（ECharts 实时更新每个 Agent 的筹码曲线）
├── Agent 思维面板（侧边栏展示 Agent 当前的推理过程）
├── 对局回放（基于 GameAction 表的时间轴回放）
└── 天梯排行榜
```

### 阶段 4：扩展游戏类型（目标：按时间灵活做）

按优先级排序：
1. **狼人杀**（多 Agent 不完全信息博弈 = Agent 方向的核武器项目）
2. **斗地主**（三人博弈，合作 + 对抗混合）
3. **棋类**（确定性博弈，展示传统算法 vs LLM 对比）

**给面试官的说法**：
> "我只完整做了德州扑克和狼人杀，框架本身设计为插件式——新增游戏只需实现 GameEngine 接口，Agent 层完全复用。棋类引擎我已经设计了接口，后续可以直接接入。"

### 阶段 5：面试打磨（7 月中旬前完成）

- [ ] 写一份 `README.md`，包含架构图（Mermaid）、技术亮点、Demo GIF
- [ ] 录一个 2 分钟 Demo 视频（对局 + 可视化 + 计分）
- [ ] 准备 5 个「面试官会追问的问题」的标准答案（见第五节）
- [ ] 部署到 Vercel，面试时直接开链接展示
- [ ] 写一篇技术博客（掘金/知乎），秋招前发出去

---

## 四、与 6-8 月时间线的整合

这个项目和之前规划的三档学习完全不冲突，因为**项目本身就是学习载体**：

| 之前规划的内容 | 如何在项目中覆盖 |
|---------------|-----------------|
| 刷算法 | 游戏引擎里的状态机、树搜索 = 算法的实际应用 |
| 前端基础 | 可视化层的 Canvas/ECharts/Tailwind 全用上 |
| Node/全栈 | API Routes + Prisma + Redis 全在项目里 |
| Agent 理论 | Memory、Context Mgmt、Tool Calling 全落地 |
| 八股 | 项目中遇到的问题本身就是最好的八股素材 |

**5-6 月的周末聚焦这个项目，比任何分散学习都高效。**

---

## 五、面试攻防：10 个必被追问的问题

### Q1：Agent 的决策质量怎么样？会不会很蠢？
> A：德州扑克中，LLM Agent 在 pre-flop 阶段表现接近 GTO 策略（会算底池赔率），但在 bluff 频率和位置敏感性上不如专用算法。这正是我项目的价值——暴露 LLM 在博弈场景中的能力边界，而不是宣称它完美。我设计了计分系统来量化这些差异。

### Q2：为什么不直接用传统博弈算法（如 CFR）？
> A：这个项目的研究目标是探索 LLM 在博弈中的 emergent behavior，而不是做一个最强的扑克 AI。传统 CFR 可以加进来做 baseline 对比，这正是架构里 engine 和 agent 解耦的好处——随时可以接入不同 agent。

### Q3：记忆系统怎么实现的？怎么防止上下文爆炸？
> A：分层设计。短期记忆是滑动窗口（最近 10 轮），长期记忆用 LLM 做周期性摘要并向量化存入 pgvector。新对局开始时，基于当前对手和历史对局 embedding 做相似度检索，注入相关记忆。上下文过长时触发压缩——把历史动作用结构化 JSON 替代自然语言，节省 70% token。

### Q4：如果 Agent 输出了不合法的动作怎么办？
> A：三层防护。第一层是 structured output（JSON mode + JSON Schema），确保输出格式正确。第二层是 Action Validator（引擎层校验动作合法性）。第三层是 fallback——非法动作触发重试，最多 3 次，超时则自动 fold/pass。

### Q5：怎么评估 Agent 的能力？
> A：三重评估。一、计分系统（筹码曲线、胜率、ROI）。二、ELO 天梯（跨对局排名）。三、策略分析仪表板——fold/call/raise 频率、bluff 成功率、位置敏感性。这套评估框架本身也是卖点。

### Q6：技术选型为什么用 Next.js 而不是 Python 后端？
> A：首先我是 AI 专业出身有前端经验，Next.js 让我一个仓库搞定前后端减少上下文切换。其次 Vercel AI SDK 对 streaming 和 tool calling 的 TypeScript 支持是第一流的。核心博弈决策是 LLM API 调用，Node.js 的 I/O 模型完全够用。

### Q7：多 Agent 并发怎么管理？
> A：对局是回合制的，天然串行。但多个对局可以并发——用 Redis 做对局状态缓存，每个对局一个独立的 Game Master 实例，通过 BullMQ 管理任务队列。狼人杀这种多人并发投票场景，用状态机 + 超时机制处理。

### Q8：为什么不直接用 LangChain？
> A：LangChain 太重，抽象层太多，调试困难。这个项目 Agent 的决策链是我自己写的——一个 200 行的 Agent Loop 远比 LangChain 的黑盒更适合学习。我读过 Vercel AI SDK 的源码，理解它的 streaming 和 tool calling 实现，所以在自己的项目里做了简化版。

### Q9：你觉得最难的部分是什么？
> A：上下文管理。德州扑克一局可能有 20+ 轮，每一轮的 prompt 都要包含历史动作、底池大小、位置信息。如果不做压缩，10 轮之后就超 token 限制。我花了不少精力在 prompt 结构化和上下文裁剪策略上。

### Q10：如果继续做，下一步做什么？
> A：三个方向。一、狼人杀——自然语言辩论是 LLM 的 native 能力，会比扑克更精彩。二、Human-in-the-loop——人类可以和 AI 同台竞技。三、Emergent Behavior 分析——长期让 Agent 对战后是否会出现合作、欺骗、报复等 emergent 行为。

---

## 六、风险与应对

| 风险 | 应对 |
|------|------|
| API 费用太高（一局德州 100+ 次调用） | 用通义千问/DeepSeek 等国产模型降低成本；GAME_MASTER 用规则引擎而不是 LLM |
| 狼人杀复杂度超出预期 | 先简化为 5 人局（1 狼 1 预言家 3 村民），不做完整版 |
| 实习太忙没时间写 | 引擎层可以在通勤/午休写（纯逻辑不需要 LLM），Agent 层周末集中调 |
| 项目没做完秋招就开始了 | 德州扑克跑通 + 可视化完成就已经是强力项目了，剩下的作为「进行中」讲 |

---

## 七、周度里程碑（建议节奏）

```
5月 W2（本周）：现状盘点 + 确定德州扑克为核心
5月 W3-W4：德州引擎 + 2 Agent 跑通一局 + 基础可视化
6月 W1-W2：记忆系统（短期 + 长期 + 对手建模）
6月 W3-W4：可视化增强（计分曲线 + Agent 思维面板 + 回放）
7月 W1-W2：面试打磨（README + Demo 视频 + 部署 + 博客）
7月 W3+：狼人杀（如果时间允许）/ 持续面试
```

> 以上时间线不是硬约束。如果某个阶段用了更多时间，延迟即可。德州扑克跑通之后，你已经有东西展示了。

---

## 八、一句话总结

**这个项目的价值不在于做完了多少游戏，而在于你设计了一个能容纳所有博弈类型的 Agent 框架，并且真的把它跑起来了。**

市面上 90% 的 Agent 项目是「调 API 聊天」，你的项目是「让 AI 在对抗中产生智能」。面试官看到它会放下简历、身体前倾、开始追问——这就是你秋招最强的武器。

---

> 附：如果你愿意，下一步我可以帮你设计德州扑克的 Game Engine 接口和 Agent Loop 的核心代码骨架。
