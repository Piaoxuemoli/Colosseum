# A2A 结合 A2UI 用于游戏配置页 — 可行性调研报告

> **调研日期**：2026-06-15  
> **调研范围**：Google A2UI 协议规范、项目内 A2A 实现现状、游戏配置页痛点分析  
> **结论**：**可行，但需裁剪 A2UI 协议适配项目场景**。推荐采用「A2UI 子集 + 静态配置页渲染」方案，而非完整的 SSE 流式协议。

---

## 1. 执行摘要

### 1.1 核心结论

| 问题 | 结论 |
|------|------|
| A2A 与 A2UI 能否结合使用？ | **能**。A2UI 被设计为 A2A 协议的 UI 层扩展，两者在协议层面天然互补。 |
| 项目配置页是否适合做成 A2UI？ | **适合**，但需裁剪。完整 A2UI 协议（SSE 流式、动态生成）对静态配置页过重，建议采用「A2UI 子集」方案。 |
| data.json + surface.json + handle.sh 方案可行吗？ | **可行**，这是将 A2UI 核心思想（声明式 UI + 数据分离）落地的最佳实践。 |
| 能否实现配置页完全自适应？ | **能**，前提是定义好 Catalog（组件目录）和绑定规范。 |

### 1.2 推荐方案速览

采用 **「A2UI 配置页子集」** 方案：

- **前端**：一个通用 `A2UIConfigRenderer` 组件，接收 `surface.json` + `data.json`，渲染配置表单。
- **游戏包**：每个游戏提供 `config/surface.json`（A2UI 格式的 UI 描述）+ `config/defaults.json`（配置数据默认值/Schema）。
- **无需 handle.sh**：在 TypeScript 生态中，用 Zod Schema 替代 shell 脚本做数据校验，更自然。
- **新增游戏**：只需复制一份 `surface.json` + `defaults.json`，**零前端代码**。

---

## 2. A2A 与 A2UI 协议概述

### 2.1 A2A（Agent-to-Agent）协议

Google 于 2025 年 4 月发布，用于解决 Agent 之间的协作问题。核心设计：

- **Agent Card**：每个 Agent 暴露的元数据（能力、端点、技能）。
- **Message 交换**：JSON-RPC 2.0 + SSE 流式，支持 `message:send` / `message:stream`。
- **Artifact 机制**：Agent 返回 `text`（思考链）或 `data`（结构化决策）。

**项目现状**：`src/backend/a2a-core/` 已实现完整 A2A v0.3 客户端 + 服务端，包括：
- `client.ts` — `requestAgentDecisionRpc` / `requestAgentDecisionToy`
- `agent-card.ts` — Agent Card 构建
- `types.ts` — A2A 类型定义（从 `@a2a-js/sdk` 导出）
- `sse-writer.ts` / `server-helpers.ts` — SSE 流式响应

### 2.2 A2UI（Agent-to-User-Interface）协议

Google 于 2025 年 12 月发布，是 A2A 协议的 UI 层扩展。核心设计：

- **声明式 JSON**：Agent 用 JSON 描述 UI 组件树，而非返回 HTML/JS。
- **三大分离**：UI 结构（`surfaceUpdate`）+ 数据状态（`dataModelUpdate`）+ 客户端渲染（Catalog）。
- **Catalog 系统**：客户端定义可用组件目录（如 `Row`, `Column`, `Text`, `Button`, `TextField` 等），Agent 只能使用目录内组件，保证安全。
- **JSONL 流式**：通过 SSE 流逐行发送 JSON，支持渐进式渲染。
- **数据绑定**：通过 `path`（JSON Pointer）实现组件属性与数据模型的双向绑定。

**协议层定位**：

```
┌─────────────────────────────────────────┐
│  A2A 协议层（Agent 协作）                  │
│  - Agent Card                            │
│  - message:send / message:stream         │
│  - Task / Artifact                       │
├─────────────────────────────────────────┤
│  A2UI 扩展层（UI 渲染）                    │
│  - surfaceUpdate（组件树）                 │
│  - dataModelUpdate（数据模型）             │
│  - beginRendering（渲染信号）             │
│  - userAction（用户交互回传）              │
└─────────────────────────────────────────┘
```

