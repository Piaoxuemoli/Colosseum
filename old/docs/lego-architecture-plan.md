# 系统乐高化重构 — 详细实施方案

## Context

当前代码库 95% 耦合于德扑，引擎类型渗透到每一层（store、adapter、prompt、UI、history、impression、bot）。目标：抽取 3 层解耦架构（Engine → Gateway → UI），使游戏引擎、Prompt 模板、印象系统、Bot 策略、游戏 UI 全部可随游戏切换。参考 Claude Code 三层设计 + OpenClaw 网关模式。

### 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **引擎同步机制** | B: mutation + Gateway clone 包装 | 德扑引擎几乎不改，Gateway 调用前 `structuredClone(state)` 包装为 immutable 返回。新游戏可自由选纯 immutable。 |
| **事务边界** | Gateway 层统一管控 | `requestAgentAction()` 是完整事务: LLM→解析→验证→执行→印象。失败整体回滚到 bot fallback。Store 只拿最终结果做 `set()`。 |
| **模块联动** | 选游戏 = 加载 plugin，所有模块自动跟随 | 用户选"斗地主"→ `getGame('doudizhu')` → 返回一个 GamePlugin 对象 → Gateway/Store/Pages 全部从这一个对象读取所有子模块，无需手动切换任何东西。 |

---

## 零、自动联动切换机制

**核心原则**: 用户只做一个动作 —— **选择游戏类型**。其余所有模块（引擎、提示词、解析器、Bot、印象、UI、配置、历史）全部从 `GamePlugin` 对象自动获取，零手动切换。

```typescript
// 1. 用户在首页点击"斗地主"
// 2. 唯一入口: store.startGame('doudizhu', config)
startGame(gameType: string, config: unknown) {
  const plugin = getGame(gameType)       // ← 从 Registry 取出 GamePlugin
  //    plugin 内含:
  //      .createEngine()          → 斗地主引擎
  //      .contextBuilder          → 斗地主上下文拼装 (提示词+重试+摘要)
  //      .responseParser          → 斗地主动作解析
  //      .botStrategy             → 斗地主 Bot
  //      .impressionConfig        → 攻击性/配合度/记牌能力
  //      .BoardComponent          → 斗地主牌桌 UI
  //      .SetupComponent          → 底分/倍数配置
  //      .HistoryDetailComponent  → 出牌回放
  //      .meta.scoreLabel         → "积分"
  //      .meta.roundLabel         → "局"

  const gateway = new Gateway(plugin, llmClient)  // Gateway 自动用 plugin 的所有子模块
  const state = plugin.createEngine().createGame(config)
  set({ gameType, plugin, gateway, gameState: state })
}

// 3. 之后所有层自动联动:
//    - GamePage 读 plugin.BoardComponent 渲染牌桌
//    - SetupPage 读 plugin.SetupComponent 渲染配置
//    - HistoryPage 读 plugin.HistoryDetailComponent 渲染历史
//    - ChipChart 读 plugin.meta.scoreLabel 显示"积分"
//    - ImpressionPanel 读 plugin.impressionConfig.dimensions 渲染维度
//    - Gateway.requestAgentAction 内部用 plugin.contextBuilder / responseParser / botStrategy
//    - Gateway.updateImpressions 用 plugin.impressionConfig
```

**联动链路图**:
```
用户选游戏 → getGame(type) → GamePlugin 对象
  ↓
Store 存 { plugin, gateway }
  ↓ 所有消费者从 store 读 plugin
  ├── GamePage       → plugin.BoardComponent
  ├── SetupPage      → plugin.SetupComponent  
  ├── HistoryPage    → plugin.HistoryDetailComponent
  ├── ChipChart      → plugin.meta.scoreLabel / roundLabel
  ├── ImpressionPanel→ plugin.impressionConfig.dimensions
  ├── Gateway        → plugin.contextBuilder / responseParser / botStrategy
  └── SessionStore   → plugin.defaultConfig (默认值) + gameType (storage key)
```

---

