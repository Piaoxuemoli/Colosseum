# 系统架构详解 — Agent + 上下文工程

## 1. 整体分层

```
┌─ Presentation ──────────────────────────────────────────┐
│  React 19 + TailwindCSS 4 (MD3 Design Tokens)           │
│  @floating-ui/react (智能气泡定位)                        │
│  Pages: SetupPage → GamePage → HistoryPage               │
│  Dual-mode: PlayerView (参与) / SpectatorView (上帝视角)  │
├─ State Orchestration ───────────────────────────────────┤
│  Zustand 5 Stores (game / app / profile / session)       │
│  game-store: 引擎代理 + 异步行动循环 + 流式思考推送       │
├─ Game Engine (Pure TS, zero UI deps) ───────────────────┤
│  GameEngine 状态机: waiting→preflop→flop→turn→river→showdown│
│  Hand Evaluator: C(7,5) 组合枚举，9 级手牌排名            │
│  Monte Carlo Equity: 单人 / 多人同时计算                   │
│  Pot Manager: 多级边池，排除弃牌玩家                       │
├─ Agent Layer (LLM Integration) ─────────────────────────┤
│  PlayerAdapter 接口: Human / Bot / LLM 统一抽象            │
│  LLM Client: OpenAI 兼容 + SSE Streaming                  │
│  Prompt Builder: 系统消息 + 决策请求 + 印象请求             │
│  Response Parser: CoT 提取 + 动作校验 + 重试 + 兜底        │
│  Impression Manager: 跨手对手建模                          │
├─ Persistence ───────────────────────────────────────────┤
│  Dexie.js 4 → IndexedDB                                  │
│  Tables: profiles / sessions / handHistories / impressions│
└─────────────────────────────────────────────────────────┘
```

## 2. Agent 决策架构

### 2.1 适配器模式

三种玩家类型通过统一接口决策：

```typescript
interface PlayerAdapter {
  decide(player: Player, gameState: GameState, validActions: AvailableAction[]): Promise<DecisionResult>
}

interface DecisionResult {
  type: ActionType    // fold / check / call / bet / raise / allIn
  amount: number
  thinking?: string   // LLM 的 CoT 思考内容
}
```

| 适配器 | 决策机制 | 延迟 |
|--------|----------|------|
| HumanAdapter | 返回 pending Promise，UI 按钮点击时 resolve | 用户决定 |
| BotAdapter | 位置范围表 + Monte Carlo 胜率 + 随机扰动 | ~10ms |
| LLMAdapter | OpenAI API 调用 + 流式 CoT + 响应解析 + 全局超时控制 | 2-30s（或不限制） |

### 2.2 LLM Agent 完整决策流程

```
1. game-store.processNextAction()
   │
2. 获取当前玩家 + 合法动作列表
   │
3. LLMAdapter.decide()
   │
   ├─ 4a. prompt-builder.buildSystemMessage()
   │      → 角色设定 + 扑克规则 + 对手印象 + 人设
   │
   ├─ 4b. prompt-builder.buildDecisionRequest()
   │      → 手牌号 + 底牌 + 位置 + 筹码 + 公共牌 + 底池
   │        + 本手所有行动记录 + 合法操作列表(含金额范围)
   │
   ├─ 5. callLLMStreaming(profile, messages, onChunk)
   │      → SSE 流式读取
   │      → onChunk 中实时提取 <thinking> 标签内容
   │      → 通过 onThinkingUpdate 回调推送到 Zustand store
   │      → UI 实时渲染思考气泡
   │
   ├─ 6. response-parser.parseThinkingAndAction(response)
   │      → 正则提取 <thinking>...</thinking>
   │      → 正则提取 <action>{"type":"raise","amount":200}</action>
   │
   ├─ 7. response-parser.validateAction(parsed, validActions)
   │      → 检查 type 是否在合法列表中
   │      → 模糊匹配: bet↔raise 互换, check→call 降级
   │      → 金额 clamp 到 [min, max] 范围
   │      → 超额自动转 allIn
   │
   ├─ 8. 失败路径: 解析失败 → 构建重试 prompt → 再调用一次
   │
   └─ 9. 最终兜底: fold (永远不会卡住)
```