### 2.3 A2UI 消息格式示例

```jsonl
{"surfaceUpdate": {"surfaceId": "config-form", "components": [
  {"id": "root", "component": {"Column": {"children": {"explicitList": ["title", "blind_row", "chips_input", "submit"]}}}},
  {"id": "title", "component": {"Text": {"text": {"literalString": "德扑对局配置"}, "variant": "h3"}}},
  {"id": "blind_row", "component": {"Row": {"children": {"explicitList": ["sb_input", "bb_input"]}}}},
  {"id": "sb_input", "component": {"TextField": {"label": {"literalString": "小盲"}, "value": {"path": "/smallBlind", "literalNumber": 2}}}},
  {"id": "bb_input", "component": {"TextField": {"label": {"literalString": "大盲"}, "value": {"path": "/bigBlind", "literalNumber": 4}}}},
  {"id": "chips_input", "component": {"TextField": {"label": {"literalString": "初始筹码"}, "value": {"path": "/startingChips", "literalNumber": 200}}}},
  {"id": "submit", "component": {"Button": {"label": {"literalString": "开始对局"}, "action": {"name": "start_match"}}}}
]}}
{"beginRendering": {"surfaceId": "config-form", "root": "root"}}
```

**关键特性**：
- `path` 实现数据绑定：`{"path": "/smallBlind"}` 表示该输入框的值绑定到数据模型的 `/smallBlind` 路径。
- `literalNumber` + `path` 同时存在时，表示「设置默认值并绑定」。
- 用户提交时，客户端通过 A2A `userAction` 消息回传完整数据模型。

---

## 3. 项目现状分析

### 3.1 当前配置页实现（痛点）

**新项目（Next.js 重写版）**：

| 游戏 | 配置页组件 | 代码行数 | 耦合点 |
|------|-----------|---------|--------|
| 德扑 | `MatchSetupForm.tsx` | 194 行 | 硬编码 6 座位选择、盲注/筹码输入、key 检查 |
| 狼人杀 | `WerewolfMatchSetupForm.tsx` | 236 行 | 硬编码 6 玩家 + 1 Moderator 选择、无引擎参数 |
| 新增游戏 | 需新建 `XxxMatchSetupForm.tsx` | ~200 行 | 必须懂 React + Tailwind + shadcn/ui |

**旧项目（Vite 纯前端版）**：

| 页面 | 设计 | 问题 |
|------|------|------|
| `SetupPage.tsx` | 德扑专属，硬编码 | 不支持其他游戏 |
| `PluginSetupPage.tsx` | 通用平台 + 游戏特有参数 | 仍需游戏提供 `SetupComponent`（React 组件） |
| `GamePlugin.SetupComponent` | 游戏注入配置 UI | 新增游戏必须写 React 组件 |

**核心痛点**：
1. **前端耦合**：每款游戏的配置页都写死在 `frontend/components/forms/` 中，新增游戏必须修改前端代码。
2. **重复逻辑**：座位选择、API Key 检查、提交逻辑在不同游戏中重复实现。
3. **游戏不自洽**：根据项目架构「游戏自治」原则，配置页 UI 应该由游戏包自己定义，而不是前端。

### 3.2 当前 GameModule 接口（扩展点）

```typescript
// src/platform/core/registry.ts
export type GameModule = {
  gameType: GameType
  engine: GameEngine<unknown, unknown, unknown>
  memory: MemoryModule<unknown, unknown, unknown>
  playerContextBuilder: PlayerContextBuilder
  responseParser: ResponseParser
  botStrategy: BotStrategy
  moderatorContextBuilder?: ModeratorContextBuilder
  publicStateEvent?: (state: unknown) => GameEvent
  continueAfterBoundary?: (state: unknown, boundary: BoundaryKind) => ApplyActionResult<unknown> | null
  requestStopAfterHand?: (state: unknown) => unknown
}
```

**缺少的配置页相关能力**：
- 没有 `configSchema`：游戏配置的数据结构定义。
- 没有 `configSurface`：游戏配置页的 UI 描述。
- 没有 `validateConfig`：游戏特定的配置校验逻辑。