## 一、详细架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          UI Layer                                    │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────────────┐ │
│  │ GamePage │ │ SetupPage │ │ HistPage │ │   Shared Components    │ │
│  │ plugin.  │ │ plugin.   │ │ plugin.  │ │ ThinkingBubble         │ │
│  │ Board    │ │ Setup     │ │ History  │ │ ImpressionPanel        │ │
│  │ Component│ │ Component │ │ Detail   │ │ ChipChart(scoreLabel)  │ │
│  └────┬─────┘ └─────┬─────┘ └────┬─────┘ └────────────────────────┘ │
│       └─────────────┴────────────┘  读 store.plugin                  │
└─────────────────────┤────────────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────────────┐
│  Zustand Store (game-agnostic)                                       │
│  startGame(type) → Registry.getGame(type) → plugin → Gateway        │
│  processNextAction() → gateway.requestAgentAction()                  │
└─────────────────────┤────────────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────────────┐
│  Gateway (OpenClaw 式网关) — 事务管控                                │
│                                                                      │
│  ┌─ 上下文拼装 (Context Assembler) ──────────────────────────────┐  │
│  │  plugin.contextBuilder (游戏特定，自动联动)                    │  │
│  │    .buildSystemPrompt(personality, impressions)                │  │
│  │    .buildUserPrompt(state, playerId, actions)                 │  │
│  │    .buildImpressionPrompt(state, history)                     │  │
│  │    .buildRetryPrompt(error, actions)                          │  │
│  │    .buildHandSummary(state)                                   │  │
│  │  [通用] 消息组装 ChatMessage[] · 印象注入 · 人格注入           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌─ 响应处理 ────────────────────────────────────────────────────┐  │
│  │  plugin.responseParser.parseAction / parseImpressions          │  │
│  │  [通用] thinking 提取 · 重试逻辑 · bot fallback               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌─ 执行 ────────────────────────────────────────────────────────┐  │
│  │  engine.validate → engine.apply(clone) · coerce · EMA         │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌─ LLM 传输 (共享) ────────────────────────────────────────────┐  │
│  │  llmClient.chat/stream · AbortController · onChunk            │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────┤────────────────────────────────────────────────┘
                      │ EngineProtocol
┌─────────────────────▼────────────────────────────────────────────────┐
│  Engine Layer (纯状态机，零 UI/LLM 依赖)                             │
│  ┌── poker ─────────────────┐  ┌── doudizhu ─────────────────────┐  │
│  │ PokerEngine · 52张牌     │  │ DoudizhuEngine · 54张含王        │  │
│  │ evaluator · equity       │  │ combo-detector · comparator     │  │
│  │ pot-manager              │  │                                 │  │
│  └──────────────────────────┘  └─────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 一次 LLM 决策的完整数据流

```
[1] Store.processNextAction()
      ↓
[2] gateway.requestAgentAction(state, playerId, { onChunk })
      ╔══════════ Gateway 事务 ══════════════════════════╗
[3]   ║ engine.getAvailableActions(state, playerId)      ║
[4]   ║ contextBuilder.buildSystemPrompt(personality)    ║ ← 游戏特定
      ║ contextBuilder.buildUserPrompt(state, actions)   ║ ← 游戏特定
[5]   ║ [通用] 组装 ChatMessage[]                        ║
[6]   ║ llmClient.chat(messages, { onChunk, timeout })   ║ ← 游戏无关
[7]   ║ responseParser.parseAction(raw, types)           ║ ← 游戏特定
      ║   失败? → contextBuilder.buildRetryPrompt()      ║
      ║   再失败? → botStrategy.chooseAction() [fallback]║
[8]   ║ engine.validateAction → applyAction(clone)       ║
      ╚═════════════════════════════════════════════════╝
[9] Store.set({ gameState: newState })
[10] React re-render → plugin.BoardComponent
```

```
┌──────────────────────────────────────────────┐
│              UI Layer                         │
│  GamePage 从 Registry 加载 plugin.BoardComponent │
│  共享组件: ThinkingBubble, ImpressionPanel    │
└─────────────────────┬────────────────────────┘
                      │ Zustand Store (game-agnostic)
┌─────────────────────▼────────────────────────┐
│          Gateway Layer (OpenClaw 式网关)       │
│  state → contextBuilder → LLM → parser →       │
│  validate → engine.apply                      │
│  职责: 上下文拼装、格式转换、重试/降级、印象   │
└─────────────────────┬────────────────────────┘
                      │ EngineProtocol<TState,TAction>
┌─────────────────────▼────────────────────────┐
│          Engine Layer (纯状态机)               │
│  零 UI/LLM 依赖                              │
│  poker / uno / werewolf 各自实现 Protocol     │
└──────────────────────────────────────────────┘
```