### 2.3 上下文工程 (Prompt Engineering)

#### System Message 结构

```
你是 {playerName}，一位德州扑克玩家。
{systemPrompt — 自定义人设/策略指令}

【游戏规则】
- 6人桌无限注德州扑克
- 每条街最多加注 2 次
- 全下(all-in)不受加注次数限制
- 位置: BTN, SB, BB, UTG, MP, CO

【你对其他玩家的印象】
- Claude: 翻前很紧，翻后爱诈唬
- GPT-4o: 激进，经常3-bet
(每手更新，≤20字/人)

【输出格式】
<thinking>你的分析过程</thinking>
<action>{"type":"raise","amount":200}</action>
```

#### Decision Request 结构

```
【第 5 手】
你的底牌: A♥ K♠
你的位置: CO (关口位)
筹码: $1,850

公共牌: 10♠ J♠ 2♥
底池: $240

== 本手行动记录 ==
翻前:
  Bot(SB) 支付小盲注 $5
  GPT-4o(BB) 支付大盲注 $10
  Claude(UTG) 加注到 $30
  你(CO) 跟注 $30
翻牌:
  Claude(UTG) 下注 $50

== 你可以执行的操作 ==
- fold: 弃牌
- call: 跟注 $50
- raise: 加注 (最小 $100, 最大 $1820)
- allIn: 全下 $1820
```

#### 印象更新请求

每手结束后，额外调用 LLM 生成对手印象：

```
你是 {name}。以下是刚结束的第 5 手摊要:
{手牌摘要: 谁做了什么，结果如何}

你当前对其他玩家的印象:
- Claude: 翻前很紧
- Bot: 比较被动

请更新你的印象(≤20字/人)。
<impressions>
- Claude: 新印象
- Bot: 新印象
</impressions>
```

**关键设计**: 详细的行动记录只在当手的 User Message 中出现，手结束后被"蒸馏"为印象（≤20字/人），从而控制 context 长度不随手数线性增长。

### 2.4 错误恢复与鲁棒性

| 故障场景 | 处理策略 |
|----------|----------|
| API 超时 | 全局 AbortController 控制总超时 → fold。超时值 0 表示不限制 |
| 响应格式错误 | 重试 1 次(带纠错 prompt) → fold |
| 动作类型非法 | 模糊匹配(bet↔raise, check→call) |
| 金额超范围 | clamp 到 [min, max] |
| 流式失败(非超时) | 自动回退到非流式 callLLM |
| 流式超时 | 直接传播超时错误(不回退，防止超时叠加) |
| 并发行动 | 模块级 `isProcessingAction` 锁 |
| 人类双击 | 200ms 防抖 |

### 2.5 思考链展示时序

```
LLM 决策中:
  onChunk → 实时更新 llmThoughts[playerId]
  UI: 优先展示 llmThoughts 内容（非 "思考中..." 占位符）

LLM 决策完成后:
  1. 记录完整 thinking 到引擎 + store
  2. 等待 minActionInterval（此等待在 LLM 返回之后，非并行）
  3. 执行行动 engine.executeAction()
  → 确保用户先看到完整思考，再看到行动
```

### 2.6 超时控制架构

```
LLMAdapter.decide()
  │
  ├─ 创建全局 AbortController（timeoutMs > 0 时）
  │
  ├─ callLLMStreaming(signal) ← 全局 signal
  │    └─ combinedSignal() 合并外部 signal + 本地超时
  │
  ├─ 失败重试: callLLM(signal) ← 同一个全局 signal
  │
  └─ finally: clearTimeout

timeoutMs === 0 → 不设置 AbortController → 无限等待
UI: ThinkingBubble 倒计时模式 vs 已用时间模式
```

### 2.7 智能气泡定位 (Floating UI)

思考气泡使用 `@floating-ui/react` 实现自适应定位：