---

## 4. 方案可行性详细分析

### 4.1 用户原始方案拆解

用户提出：`data.json` + `surface.json` + `handle.sh`

| 文件 | 用户意图 | 可行性评估 |
|------|---------|-----------|
| `data.json` | 游戏配置的数据定义（字段名、类型、默认值） | ✅ 完全可行。建议用 Zod Schema（TS）替代 JSON，或提供 JSON + Zod 转换。 |
| `surface.json` | A2UI 格式的配置页 UI 描述（组件树 + 数据绑定） | ✅ 完全可行。A2UI 的设计目标就是声明式 UI。 |
| `handle.sh` | 处理 data.json 的脚本（验证、转换、提交） | ⚠️ 在 TS/Next.js 项目中用 shell 脚本不自然。建议用 TS 工具函数替代。 |

### 4.2 为什么完整 A2UI 协议对配置页过重

完整 A2UI 协议（v0.8 / v0.9 / v1.0）包含：

1. **SSE 流式传输**：`surfaceUpdate` → `dataModelUpdate` → `beginRendering` 分多条消息发送。
2. **Catalog 协商**：客户端和服务器在运行时协商可用组件目录。
3. **动态列表渲染**：`template` + `dataBinding` 支持动态生成列表项。
4. **渐进式渲染**：边接收边渲染，提升感知性能。

**配置页场景不需要这些**：
- 配置页是**静态表单**，不需要流式生成。
- 配置页的组件类型是**固定的**（输入框、选择器、按钮等），不需要 Catalog 协商。
- 配置页的数据模型是**简单的 KV 结构**，不需要复杂的模板渲染。

### 4.3 推荐方案：「A2UI 配置页子集」

**核心思想**：采用 A2UI 的「声明式组件树 + 数据绑定」核心概念，但丢弃 SSE 流式、Catalog 协商等重型机制，适配为**静态 JSON 配置**。

#### 4.3.1 文件结构（每游戏）

```
src/games/<game>/
├── agent/
├── engine/
├── memory/
├── ui/
└── config/              ← 新增
    ├── surface.json     ← A2UI 子集的 UI 描述
    ├── schema.ts        ← Zod Schema（数据校验）
    └── defaults.json    ← 默认值
```

#### 4.3.2 surface.json 示例（德扑）

```json
{
  "version": "a2ui-config-subset/v1",
  "surfaceId": "poker-match-config",
  "root": "root",
  "catalog": "colosseum-basic",
  "components": [
    {
      "id": "root",
      "component": "Column",
      "properties": { "children": ["title", "agents_section", "params_section", "key_section", "submit"] }
    },
    {
      "id": "title",
      "component": "Text",
      "properties": { "text": "德扑对局配置", "variant": "h3" }
    },
    {
      "id": "agents_section",
      "component": "Card",
      "properties": { "title": "选择 6 位选手", "children": ["agent_picker"] }
    },
    {
      "id": "agent_picker",
      "component": "AgentPicker",
      "properties": {
        "gameType": "poker",
        "maxCount": 6,
        "value": { "path": "/agentIds" }
      }
    },
    {
      "id": "params_section",
      "component": "Card",
      "properties": { "title": "对局参数", "children": ["params_grid"] }
    },
    {
      "id": "params_grid",
      "component": "Grid",
      "properties": { "columns": 3, "children": ["sb_input", "bb_input", "chips_input", "timeout_input", "interval_input"] }
    },
    {
      "id": "sb_input",
      "component": "NumberField",
      "properties": { "label": "小盲", "value": { "path": "/smallBlind", "default": 2 } }
    },
    {
      "id": "bb_input",
      "component": "NumberField",
      "properties": { "label": "大盲", "value": { "path": "/bigBlind", "default": 4 } }
    },
    {
      "id": "chips_input",
      "component": "NumberField",
      "properties": { "label": "初始筹码", "value": { "path": "/startingChips", "default": 200 } }
    },
    {
      "id": "key_section",
      "component": "KeyCheckPanel",
      "properties": { "value": { "path": "/keyring" } }
    },
    {
      "id": "submit",
      "component": "Button",
      "properties": { "label": "开始对局", "variant": "primary", "action": "submit" }
    }
  ]
}
```