---

## 二、核心协议定义

### 2.1 EngineProtocol — 任何游戏引擎必须实现

```typescript
// src/core/protocols/engine.protocol.ts
export interface EngineProtocol<TState, TAction, TConfig> {
  createGame(config: TConfig): TState
  getAvailableActions(state: TState, playerId: string): AvailableActionInfo[]
  applyAction(state: TState, action: TAction): ActionResult<TState>
  validateAction(state: TState, action: TAction): { valid: boolean; error?: string }
  serialize(state: TState): string
  deserialize(data: string): TState
  readonly meta: EngineMeta
}

export interface EngineMeta {
  gameType: string          // 'poker' | 'uno'
  displayName: string       // '德州扑克'
  minPlayers: number
  maxPlayers: number
  phases: string[]
}

export interface AvailableActionInfo {
  type: string
  constraints?: Record<string, { min?: number; max?: number }>
}

export type ActionResult<TState> =
  | { ok: true; state: TState; events: GameEvent[] }
  | { ok: false; error: string }

export interface GameEvent {
  type: string
  payload: Record<string, unknown>
}
```

### 2.2 GamePlugin — 游戏注册对象（每个游戏导出一个）

```typescript
// src/core/protocols/plugin.protocol.ts
export interface GamePlugin<TState, TAction, TConfig> {
  readonly gameType: string
  createEngine(): EngineProtocol<TState, TAction, TConfig>
  defaultConfig: TConfig

  // Agent 集成 — 全部可随游戏切换
  contextBuilder: ContextBuilder<TState, TAction>
  responseParser: ResponseParser<TAction>
  botStrategy: BotStrategy<TState, TAction>
  impressionConfig: ImpressionConfig

  // UI 组件 — 游戏提供自己的渲染
  BoardComponent: ComponentType<BoardProps<TState, TAction>>
  SeatComponent: ComponentType<SeatProps>
  HistoryDetailComponent: ComponentType<{ data: unknown }>
  SetupComponent: ComponentType<SetupProps<TConfig>>  // 游戏专属配置面板

  // 元数据
  meta: EngineMeta & {
    scoreLabel: string       // '筹码' | '积分' | '分数'
    roundLabel: string       // '手' | '局' | '回合'
  }
}
```

### 2.3 子接口

```typescript
/** 上下文拼装器 — 游戏提供，负责所有提示词相关的文本构建 */
export interface ContextBuilder<TState, TAction> {
  /** 系统提示: 角色 + 游戏规则 + 对手印象 + 输出格式 */
  buildSystemPrompt(personality: AgentPersonality, impressions: Record<string, Record<string, number>>): string
  /** 用户提示: 当前局面 + 可用动作 */
  buildUserPrompt(state: TState, playerId: string, actions: AvailableActionInfo[]): string
  /** 印象评估请求提示 */
  buildImpressionPrompt(state: TState, events: GameEvent[], currentImpressions: Record<string, Record<string, number>>): string
  /** 格式错误重试提示 */
  buildRetryPrompt(error: string, availableActions: string[]): string
  /** 本局操作摘要（供印象评估用） */
  buildHandSummary(state: TState): string
}

export interface ResponseParser<TAction> {
  parseAction(raw: string, availableTypes: string[]): ParseResult<TAction>
  parseImpressions(raw: string, dimensionKeys: string[]): Record<string, Record<string, number>> | null
}

export interface BotStrategy<TState, TAction> {
  chooseAction(state: TState, playerId: string): TAction
}

export interface ImpressionConfig {
  dimensions: Array<{ key: string; label: string; description: string; range: [number, number]; default: number }>
  // EMA α 等通用参数
  emaAlpha: number
}
```

---

## 三、可切换模块清单

### 3.1 核心游戏模块

