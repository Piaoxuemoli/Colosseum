# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 也请参阅 `AGENTS.md` —— 通用 AI 协作指南，含 UI 设计规范与部署流程。

## 项目概述

LLM Poker Arena / Colosseum：纯前端的多 AI 博弈对战平台。最初聚焦 6-max 无限注德州扑克，现已通过 Plugin 架构扩展到斗地主，未来可再接入其他游戏。用户可作为玩家参与或以上帝视角观战。

**技术栈**: React 19 · TypeScript 5.9 · Vite 7 · TailwindCSS 4 · Zustand 5 · Dexie.js · @floating-ui/react · Vitest 4

## 常用命令

```bash
npm run dev        # Vite dev server + 内置 /api/proxy CORS 中间件 → http://localhost:5173
npm run build      # tsc -b && vite build（服务器 tsc 启用 noUnusedLocals/noUnusedParameters，比默认严）
npm run preview    # 预览 build 产物
npm run lint       # ESLint（flat config, eslint.config.js）
npm test           # Vitest 一次性运行
npm run test:watch # Vitest watch 模式
npm start          # 启动独立的 Node CORS 代理（ops/server/proxy-server.mjs，生产/本地无 Vite 时使用）
```

跑单个测试：

```bash
npx vitest run path/to/file.test.ts
npx vitest run -t "测试名关键字"
```

部署到云服务器（`43.156.230.108:3000`，Docker 多阶段构建）：详见 `ops/deploy/README.md`，连接信息在 `ops/private/deploy.env`（私有文件，不入库）。部署前务必本地 `npm run build` 以复现服务器严格 `tsc` 的错误。

## 核心架构原则

### 0. 游戏自治原则 ⚠️ 最高优先级

每个游戏拥有自己完整的一套：**引擎 + store + 游戏页面 + Agent 模块**。凡是与游戏规则/状态/UI 强耦合的模块，都必须每个游戏各写一份，**禁止** 在一个文件里用 `if (gameType === 'poker')` 分支区分游戏。

- 独立：`src/games/<game>/engine/` · `src/games/<game>/store/` · `src/games/<game>/ui/` · `src/games/<game>/agent/` · `src/games/<game>/<game>-plugin.ts`
- 共享（平台级）：`useActionQueue` hook、`ThinkingBubble` / `ThinkingOverlay`、`PlayerActionLog` / `SpectatorActionLog`、`ApiConfigCard/Modal`、`SeatConfigCard`、`TimingParamsSection`、`Gateway`、`callLLMStreaming`、以及 `session-store` / `profile-store` / `app-store`

新增游戏须遵循 UI 设计规范（右侧 w-80 tabs 面板、思维气泡 + backdrop-blur、卡牌对比度、当前回合高亮 + ring-2 + animate-pulse）——详见 `AGENTS.md`。

### 1. Plugin + Registry 架构

- 每个游戏暴露一个 `GamePlugin`（见 `src/core/protocols/plugin.protocol.ts`），内含 `createEngine` / `contextBuilder` / `responseParser` / `botStrategy` / `impressionConfig` / `meta` / UI 组件。
- `src/games/index.ts::registerAllGames()` 在启动时向 `src/core/registry/game-registry.ts` 注册所有插件。
- `src/App.tsx` 根据 `app-store.activeGameType` 路由：**poker 走老的专属页面**（`SetupPage` / `GamePage` / `HistoryPage`），其他游戏走通用 `Plugin*Page` 壳。新增游戏时走 Plugin 路径，不要改动 poker 路径。
- `src/core/gateway/gateway.ts` 统一封装 LLM 事务（action / impression update），所有游戏通过 Gateway 调 LLM。

### 2. 引擎 / UI 完全分离

游戏引擎在 `src/games/<game>/engine/` 下，纯 TypeScript，**零 React 依赖**。UI 通过该游戏自己的 store 调用引擎方法并同步状态。老的 `src/engine/` 目录现在只保留 `bot/` 和 `llm/__tests__/`，不要往里加新业务逻辑。

### 3. 适配器模式处理玩家决策

```ts
interface PlayerAdapter {
  decide(player, gameState, validActions): Promise<DecisionResult>
}
```

- **HumanAdapter**: 返回 Promise，UI 提交时 resolve
- **BotAdapter**: 包装同步规则策略为 async
- **LLMAdapter**: 流式调用 OpenAI 兼容 API，实时提取 `<thinking>`。全局 AbortController 控制总超时，`thinkingTimeout === 0` 表示不限制时间

代码位置：`src/agent/player-adapter.ts`、`src/agent/llm-client.ts`。每个游戏的 ContextBuilder / ResponseParser / BotStrategy 在 `src/games/<game>/agent/` 内实现 `src/core/protocols/context.protocol.ts` 定义的接口。

### 4. LLM 提示词工程

- **ContextBuilder**（如 `poker-context.ts`）：中文系统消息（角色 + 规则 + 对手印象 + 局势），要求 `<thinking>...<action>{"type":"raise","amount":100}` 格式输出
- **ResponseParser**（如 `poker-parser.ts`）：解析回复，模糊匹配（`bet↔raise`、`check→call`、超额 → `allIn`），失败重试 1 次，兜底 `fold`
- **ImpressionManager**：每手结束后 LLM 更新对手印象（`impression-service.ts` 写 IndexedDB，`structured-impression-service.ts` 走结构化多维度）

### 5. 流式思考输出

`callLLMStreaming()` 通过 SSE 实时读取，`onThinkingUpdate` 回调推送到 store，UI 实时渲染思考气泡。思考内容优先于"思考中..."占位符。**LLM 决策完成后会额外等待 `minActionInterval` 再执行动作**，保证用户看完整思考链。

### 6. 超时控制（重要语义）