```typescript
const { refs, floatingStyles } = useFloating({
  open: showBubble,
  placement: preferredSide,  // 根据座位位置给初始偏好
  middleware: [
    offset(12),              // 与头像间距 12px
    autoPlacement({           // 自动找到不遮挡的位置
      allowedPlacements: ['left', 'right', 'top', 'bottom'],
    }),
    shift({ padding: 8 }),   // 防止超出视口边界
  ],
})
```

- **Reference 元素**: 玩家座位整体 div（头像+名字+筹码）
- **Floating 元素**: ThinkingBubble
- `autoPlacement` 自动选择空间最大的方向
- `shift` 确保不超出容器边界
- 手牌、筹码、BetChip 位置完全不变

## 3. 游戏引擎状态机

```
                 startNewHand()
                      │
    ┌─────────────────▼─────────────────┐
    │            PREFLOP                 │
    │  发 2 张底牌, 收盲注, UTG 先行动   │
    │  (Heads-up: dealer=SB 先行动)      │
    └────────────────┬──────────────────┘
                     │ 所有人 acted + bet matched
    ┌────────────────▼──────────────────┐
    │              FLOP                  │
    │  发 3 张公共牌, 重置下注           │
    └────────────────┬──────────────────┘
                     │
    ┌────────────────▼──────────────────┐
    │              TURN                  │
    │  发 1 张公共牌                     │
    └────────────────┬──────────────────┘
                     │
    ┌────────────────▼──────────────────┐
    │             RIVER                  │
    │  发 1 张公共牌                     │
    └────────────────┬──────────────────┘
                     │
    ┌────────────────▼──────────────────┐
    │           SHOWDOWN                 │
    │  评估手牌, 计算边池, 分配赢家       │
    │  保存历史, 触发印象更新             │
    │  只剩1人有筹码 → 弹出排名面板       │
    │  autoPlay → 2s 后自动下一手         │
    └───────────────────────────────────┘

    特殊路径:
    - 只剩 1 人未弃牌 → 直接 SHOWDOWN(最后玩家赢)
    - 仅 ≤1 人可行动 → runOutBoard() 自动发完公共牌
```

## 4. 多人胜率计算

```typescript
function calculateMultiPlayerEquity(
  players: { playerId: string; holeCards: Card[] }[],
  communityCards: Card[],
  simulations: number = 2000
): PlayerEquity[]
```

- 每次模拟: 补全公共牌 → 评估所有玩家手牌 → 找到赢家
- 平局时各玩家获得 0.5 分
- 在 `syncState()` 后异步计算，不阻塞 UI
- 翻牌/转牌用 1500 次模拟，河牌用 3000 次

## 5. 数据持久化与存储架构

本项目**无后端服务器**，是纯前端 SPA。所有数据存储在浏览器本地，分三层：