| 模块 | 接口 | 德扑实现 | 斗地主实现(示例) |
|------|------|----------|-----------------|
| **引擎** | `EngineProtocol` | streets/blinds/side pots/hand eval | 叫地主→出牌→炸弹/火箭/链子 |
| **上下文拼装** | `ContextBuilder` | 底牌/公共牌/底池/位置/阶段提示 + 重试/摘要 | 手牌/地主牌/剩余牌数/出牌规则 + 重试/摘要 |
| **Response Parser** | `ResponseParser` | `<action>raise</action>` + 金额 | `<action>play 3_3_3_4_4_4</action>` |
| **Bot 策略** | `BotStrategy` | 翻前范围表 + equity | 牌型优先级 + 记牌器 + 地主/农民策略 |
| **印象系统** | `ImpressionConfig` | 4维 L/A/S/H | 3维: 攻击性/配合度/记牌能力 |

### 3.2 UI 组件（新增拆分）

| 模块 | 接口 | 德扑实现 | 斗地主实现 |
|------|------|----------|-----------|
| **牌桌 UI** | `BoardComponent` | 6座椭圆桌 + 公共牌 | 3座 + 地主牌区 + 出牌区 |
| **座位 UI** | `SeatComponent` | 筹码/底牌/D·SB·BB | 牌数/地主标志/农民标志 |
| **历史详情** | `HistoryDetailComponent` | 按街回放 + 手牌排名 | 按轮回放 + 牌型展示 |
| **配置面板** | `SetupComponent` | 盲注/筹码/座位/系统提示词 | 底分/倍数/座位 |
| **分数曲线** | `ScoreChartAdapter` | 筹码曲线 (ChipChart) | 积分曲线 (同一 ChipChart，只改标签) |

### 3.3 配置 & 历史（之前遗漏的耦合点）

| 模块 | 当前问题 | 解决方案 |
|------|---------|---------|
| **SetupPage** | 硬编码 blinds/chips/6座/最少2人 | plugin 提供 `SetupComponent` + `defaultConfig`，SetupPage 变成壳 |
| **session-store** | key 写死 `'poker-arena-session-config'`，默认值全是德扑 | key 改为 `{gameType}-session-config`，默认值从 `plugin.defaultConfig` 读 |
| **HistoryPage** | 硬编码 preflop/flop/turn/river 街名 + action 名 | plugin 提供 `HistoryDetailComponent`，通用 HistoryPage 只做列表+标签页切换 |
| **ChipChart** | 95% 通用，只有"筹码"标签是德扑用语 | 改标签为 plugin 提供的 `meta.scoreLabel`（"筹码"/"积分"/"分数"） |

**不可切换 (共享基础设施):** llm-client、player-adapter、ema.ts、ThinkingBubble、ImpressionPanel（读 dimensions 动态渲染）、game-store（通过 Gateway 编排）、database.ts 核心

### 3.4 页面路由与对局状态保护

| 场景 | 规则 |
|------|------|
| 对局中 → 配置页 | **禁止**。配置页按钮置灰 + tooltip "对局进行中，请先结束" |
| 对局中 → 历史页 | **允许**。历史页只读，不影响对局状态 |
| 对局中 → 切换游戏类型 | **禁止**。必须先结束当前对局 |
| 非对局 → 自由导航 | 配置页/历史页/游戏选择 均可自由切换 |

---

## 四、Gateway 详细流程

Gateway 是**完整事务的管控者**。一次 `requestAgentAction()` 调用 = 一个原子事务，要么返回有效 action，要么整体 fallback 到 bot。Store 不参与中间步骤。

### 同步机制: mutation + clone 包装

```typescript
// Gateway 内部调用引擎时的包装逻辑：
submitAction(state: TState, action: TAction): ActionResult<TState> {
  // 1. clone state，让引擎在副本上 mutate
  const snapshot = structuredClone(state)
  // 2. 引擎内部仍是 mutation（德扑引擎不改）
  const result = this.engine.applyAction(snapshot, action)
  // 3. 返回 ActionResult（snapshot 已被 mutate 成新状态）
  return result
}
// 新游戏（如 UNO）可以直接写纯 immutable，不需要 clone
```

### 决策事务流程