#### 4.3.3 前端通用渲染器设计

```typescript
// src/frontend/components/a2ui/A2UIConfigRenderer.tsx
interface A2UIConfigRendererProps {
  surface: SurfaceDefinition          // surface.json 内容
  defaults: Record<string, unknown>   // defaults.json 内容
  onSubmit: (data: Record<string, unknown>) => void
}

// 渲染逻辑：
// 1. 读取 surface.components，构建组件树（通过 id/children 引用）。
// 2. 初始化数据模型：从 defaults 填充，path 绑定到内部 state。
// 3. 使用 Catalog 映射组件类型到 React 组件：
//    - Column → <div className="flex flex-col">
//    - Row → <div className="flex flex-row">
//    - NumberField → <Input type="number">
//    - AgentPicker → 自定义组件（从 /api/agents?gameType=xxx 加载）
//    - KeyCheckPanel → 自定义组件（检查 keyring）
//    - Button → <Button>
// 4. 用户交互时更新数据模型，提交时校验 schema 并调用 onSubmit。
```

#### 4.3.4 Catalog 定义（项目级）

```typescript
// src/frontend/components/a2ui/catalog.ts
export const colosseumCatalog = {
  catalogId: 'colosseum-basic',
  components: {
    Column: { acceptsChildren: true },
    Row: { acceptsChildren: true },
    Grid: { acceptsChildren: true },
    Card: { acceptsChildren: true },
    Text: { acceptsChildren: false },
    NumberField: { acceptsChildren: false },
    TextField: { acceptsChildren: false },
    SelectField: { acceptsChildren: false },
    AgentPicker: { acceptsChildren: false },
    KeyCheckPanel: { acceptsChildren: false },
    Button: { acceptsChildren: false },
  }
}
```

### 4.4 GameModule 接口扩展

```typescript
// src/platform/core/registry.ts
export type GameModule = {
  gameType: GameType
  engine: GameEngine<unknown, unknown, unknown>
  memory: MemoryModule<unknown, unknown, unknown>
  playerContextBuilder: PlayerContextBuilder
  responseParser: ResponseParser
  botStrategy: BotStrategy
  moderatorContextBuilder?: ModeratorContextBuilder
  publicStateEvent?: (state: unknown) => GameEvent
  continueAfterBoundary?: (state: unknown, boundary: BoundaryKind) => ApplyActionResult<unknown> | null
  requestStopAfterHand?: (state: unknown) => unknown
  
  // ── 新增配置页相关 ──
  configSurface?: SurfaceDefinition          // surface.json 内容
  configSchema?: z.ZodTypeAny                // Zod Schema 校验
  configDefaults?: Record<string, unknown>   // 默认值
}
```

### 4.5 与现有 A2A 架构的兼容性

| 现有架构 | 兼容方式 |
|---------|---------|
| `GameModule` 注册机制 | 扩展 `registry.ts`，新增 `configSurface` / `configSchema` / `configDefaults` 字段。 |
| `MatchConfig`（平台级） | 通用参数（`agentTimeoutMs`, `minActionIntervalMs`）由平台提供，不写入游戏配置。 |
| `engineConfig`（游戏级） | 游戏自定义参数（`smallBlind`, `bigBlind`, `startingChips`）通过 `surface.json` 定义。 |
| API Key 检查 | 前端通用逻辑，不通过 A2UI 描述，作为框架级组件（`KeyCheckPanel`）。 |

---

## 5. 对比分析：新旧方案

### 5.1 新增一款游戏（如「斗地主」）的工作量对比

| 步骤 | 旧方案（写 React 组件） | 新方案（A2UI 子集） |
|------|----------------------|-------------------|
| 1. 定义配置数据结构 | 在 `MatchSetupForm.tsx` 中写 `useState` | 写 `config/schema.ts`（Zod） |
| 2. 定义配置 UI | 写 JSX（`<Input>`, `<Select>`, `<Card>`） | 写 `config/surface.json`（JSON） |
| 3. 定义默认值 | 在 `useState` 中写默认值 | 写 `config/defaults.json` |
| 4. 提交逻辑 | 写 `api.post('/api/matches', {...})` | **复用通用逻辑**，无需编写 |
| 5. 校验逻辑 | 写 `if (selected.length !== 6)` 等 | **Zod Schema 自动校验** |
| 6. 新增文件数 | 1 个 `.tsx`（~200 行） | 3 个文件（`schema.ts` + `surface.json` + `defaults.json`，~50 行） |
| 7. 需要前端知识？ | ✅ 需要 React + Tailwind + shadcn/ui | ❌ 不需要，JSON 即可 |

