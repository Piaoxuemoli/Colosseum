# AGENTS.md — LLM Poker Arena 项目上下文

> 供 AI 代码助手快速理解代码库并高效协作。另见 `CLAUDE.md` 获取 Claude Code 特定指南。

## 项目概述

LLM Poker Arena 是一个纯前端的多 AI 德州扑克对战平台。核心理念是让不同的 LLM（GPT-4o、Claude、Llama 等）在标准 6-max 无限注德州扑克规则下自主对弈，用户可作为玩家参与或以上帝视角观看。

**技术栈**: React 19 + TypeScript 5.9 + Vite 7 + TailwindCSS 4 + Zustand 5 + Dexie.js + @floating-ui/react

## 核心架构原则

### 0. 游戏自治原则 ⚠️ 最高优先级
**每个游戏拥有自己完整的一套：引擎 + store + 游戏页面 + Agent 模块。** 凡是与游戏规则/状态/UI 强耦合的模块，都必须每个游戏各写一份，禁止在一个文件里用 if/else 区分游戏类型。

**各游戏独立拥有（禁止共享）：**
- 引擎 (`src/games/<game>/engine/`) — 游戏状态机、规则、校验
- Store (`src/games/<game>/store/`) — 游戏对局状态管理、action 处理循环
- 游戏页面 (`src/games/<game>/ui/`) — 牌桌/棋盘渲染、操作面板
- Agent 模块 (`src/games/<game>/agent/`) — ContextBuilder、ResponseParser、BotStrategy
- Plugin 注册 (`src/games/<game>/<game>-plugin.ts`)

**平台级共享组件（所有游戏复用）：**
- `useActionQueue` hook — 通用的 bot/LLM action 队列驱动（监听 `isBotActing` → 调 `processNextAction`）
- `ThinkingBubble` / `ThinkingOverlay` — 思维气泡 + 展开弹窗（从 store 读 `llmThoughts`/`thinkingBotId`）
- `PlayerActionLog` / `SpectatorActionLog` — 右侧面板日志 + 思考链 tabs（接收 `ActionLogEntry[]` + `ThinkingChainEntry[]`）
- `ApiConfigCard/Modal` — API 配置管理
- `SeatConfigCard` — 座位配置
- `TimingParamsSection` — 动作间隔 / LLM 超时 / 角色描述
- `Gateway` — LLM 事务管控器
- `callLLMStreaming` — LLM 流式调用
- `session-store` / `profile-store` / `app-store` — 平台级状态

**UI 设计规范（新增游戏必须遵循）：**
- **右侧面板**: 使用通用 `PlayerActionLog`（2 tabs: 日志+思考链）或 `SpectatorActionLog`（3 tabs: +数据），w-80 固定宽度，带 auto-scroll、badge 动画、折叠展开
- **思维气泡**: 对手座位上方浮动显示，半透明背景 + backdrop-blur + 向下箭头，思考中显示 spinner
- **卡牌渲染**: 牌面背景用 `bg-on-surface`（白底），文字颜色必须保证对比度 — 黑色花色用 `text-neutral-800`，红色花色用 `text-red-500`，Joker 用 `text-red-500`/`text-blue-600`
- **当前回合标记**: 顶栏高亮当前出牌者名字 + 座位 ring-2 + animate-pulse + 弹跳箭头
- **上帝模式**: 通过 `app-store.gameMode === 'spectator'` 控制，对手手牌可见
- **状态栏**: 底部显示当前局数、阶段、轮到谁、倍数等实时信息

### 1. 引擎/UI 完全分离
`src/engine/` 是纯 TypeScript 逻辑层，零 React 依赖。`GameEngine` 管理完整德州扑克状态机。UI 通过 `game-store.ts` 调用引擎方法并同步状态。

### 2. 适配器模式处理玩家决策
```typescript
interface PlayerAdapter {
  decide(player, gameState, validActions): Promise<DecisionResult>
}
```
- **HumanAdapter**: 返回 Promise，UI 提交时 resolve
- **BotAdapter**: 包装同步策略为 async
- **LLMAdapter**: 流式调用 OpenAI 兼容 API，实时提取 `<thinking>` 内容。使用全局 AbortController 控制总超时，超时值 0 表示不限制时间

### 3. LLM 提示词工程 (`src/engine/llm/`)
- **prompt-builder.ts**: 中文系统消息（角色 + 规则 + 对手印象 + 局势），要求 `<thinking>...<action>{"type":"raise","amount":100}` 格式
- **response-parser.ts**: 解析回复，模糊匹配（bet↔raise、check→call、超额→allIn），失败重试 1 次，兜底 fold
- **impression-manager.ts**: 每手结束后 LLM 更新对手印象，存 IndexedDB