```
Store 调用: gateway.requestAgentAction(state, playerId, options)
  │
  │  ╔═══════════════ Gateway 事务边界 ═══════════════╗
  │  ║                                                ║
  ├─[1] engine.getAvailableActions(state, playerId)   ║
  │      → [{type:'call'}, {type:'raise',...}, ...]   ║
  │                                                    ║
  ├─[2] contextBuilder.buildSystemPrompt(personality)   ║
  │     contextBuilder.buildUserPrompt(state, ...)      ║
  │      → 游戏特定的中文提示                          ║
  │                                                    ║
  ├─[3] llmClient.chat({ onChunk, timeout })           ║
  │      ├─ onChunk → store → ThinkingBubble           ║
  │      └─ 超时/网络错误 → goto [fallback]            ║
  │                                                    ║
  ├─[4] responseParser.parseAction(rawText)            ║
  │      └─ 解析失败 → retry 1次 → 仍失败 → [fallback]║
  │                                                    ║
  ├─[5] engine.validateAction(clonedState, action)     ║
  │      ├─ 合法 → return { action, source: 'llm' }   ║
  │      └─ 非法 → coerce → 仍非法 → [fallback]       ║
  │                                                    ║
  ├─[fallback] botStrategy.chooseAction(state, id)     ║
  │             return { action, source: 'bot' }       ║
  │  ║                                                ║
  │  ╚════════════════════════════════════════════════╝
  │
  ↓ Store 收到最终 action，调 gateway.submitAction() 拿新 state，set() 更新 UI
```

**Store 变得极简**:
```typescript
// game-store.ts 的 processNextAction 简化为：
const result = await gateway.requestAgentAction(state, playerId, { onChunk })
const applied = gateway.submitAction(state, result.action)  // clone + mutate
if (applied.ok) set({ gameState: applied.state })
```

---

## 四.5、代码审计 — 完整耦合点清单

审计发现 **12 CRITICAL + 8 HIGH + 8 MEDIUM + 6 LOW** 共 34 个耦合点。以下是之前方案遗漏、需要额外处理的模块：

### 遗漏模块 1: CSS 样式

| 文件 | 问题 | 处理 |
|------|------|------|
| `src/styles/index.css` | `.poker-table-gradient` 绿色毡面主题 | plugin 提供 `meta.tableThemeClass`，或 CSS 变量方案 |

### 遗漏模块 2: Debug 工具

| 文件 | 问题 | 处理 |
|------|------|------|
| `src/debug/state-logger.ts` | 引用 `holeCards`, `communityCards`, `pot` 等字段 | 改为读 `state` 泛型对象，不解构游戏特定字段 |
| `src/main.tsx` | 暴露 `window.pokerDebug` | 改为 `window.gameDebug`，从 plugin.meta.gameType 取名 |

### 遗漏模块 3: 牌桌渲染底层组件

| 文件 | 问题 | 处理 |
|------|------|------|
| `src/components/game/GameFooter.tsx` | 显示手牌号/盲注等德扑信息 | 改为读 plugin.meta 通用字段，或移入 plugin.BoardComponent 内部 |
| `src/components/game/LiveRanking.tsx` | 按"筹码"排名 | 改标签为 `plugin.meta.scoreLabel`，排序逻辑通用（按数值降序） |
| `src/components/game/RankingPanel.tsx` | 终局排名面板，计算"盈亏" | 改标签 + 移入 plugin 或读 meta |
| `src/components/game/GameParams.tsx` | "小盲注 = 小注÷2" 等德扑特定配置 UI | **整体移入 poker/ui/PokerSetup.tsx**（即 plugin.SetupComponent） |

### 遗漏模块 4: 座位系统

| 文件 | 问题 | 处理 |
|------|------|------|
| 多处 | 硬编码 `6` 座、`% 6` 取模、6 座位 CSS 布局 | 座位数从 `plugin.meta.maxPlayers` 读取，布局组件参数化 |
| GamePage 的 `getBadge()` | 硬编码 D/SB/BB badge | plugin.BoardComponent 内部处理角色标识（德扑: D/SB/BB，斗地主: 地主/农民） |

### 遗漏模块 5: 牌型系统

| 文件 | 问题 | 处理 |
|------|------|------|
| `src/types/card.ts` | 52 张标准牌 (无 Joker) | 移入 `games/poker/engine/poker-types.ts`。斗地主 54 张牌(含大小王)自己定义 |
| `src/engine/evaluator.ts` | 德扑手牌评估 | 移入 `games/poker/engine/` |
| `src/engine/equity.ts` | Monte Carlo equity | 移入 `games/poker/engine/` |
| `src/engine/pot-manager.ts` | 边池计算 | 移入 `games/poker/engine/` |