### 5.1 存储架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                   浏览器本地存储                              │
│                                                             │
│  ┌─ Zustand 内存 Store ──────────────────────────────────┐  │
│  │  app-store    : 当前页面、视角模式                      │  │
│  │  game-store   : GameEngine、牌局状态、思考链、动画      │  │
│  │  session-store: 当前 sessionId、座位配置               │  │
│  │  profile-store: API Profile 缓存                      │  │
│  │  history-store: 牌谱列表缓存、回放状态                  │  │
│  │                                                       │  │
│  │         ▲ 初始化时加载           │ 变更时写入           │  │
│  └─────────┼─────────────────────────┼───────────────────┘  │
│            │                         │                       │
│            │                         ▼                       │
│  ┌─ IndexedDB (Dexie.js) ───────────────────────────────┐   │
│  │                                                       │   │
│  │  ┌──────────────┐  ┌──────────────┐                   │   │
│  │  │ apiProfiles   │  │  sessions    │                   │   │
│  │  │──────────────│  │──────────────│                   │   │
│  │  │ id ✦         │  │ id ✦         │                   │   │
│  │  │ name         │  │ timestamp    │                   │   │
│  │  │ baseURL      │  │ seats[]      │                   │   │
│  │  │ apiKey       │  │ smallBlind   │                   │   │
│  │  │ model        │  │ bigBlind     │                   │   │
│  │  │ provider     │  │ minActionInt │                   │   │
│  │  └──────────────┘  │ thinkingTimeout                  │   │
│  │                     └──────────────┘                   │   │
│  │  ┌──────────────┐  ┌──────────────────┐               │   │
│  │  │handHistories │  │  impressions     │               │   │
│  │  │──────────────│  │──────────────────│               │   │
│  │  │ id ✦         │  │ [sessionId       │               │   │
│  │  │ sessionId ⚿  │  │  +playerId] ✦   │               │   │
│  │  │ handNumber ⚿ │  │ sessionId ⚿     │               │   │
│  │  │ timestamp ⚿  │  │ impressions{}   │               │   │
│  │  │ players[]    │  └──────────────────┘               │   │
│  │  │ streets{}    │                                     │   │
│  │  │ winners[]    │     ✦ = 主键  ⚿ = 索引             │   │
│  │  │ llmThoughts  │                                     │   │
│  │  │ llmImpressions│                                    │   │
│  │  └──────────────┘                                     │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ localStorage ────────────────────────────────────────┐   │
│  │  Key: 'poker-arena-session-config'                     │   │
│  │  Val: { seats[], smallBlind, bigBlind, defaultChips,   │   │
│  │         minActionInterval, thinkingTimeout }            │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 三层存储职责划分

| 存储层 | 存什么 | 生命周期 | 访问方式 |
|--------|--------|----------|----------|
| **Zustand 内存** | 运行时状态：引擎实例、思考气泡、动画、倒计时、实时胜率 | 刷新即丢 | `useXxxStore()` Hook |
| **IndexedDB** | 持久化结果：牌谱、API配置、场次元数据、印象 | 永久（除非用户清除） | Dexie.js async API |
| **localStorage** | 用户偏好：座位/参数配置 | 永久 | 同步 read/write |

### 5.3 IndexedDB 四张表详解

```
数据库名: PokerTrainerDB (Dexie.js v4)

┌───────────────────────────────────────────────────────────┐
│ Table: apiProfiles                                         │
│ 索引: id (PK), name                                       │
│ 写入时机: 用户在 Setup 页添加/编辑/删除 API 配置           │
│ 读取时机: 页面初始化 loadProfiles()                        │
│ 管理者: profile-store ↔ profile-service                   │
├───────────────────────────────────────────────────────────┤
│ Table: sessions                                            │
│ 索引: id (PK), timestamp                                  │
│ 写入时机: 点击"开始游戏"时 createSession() 异步写入         │
│ 内容: 场次快照(座位配置、盲注、超时参数)                    │
│ 管理者: session-store                                      │
├───────────────────────────────────────────────────────────┤
│ Table: handHistories                                       │
│ 索引: id (PK), sessionId, handNumber, timestamp            │
│ 写入时机: 每局结束(showdown)时 saveHistory() 异步写入       │
│ 内容: 完整牌谱(玩家快照、每条街动作、公共牌、赢家、         │
│       LLM思考链、LLM印象快照)                              │
│ 管理者: game-store → history-service                       │
├───────────────────────────────────────────────────────────┤
│ Table: impressions                                         │
│ 索引: [sessionId+playerId] (复合PK), sessionId             │
│ 写入时机: 每局结束后后台调用 triggerImpressionUpdates()     │
│ 内容: 每个 LLM 对其他玩家的印象 (≤20字/人)                │
│ 管理者: game-store → impression-service                    │
└───────────────────────────────────────────────────────────┘
```

### 5.4 localStorage 用途

仅存储一个 key：

```
Key:   'poker-arena-session-config'
Value: {
  seats: [{ seatIndex, type, name, profileId?, systemPrompt?, chips }],
  smallBlind: 5,
  bigBlind: 10,
  defaultChips: 1000,
  minActionInterval: 1500,
  thinkingTimeout: 30000
}
```