### 4. 流式思考输出
`callLLMStreaming()` 通过 SSE 实时读取，`onThinkingUpdate` 回调推送到 store，UI 实时渲染思考气泡。思考内容优先于 "思考中..." 占位符展示。LLM 决策完成后，会额外等待 minActionInterval 再执行行动，确保用户看到完整思考链。

### 5. 超时控制
- `thinkingTimeout > 0`: 全局 AbortController 严格控制总超时，ThinkingBubble 显示倒计时
- `thinkingTimeout === 0`: 不限制时间，等思考链完全加载，ThinkingBubble 显示已用时间
- streaming 超时不再 fallback 到非流式，直接传播错误（防止超时叠加）

### 6. 印象系统
- 每手结束后 LLM 更新对手印象，存 IndexedDB
- `impressionHistory` 记录每次更新的手数，UI 高亮本手变化的印象

### 7. 对局管理
- `EndGameButton` 支持手动结束对局（确认式交互）
- `RankingPanel` 展示排名、筹码、盈亏变化
- 当只剩 1 位有筹码的玩家时自动弹出排名面板

### 8. 智能气泡定位
- 使用 `@floating-ui/react` 的 `useFloating` + `autoPlacement` + `offset` + `shift` 实现思维气泡智能定位
- 自动在 left/right/top/bottom 中选择空间最大的方向放置气泡
- 手牌、筹码位置完全不变

### 9. CORS 代理服务器
- `ops/server/proxy-server.mjs`: Node.js CORS 代理，支持 Vite dev proxy 和生产环境

### 10. 部署
- 云服务器: `43.156.230.108:3000`，Docker 多阶段构建
- SSH 密钥: `ops/private/puke.pem`，连接配置: `ops/private/deploy.env`
- 完整部署 SOP: `ops/deploy/README.md`
- 流程: 本地打包 tar → scp 上传 → 服务器 rm 旧源码 + 解压 → `docker compose up -d --build`
- ⚠️ 服务器 `tsc -b` 开启了 `noUnusedLocals`/`noUnusedParameters`，比本地严格，部署前用 `tsc -b` 验证

### 11. 状态管理

| Store | 职责 | 持久化 |
|-------|------|--------|
| `app-store` | 页面路由 + 视角模式 | 否 |
| `game-store` | 引擎 + 对局状态 + autoPlay + 印象历史 + 排名 | 否 |
| `profile-store` | API 配置 CRUD | IndexedDB |
| `session-store` | 座位/盲注/超时配置（支持 0=不限制） | localStorage + IndexedDB |

## 文件导航

**高频修改**: `game-store.ts`、`GamePage.tsx`、`game-engine.ts`
**LLM 相关**: `llm-client.ts`、`prompt-builder.ts`、`response-parser.ts`、`player-adapter.ts`
**引擎核心**: `game-engine.ts`、`evaluator.ts`、`equity.ts`、`pot-manager.ts`
**游戏 UI**: `PlayerSeat.tsx`（Floating UI 气泡）、`ThinkingBubble.tsx`、`LiveRanking.tsx`、`RankingPanel.tsx`
**历史回顾**: `HistoryPage.tsx`、`HandDetail.tsx`、`ChipChart.tsx`、`history-store.ts`
**配置/基础设施**: `ops/server/proxy-server.mjs`、`vite.config.ts`

## 编码规范
- 代码英文，UI 文案/注释中文
- 引擎层（`engine/`）零 React 依赖
- 所有 LLM API 调用通过 `llm-client.ts`
- 样式用 TailwindCSS 4 + MD3 design tokens（`src/styles/index.css`）
- 路由用状态变量，不用 react-router

## 常见修改场景

| 场景 | 涉及文件 |
|------|----------|
| 调整 LLM prompt | `prompt-builder.ts` |
| 修改引擎规则 | `game-engine.ts` + `getAvailableActions()` + `executeAction()` |
| 新 UI 组件 | `src/components/game/` + `GamePage.tsx` 中 `enginePlayerToMock()` |
| 修改对局流程 | `game-engine.ts` + `game-store.ts` |
| 超时/限时设置 | `player-adapter.ts` + `llm-client.ts` + `GameParams.tsx` + `session-store.ts` |
| 印象系统 | `impression-manager.ts` + `ImpressionPanel.tsx` + `game-store.ts` |
| 气泡定位 | `PlayerSeat.tsx` (useFloating) + `ThinkingBubble.tsx` |
| 对局结束/排名 | `RankingPanel.tsx` + `LiveRanking.tsx` + `game-store.ts (endGame/dismissRanking)` |
| CORS/代理 | `ops/server/proxy-server.mjs` + `vite.config.ts` |
| 部署到服务器 | 详见 `ops/deploy/README.md`，连接信息在 `ops/private/deploy.env` |