### 遗漏模块 6: session-store 默认提示词

| 文件 | 问题 | 处理 |
|------|------|------|
| `src/store/session-store.ts` line 42 | 200+ 字德扑 GTO 策略提示词作为默认值 | 移入 `plugin.defaultConfig.defaultSystemPrompt`，store 从 plugin 读默认值 |

### 更新后的完整可切换模块清单 (14 个)

| # | 模块 | 接口/来源 | 联动方式 |
|---|------|----------|---------|
| 1 | 引擎 | `EngineProtocol` | `plugin.createEngine()` |
| 2 | 上下文拼装 | `ContextBuilder` | `plugin.contextBuilder` |
| 3 | Response Parser | `ResponseParser` | `plugin.responseParser` |
| 4 | Bot 策略 | `BotStrategy` | `plugin.botStrategy` |
| 5 | 印象维度 | `ImpressionConfig` | `plugin.impressionConfig` |
| 6 | 牌桌 UI | `BoardComponent` | `plugin.BoardComponent` |
| 7 | 座位 UI | `SeatComponent` | `plugin.SeatComponent` |
| 8 | 配置面板 | `SetupComponent` | `plugin.SetupComponent` |
| 9 | 历史详情 | `HistoryDetailComponent` | `plugin.HistoryDetailComponent` |
| 10 | 牌型/Card 定义 | 游戏内部类型 | `games/{game}/engine/` 内部 |
| 11 | DB Schema | Dexie 表定义 | `plugin.dbSchema` |
| 12 | 默认配置+提示词 | `TConfig` | `plugin.defaultConfig` |
| 13 | UI 标签 | meta | `plugin.meta.scoreLabel / roundLabel / tableThemeClass` |
| 14 | 排名/Footer/角色标识 | 嵌入 BoardComponent | `plugin.BoardComponent` 内部子组件 |

```
src/
├── core/                              # 平台层（游戏无关）
│   ├── protocols/
│   │   ├── engine.protocol.ts
│   │   ├── gateway.protocol.ts
│   │   ├── plugin.protocol.ts
│   │   └── index.ts
│   ├── types/base.ts
│   ├── gateway/gateway.ts             # Gateway 实现 (~300行)
│   ├── registry/game-registry.ts      # registerGame() / getGame()
│   └── utils/ema.ts
│
├── agent/                             # LLM 基础设施（游戏无关）
│   ├── llm-client.ts
│   ├── player-adapter.ts
│   └── index.ts
│
├── games/
│   ├── poker/
│   │   ├── engine/                    # poker-engine, evaluator, equity, pot-manager, poker-types
│   │   ├── agent/                     # poker-context(ContextBuilder), poker-parser, poker-bot, poker-impressions
│   │   ├── ui/                        # PokerBoard, PokerSeat, PokerHistory, PokerSetup
│   │   └── poker-plugin.ts
│   └── (doudizhu/)                    # 未来: 斗地主（同构）
│       ├── engine/                    # doudizhu-engine, card-combos, landlord-logic
│       ├── agent/                     # doudizhu-prompts, parser, bot, impressions
│       ├── ui/                        # DoudizhuBoard, DoudizhuSeat, DoudizhuSetup
│       └── doudizhu-plugin.ts
│
├── store/game-store.ts                # 通过 Gateway 编排
├── components/shared/                 # ThinkingBubble, ImpressionPanel, ChipChart (通用分数曲线)
├── pages/
│   ├── GamePage.tsx                   # 动态加载 plugin.BoardComponent
│   ├── SetupPage.tsx                  # 壳: 通用 API profile + 动态加载 plugin.SetupComponent
│   └── HistoryPage.tsx                # 壳: 通用列表 + 动态加载 plugin.HistoryDetailComponent
└── db/database.ts                     # 核心表 + plugin schema 合并
```

---

## 六、迁移计划 (5 阶段，德扑全程可用)

### Phase 1: 提取协议接口 (2-3 天)
零行为变更，只新增 `src/core/` 下的接口文件和 base types。移动 ema.ts（旧位置留 re-export）。配置 tsconfig paths。

**验证**: `npm run build` 通过，app 完全不变