**选择 localStorage 而非 IndexedDB 的原因**: 配置数据量小（<2KB）、需要同步读取（页面打开立即恢复上次配置）、不需要索引查询。

### 5.5 五个 Zustand Store 的持久化策略

| Store | 关键状态 | 持久化目标 | 写入策略 |
|-------|----------|-----------|----------|
| **app-store** | currentPage, gameMode | ❌ 无 | 纯内存 |
| **profile-store** | profiles[] | IndexedDB.apiProfiles | write-through: 改内存同时异步写 DB |
| **session-store** | sessionId, config | localStorage + IndexedDB.sessions | config → localStorage(同步), session → IndexedDB(异步) |
| **game-store** | engine, gameState, llmThoughts, impressions, impressionHistory, showRanking | IndexedDB.handHistories + impressions | showdown 时写牌谱, 每局后写印象 |
| **history-store** | histories[], sessions[], replayState | IndexedDB.handHistories (只读+删除) | 初始化时全量加载, 删除时同步删 DB |

### 5.6 数据流时序

```
用户打开页面
    │
    ├→ profile-store.loadProfiles()  ◄── IndexedDB.apiProfiles
    ├→ session-store.loadConfig()    ◄── localStorage
    └→ (Setup 页就绪)
          │
          │  用户调整座位/参数
          ├→ session-store.updateSeat()  ──→ localStorage (同步)
          │
          │  用户点击"开始游戏"
          ├→ session-store.createSession()
          │    └→ IndexedDB.sessions.put()        (异步, fire-and-forget)
          │
          ├→ game-store.initGame()
          │    └→ 创建 GameEngine + Adapters      (纯内存)
          │
          │  游戏进行中...
          ├→ game-store.processNextAction()
          │    ├→ LLM 流式思考 → llmThoughts{}    (纯内存, 实时推送 UI)
          │    ├→ 倒计时 → thinkingStartTime       (纯内存)
          │    └→ 胜率计算 → playerEquities[]       (纯内存)
          │
          │  一局结束 (showdown)
          ├→ saveHistory(handHistory)
          │    └→ IndexedDB.handHistories.put()    (异步)
          │
          ├→ triggerImpressionUpdates()            (后台异步)
          │    ├→ 调用 LLM 生成新印象
          │    ├→ applyImpressions(player, updates) (内存: player.impressions Map)
          │    ├→ 追加到 impressionHistory[]          (内存: 跟踪更新手数)
          │    └→ saveImpressions(sessionId, playerId, data)
          │         └→ IndexedDB.impressions.put() (异步)
          │
          │  用户查看历史页
          └→ history-store.loadHistories()  ◄── IndexedDB.handHistories
               └→ buildSessionSummaries()          (内存中按 sessionId 分组)
```

### 5.7 错误处理策略

所有存储写入均采用 **fire-and-forget + catch log** 模式：

```typescript
saveHistory(lastHandHistory).catch(console.error)
saveImpressions(sessionId, playerId, allImpressions).catch(console.error)
db.sessions.put({ ... }).catch(console.error)
```

**设计理由**: 存储失败不应阻断游戏进行。最坏情况是丢失一条历史记录或一次印象更新，不影响当前游戏状态。localStorage 写入失败也静默处理（try-catch 空 catch）。

### 5.8 关键设计决策

1. **无后端**: 浏览器直连各 LLM API provider，API Key 存在用户本地 IndexedDB，不经过中间服务器
2. **Write-through 缓存**: Zustand store 作为 IndexedDB 的内存缓存，修改时同时更新两处，读取时优先走内存
3. **选择性持久化**: 只持久化"结果"（牌谱、配置），不持久化"过程"（思考气泡、动画、实时胜率），平衡存储成本与数据价值
4. **印象蒸馏**: 每手的详细行动记录（可能数千字）被 LLM "蒸馏"为 ≤20 字/人 的印象存入 DB，控制跨手 context 长度恒定