### 5.2 方案对比矩阵

| 维度 | 当前硬编码方案 | 旧项目 PluginSetupPage | A2UI 完整协议 | A2UI 配置页子集（推荐） |
|------|-------------|---------------------|-------------|----------------------|
| 新增游戏成本 | 高（~200 行 TSX） | 中（需写 SetupComponent） | 高（需理解 SSE/JSONL） | **低**（~50 行 JSON） |
| 前端耦合度 | 高 | 中 | 低 | **低** |
| 游戏自治性 | 差 | 中 | 好 | **好** |
| 技术新颖度 | 无 | 无 | 高 | **高** |
| 学习成本 | 低 | 低 | 高 | **中**（只需理解 JSON 结构） |
| 与 A2A 兼容性 | 无 | 无 | 原生兼容 | **原生兼容**（可扩展） |
| 渐进式渲染 | 无 | 无 | 有（SSE） | **无**（配置页不需要） |
| 运行时协商 | 无 | 无 | 有（Catalog 协商） | **无**（固定 Catalog） |

---

## 6. 实施路径建议

### 6.1 阶段一：基础设施（1-2 天）

1. **定义 A2UI 配置页子集规范**（文档）。
2. **创建 Catalog**（`colosseum-basic`），注册基础组件 + 项目自定义组件（`AgentPicker`, `KeyCheckPanel`）。
3. **实现 `A2UIConfigRenderer`** 通用渲染器。

### 6.2 阶段二：迁移现有游戏（2-3 天）

1. **德扑**：将 `MatchSetupForm.tsx` 的 UI 结构提取为 `src/games/poker/config/surface.json`。
2. **狼人杀**：将 `WerewolfMatchSetupForm.tsx` 的 UI 结构提取为 `src/games/werewolf/config/surface.json`。
3. **验证**：确保功能完全一致。

### 6.3 阶段三：扩展 GameModule（1 天）

1. 在 `GameModule` 接口中新增 `configSurface` / `configSchema` / `configDefaults`。
2. 修改 `NewMatchTabs` 为动态渲染（根据 `gameType` 加载对应 `GameModule.configSurface`）。

### 6.4 阶段四：新增游戏验证（1 天）

1. 新增一个测试游戏（如简化版「斗地主」）。
2. 仅提供 `config/surface.json` + `config/schema.ts` + `config/defaults.json`。
3. 验证是否**零前端代码**即可跑通配置页。

---

## 7. 风险与考量

### 7.1 风险

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| A2UI 协议仍在演进（v0.8 → v0.9 → v1.0） | 中 | 采用「子集」策略，锁定自己的 schema，不受外部版本影响。 |
| 复杂 UI 难以用 JSON 描述 | 低 | 配置页表单属于简单 UI，JSON 足够表达。若未来有复杂需求，可扩展 Catalog。 |
| 前端团队不熟悉 A2UI 概念 | 低 | 学习成本低于 React，且只需理解 JSON 结构。 |
| 性能问题（JSON 解析） | 低 | 配置页是静态渲染，无 SSE 流，性能影响可忽略。 |

### 7.2 架构红线检查

根据项目架构铁律：

1. **游戏引擎是纯函数层** — ✅ 配置页与引擎无关，不影响。
2. **Agent Endpoint 彼此不共享进程状态** — ✅ 配置页是前端渲染，不涉及 Agent。
3. **Game Master 是唯一真相来源** — ✅ 配置页只影响 match 创建时的参数，GM 仍负责校验。
4. **持久化时机固定** — ✅ 配置页无持久化逻辑。
5. **游戏自治** — ✅ **这正是此方案的核心目标**，配置页由游戏自治。