- `thinkingTimeout > 0`：全局 AbortController 严格控制总超时，`ThinkingBubble` 显示倒计时
- `thinkingTimeout === 0`：不限制时间，等思考链完全加载，`ThinkingBubble` 显示已用时间
- **streaming 超时不再 fallback 到非流式**，直接传播错误（防止超时叠加）

### 7. 印象系统

每手结束后 LLM 更新对手印象并存 IndexedDB（`src/db/impression-service.ts`）。`impressionHistory` 记录每次更新的手数，UI 高亮本手变化的维度。印象维度由插件 `impressionConfig` 声明（例如德扑的 L/A/S/H）。

### 8. 对局管理

- `EndGameButton` 手动结束对局（确认式）
- `RankingPanel` 展示排名 / 筹码 / 盈亏；仅剩 1 位有筹码玩家时自动弹出
- 上帝视角由 `app-store.gameMode === 'spectator'` 控制，可见所有手牌

### 9. 智能气泡定位

`@floating-ui/react` 的 `useFloating` + `autoPlacement` + `offset` + `shift`：在 left/right/top/bottom 中自动选空间最大的方向，`shift` 防止超出视口。**手牌、筹码、BetChip 位置完全不变**。

### 10. CORS 代理

浏览器直连 LLM API 会跨域。有两个代理入口：

- **Dev**：`vite.config.ts` 中 `cors-proxy` 中间件处理 `POST /api/proxy`，body 为 `{ targetUrl, headers, body }`
- **Prod / 独立**：`ops/server/proxy-server.mjs`（`npm start`）

### 11. 状态管理

| Store | 职责 | 持久化 |
|-------|------|--------|
| `app-store` | 页面路由 + 视角模式 + `activeGameType` | 否 |
| `game-store` (poker) / `ddz-game-store` (doudizhu) | 引擎 + 对局状态 + autoPlay + 印象历史 + 排名 | 否 |
| `profile-store` | API 配置 CRUD | IndexedDB |
| `session-store` | 座位 / 盲注 / 超时配置（支持 0 = 不限制） | localStorage + IndexedDB |
| `history-store` | 历史对局索引、日志/筹码图切换模式 | IndexedDB |

## 文件导航

**游戏路由与入口**: `src/App.tsx`、`src/games/index.ts`（`registerAllGames`）、`src/core/registry/game-registry.ts`

**德扑专属**（走老页面）: `src/pages/GamePage.tsx`、`src/store/game-store.ts`、`src/games/poker/engine/poker-engine.ts`、`src/games/poker/agent/poker-{context,parser,bot,impressions,ema}.ts`

**斗地主 / 新游戏**（走 Plugin 壳）: `src/pages/Plugin{Setup,Game,History}Page.tsx`、`src/games/doudizhu/**`

**引擎核心**（按游戏拆分）: `poker-engine.ts` · `evaluator.ts` · `equity.ts` · `pot-manager.ts` · `deck.ts`（poker）/ `doudizhu-engine.ts` · `combo-detector.ts`（doudizhu）

**LLM / Agent 通用**: `src/agent/llm-client.ts`、`src/agent/player-adapter.ts`、`src/core/gateway/gateway.ts`、`src/core/protocols/*`

**UI 通用组件**: `src/components/game/PlayerSeat.tsx`（Floating UI 气泡）、`ThinkingBubble.tsx`、`LiveRanking.tsx`、`RankingPanel.tsx`、`ImpressionPanel.tsx`、`PlayerActionLog.tsx`

**历史回顾**: `HistoryPage.tsx`、`HandDetail.tsx`、`ChipChart.tsx`

**基础设施**: `vite.config.ts`（CORS 代理中间件）、`ops/server/proxy-server.mjs`、`ops/deploy/README.md`

## 编码规范

- 代码英文，UI 文案 / 注释中文
- 游戏引擎零 React 依赖，禁止在引擎中 import React/store
- 所有 LLM API 调用走 `llm-client.ts`；agent 协议走 Gateway
- 样式用 TailwindCSS 4 + MD3 design tokens（`src/styles/index.css`）
- 路由用 `app-store` 中的状态变量，**不用** react-router
- **不要** 在共享模块里用 `if (gameType === ...)` 分支 —— 把差异放进各游戏的 plugin / store / engine
- 部署前用 `npm run build` 本地跑一遍 `tsc -b`，服务器 `noUnusedLocals` / `noUnusedParameters` 严于编辑器默认

## 常见修改场景

| 场景 | 涉及文件 |
|------|----------|
| 调整德扑 LLM prompt | `src/games/poker/agent/poker-context.ts` |
| 修改德扑引擎规则 | `poker-engine.ts` + `getAvailableActions()` + `executeAction()` |
| 修改对局流程（poker） | `poker-engine.ts` + `src/store/game-store.ts` |
| 新增一个游戏 | 在 `src/games/<new>/` 下建 engine/store/ui/agent + plugin；在 `src/games/index.ts` 注册；走 Plugin*Page 壳 |
| 超时 / 限时设置 | `player-adapter.ts` + `llm-client.ts` + `TimingParamsSection` + `session-store.ts` |
| 印象系统 | `impression-service.ts` / `structured-impression-service.ts` + `ImpressionPanel.tsx` + plugin 的 `impressionConfig` |
| 气泡定位 | `PlayerSeat.tsx` (useFloating) + `ThinkingBubble.tsx` |
| 对局结束 / 排名 | `RankingPanel.tsx` + `LiveRanking.tsx` + `game-store.ts` (`endGame` / `dismissRanking`) |
| CORS / 代理 | `ops/server/proxy-server.mjs` + `vite.config.ts` |
| 部署到服务器 | `ops/deploy/README.md`；连接信息在 `ops/private/deploy.env` |