### Phase 2: 搬迁德扑代码到 games/poker/ (3-4 天)
逐个子系统移动 + 修 import。每次移动后 build 验证。旧位置留 re-export shim。同时移动 llm-client/player-adapter 到 `src/agent/`。

移动顺序:
1. **引擎核心** → `games/poker/engine/`: game-engine, evaluator, equity, pot-manager, deck
2. **牌型定义** → `games/poker/engine/poker-types.ts`: types/card.ts, types/action.ts 的德扑专属部分
3. **Bot 决策** → `games/poker/agent/`: bot-ai, preflop-ranges
4. **上下文拼装+解析** → `games/poker/agent/`: prompt-builder + buildRetryPrompt + buildHandSummary → `poker-context.ts`(implements ContextBuilder), response-parser → `poker-parser.ts`, impression-manager → `poker-impressions.ts`
5. **牌桌 UI** → `games/poker/ui/`: PokerTable, PlayerSeat(德扑部分), CommunityCards, PotDisplay, BetChip
6. **配置 UI** → `games/poker/ui/PokerSetup.tsx`: 从 SetupPage + GameParams 提取盲注/筹码/座位配置
7. **历史详情** → `games/poker/ui/PokerHistory.tsx`: HandDetail 的德扑按街回放
8. **排名/Footer** → `games/poker/ui/`: RankingPanel, LiveRanking, GameFooter 中德扑特定部分
9. **共享基础设施** → `src/agent/`: llm-client, player-adapter
10. **CSS** → 提取 `.poker-table-gradient` 到 `games/poker/ui/poker.css`
11. **Debug** → `state-logger.ts` 泛化，`main.tsx` 的 `pokerDebug` 改为 `gameDebug`

**验证**: 每次移动后 build + 手动测试

### Phase 3: 实现 Gateway + 德扑适配 Protocol (3-4 天)
Gateway 为事务管控中心。PokerEngine 适配 EngineProtocol（Gateway 层 structuredClone 包装 mutation → 返回 ActionResult，引擎内部几乎不改）。德扑 prompt/parser/bot/impression 适配各自接口。组装 poker-plugin.ts。实现 Gateway 类（~300行，含完整 LLM→解析→验证→执行→fallback 事务流）。

**验证**: Gateway 独立测试通过，app 仍通过旧路径工作

### Phase 4: Store + Pages 切换到 Gateway (2-3 天)
1. game-store 改为调 Gateway（initGame/processNextAction/playerAction/triggerImpressionUpdates）
2. session-store key 改为 `{gameType}-session-config`，默认值从 `plugin.defaultConfig` 读
3. **SetupPage 改为壳**: 通用部分(API profile/座位列表) + `plugin.SetupComponent`(游戏配置)
4. **HistoryPage 改为壳**: 通用 session 列表 + `plugin.HistoryDetailComponent`(详情渲染)
5. **ChipChart 标签改为** `plugin.meta.scoreLabel` / `plugin.meta.roundLabel`
6. **导航保护**: 对局中禁止进配置页/切换游戏，允许进历史页
7. GamePage 动态加载 plugin.BoardComponent
8. 删除旧 re-export shim

**验证**: 完整德扑对局全功能正常 + `grep -r "games/poker" src/store/ src/core/ src/agent/ src/pages/` → 0 结果

### Phase 5: 斗地主骨架验证 (2-3 天)
最小斗地主实现（3人，基础出牌规则: 单张/对子/三带/顺子/炸弹，不含复杂链子）。注册 doudizhuPlugin，首页游戏选择。

验证清单:
- 首页可选"德州扑克"或"斗地主"
- 斗地主配置页显示"底分"而非"盲注"
- LLM 收到斗地主专属提示（不是德扑提示）
- 历史页正确显示斗地主的出牌回放（不是按街回放）
- 分数曲线标签显示"积分"而非"筹码"
- 切回德扑一切正常

---

## 七、依赖规则

```
✅ games/*     → core/*, agent/*
✅ store/*     → core/*, agent/*
✅ pages/*     → store/*, core/registry/*
❌ core/*      → games/* (禁止)
❌ agent/*     → games/* (禁止)
❌ store/*     → games/* (禁止, 通过 Gateway)
❌ games/A/*   → games/B/* (禁止)
```