---

## 8. 结论与建议

### 8.1 核心结论

1. **A2UI 协议非常适合解决配置页解耦问题**。其「声明式 UI + 数据绑定」的设计哲学与配置页场景高度契合。
2. **不需要引入完整的 A2UI 协议栈**（SSE 流式、Catalog 协商、JSONL）。对于静态配置页，采用「A2UI 子集」即可。
3. **data.json + surface.json 方案完全可行**，但建议用 `schema.ts`（Zod）替代 `handle.sh`，用 `defaults.json` 替代 data.json 中的默认值部分。
4. **此方案完美契合项目「游戏自治」架构原则**，新增游戏只需写 JSON，不写前端代码。

### 8.2 立即行动建议

1. ✅ **采纳「A2UI 配置页子集」方案**，作为项目配置页的标准实现方式。
2. ✅ **定义 `colosseum-basic` Catalog**，包含项目所需的组件（`Column`, `Row`, `Card`, `NumberField`, `AgentPicker`, `KeyCheckPanel`, `Button` 等）。
3. ✅ **实现 `A2UIConfigRenderer`** 通用渲染器，接收 `surface.json` + `defaults.json` 渲染配置页。
4. ✅ **扩展 `GameModule` 接口**，新增 `configSurface` / `configSchema` / `configDefaults`。
5. ✅ **迁移德扑和狼人杀** 为示范案例，验证方案可行性。

---

## 附录 A：A2UI 完整协议 vs 配置页子集对比

| 特性 | A2UI 完整协议（v0.9） | A2UI 配置页子集（建议） |
|------|----------------------|------------------------|
| 传输方式 | SSE / JSONL 流 | 静态 JSON 文件 |
| 消息类型 | `surfaceUpdate`, `dataModelUpdate`, `beginRendering`, `deleteSurface` | 单一 `surface` + `data` 对象 |
| Catalog 协商 | 运行时协商（Agent Card） | 固定 Catalog（`colosseum-basic`） |
| 数据绑定 | `path` + `literalString` / `literalNumber` | `path` + `default` |
| 动态列表 | `template` + `dataBinding` | 不支持（配置页不需要） |
| 事件回传 | A2A `userAction` | 普通 React `onSubmit` |
| 渐进渲染 | 有（边收边渲染） | 无（一次性渲染） |
| 适用场景 | 动态聊天 UI、实时仪表盘 | 静态配置表单 |

## 附录 B：参考链接

- Google A2UI 官方仓库：https://github.com/google/A2UI
- A2UI 协议规范（v0.8）：https://github.com/google/A2UI/blob/main/specification/v0_8/docs/a2ui_protocol.md
- A2UI 官方介绍：https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- CopilotKit A2UI 文档：https://docs.showcase.copilotkit.ai/langgraph-typescript/generative-ui/a2ui
- A2UI + shadcn/ui 社区实现：https://github.com/rezashahnazar/a2ui-shadcn
- A2UI + React 运行时：https://github.com/naveenraj-g/a2ui-react-runtime
- A2UI 学术论文（Macaron-A2UI）：https://arxiv.org/html/2605.24830v1
- A2UI Blazor 实现：https://github.com/23min/a2ui-blazor
- A2UI Go 实现：https://github.com/burka/a2ui-go
- A2UI Swift 实现：https://github.com/BBC6BAE9/a2ui-swift
- A2UI Jetpack Compose 实现：https://github.com/coder-brzhang/a2ui-compose
- A2UI 协议栈分析：https://www.adamsilvaconsulting.com/insights/agent-protocol-stack-from-data-to-ui
- MLOps Community A2UI 文章：https://mlops.community/blog/building-with-a2ui-extending-the-expressiveness-of-ai-agent-interfaces
- AG2 A2UIAgent 文档：https://docs.ag2.ai/latest/docs/user-guide/reference-agents/a2uiagent/
- A2UI + ADK Skill：https://github.com/coolxeo/a2ui-adk
- A2UI React 包（npm）：https://www.npmjs.com/package/@a2ui/react
- A2UI 规范站点（v1.0）：https://a2ui.org/specification/v1.0-a2ui/

---

*报告结束*
