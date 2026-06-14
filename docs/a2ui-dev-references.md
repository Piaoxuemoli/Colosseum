# A2UI 开发参考资料与来源总览

> **文档用途**：Colosseum 项目引入 A2UI 协议时的开发参考手册。包含官方规范、社区实现、学术论文、协议栈关系图及项目内相关文件索引。  
> **维护日期**：2026-06-15  
> **版本**：v1.0

---

## 目录

1. [A2A 协议（Agent-to-Agent）](#1-a2a-协议agent-to-agent)
2. [A2UI 协议（Agent-to-User-Interface）](#2-a2ui-协议agent-to-user-interface)
3. [A2UI 社区实现（按语言/框架）](#3-a2ui-社区实现按语言框架)
4. [学术文章与深度分析](#4-学术文章与深度分析)
5. [协议栈关系图谱](#5-协议栈关系图谱)
6. [项目内参考文件](#6-项目内参考文件)
7. [快速检索表](#7-快速检索表)

---

## 1. A2A 协议（Agent-to-Agent）

### 1.1 官方资源

| 资源 | 链接 | 说明 |
|------|------|------|
| **Google A2A 官方公告** | https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/ | 2025 年 4 月发布，A2A 协议诞生公告 |
| **A2A 规范站点** | https://google.github.io/A2A/ | 官方文档站点，包含协议规范、Agent Card、Message 格式 |
| **A2A GitHub 仓库** | https://github.com/google/A2A | 官方开源仓库，包含协议规范、示例、JSON Schema |
| **A2A 协议规范（JSON Schema）** | https://github.com/google/A2A/tree/main/specification | 核心协议 JSON Schema，包括 Agent Card、Task、Artifact 等定义 |
| **A2A 官方 SDK（Python）** | https://github.com/google/A2A/tree/main/samples/python | Python 示例 Agent 和客户端 |
| **A2A 官方 SDK（JS/TS）** | `@a2a-js/sdk` | npm 包，项目当前使用版本 |

### 1.2 项目内 A2A 实现

| 文件 | 路径 | 说明 |
|------|------|------|
| A2A 类型定义 | `src/backend/a2a-core/types.ts` | 从 `@a2a-js/sdk` 导出的类型 + 项目自定义类型（`TaskState`, `A2AStreamEvent` 等） |
| A2A 客户端 | `src/backend/a2a-core/client.ts` | `requestAgentDecisionRpc` / `requestAgentDecisionToy`，封装 JSON-RPC + SSE 流式解析 |
| Agent Card 构建 | `src/backend/a2a-core/agent-card.ts` | `buildAgentCard` 函数，生成符合 v0.3 规范的 Agent Card |
| SSE 流式写入 | `src/backend/a2a-core/sse-writer.ts` | SSE 响应流构建工具 |
| Agent 端点（流式） | `src/app/api/agents/[agentId]/message/stream/route.ts` | A2A `message:stream` 端点实现 |
| Agent 端点（非流式） | `src/app/api/agents/[agentId]/message/send/route.ts` | A2A `message:send` 端点实现 |
| Agent Card 端点 | `src/app/api/agents/[agentId]/.well-known/agent-card.json/route.ts` | A2A Agent Card 资源端点 |

### 1.3 A2A 核心概念速查

```
Agent Card  →  元数据（能力、端点、技能）
Message     →  JSON-RPC 2.0 信封
Task        →  任务状态机（submitted → working → completed/failed）
Artifact    →  输出载体（text / data / file）
Part        →  Artifact 的组成单元（textPart / dataPart）
```

---

## 2. A2UI 协议（Agent-to-User-Interface）

### 2.1 官方资源

| 资源 | 链接 | 说明 | 优先级 |
|------|------|------|--------|
| **A2UI 官方公告** | https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/ | 2025 年 12 月 15 日 Google 官方发布 | ⭐⭐⭐⭐⭐ |
| **A2UI GitHub 仓库** | https://github.com/google/A2UI | 官方开源仓库，包含协议规范、渲染器、Catalog 定义 | ⭐⭐⭐⭐⭐ |
| **A2UI 协议规范 v0.8** | https://github.com/google/A2UI/blob/main/specification/v0_8/docs/a2ui_protocol.md | 核心协议文档（JSONL 流式、消息类型、数据绑定） | ⭐⭐⭐⭐⭐ |
| **A2UI 规范站点 v1.0** | https://a2ui.org/specification/v1.0-a2ui/ | 最新官方规范站点，含 Catalog Schema、组件定义 | ⭐⭐⭐⭐⭐ |
| **A2UI 介绍（what-is-a2ui）** | https://github.com/google/A2UI/blob/main/docs/introduction/what-is-a2ui.md | 核心概念解释：Surface、Component、Catalog、Data Model | ⭐⭐⭐⭐ |
| **A2UI 标准 Catalog Schema** | https://a2ui.org/specification/v1.0-a2ui/catalogs/basic/catalog.json | 标准组件目录（Text, Button, Row, Column, Card 等） | ⭐⭐⭐⭐⭐ |
| **A2UI Server-to-Client JSON Schema** | https://github.com/google/A2UI/tree/main/specification/v0_8/json | 服务器到客户端的消息 JSON Schema | ⭐⭐⭐⭐ |
| **A2UI React 渲染器** | https://github.com/google/A2UI/tree/main/renderers/react | 官方 React 渲染器实现参考 | ⭐⭐⭐⭐ |
| **A2UI 协议栈位置** | https://github.com/google/A2UI/blob/main/docs/ecosystem/agent_protocol_stack.md | A2UI 在六层协议栈中的位置说明 | ⭐⭐⭐ |

### 2.2 A2UI 核心概念速查

```
Surface          →  UI 渲染区域（Canvas），通过 surfaceId 唯一标识
Component        →  UI 元素（Button, Text, Card 等），由 Catalog 定义
Component Tree   →  通过 ID 引用的扁平组件列表（Adjacency List 模型）
Data Model       →  应用状态，通过 JSON Pointer 路径绑定到组件
Catalog          →  可用组件类型目录（客户端定义，Agent 只能使用目录内组件）
Message Types    →  surfaceUpdate / dataModelUpdate / beginRendering / deleteSurface
BoundValue       →  {"literalString": "..."} 或 {"path": "/..."} 或两者同时
User Action      →  通过 A2A 消息回传的用户交互事件
```

### 2.3 A2UI 消息格式示例（关键模板）

```json
// 1. surfaceUpdate — 定义组件树
{
  "surfaceUpdate": {
    "surfaceId": "main",
    "components": [
      {
        "id": "root",
        "component": {
          "Column": {
            "children": {"explicitList": ["title", "form"]}
          }
        }
      },
      {
        "id": "title",
        "component": {
          "Text": {"text": {"literalString": "配置页"}, "variant": "h3"}
        }
      }
    ]
  }
}

// 2. dataModelUpdate — 更新数据模型
{
  "dataModelUpdate": {
    "surfaceId": "main",
    "path": "user",
    "contents": [
      {"key": "name", "valueString": "Alice"},
      {"key": "age", "valueNumber": 25}
    ]
  }
}

// 3. beginRendering — 渲染信号
{
  "beginRendering": {
    "surfaceId": "main",
    "root": "root"
  }
}

// 4. userAction — 客户端回传（A2A 消息）
{
  "userAction": {
    "name": "submit",
    "surfaceId": "main",
    "sourceComponentId": "btn_submit",
    "timestamp": "2026-01-01T00:00:00Z",
    "context": {"formData": {"name": "Alice", "age": 25}}
  }
}
```

### 2.4 A2UI 标准 Catalog 组件清单

**Layout 组件**（8 个）

| 组件 | 功能 | 子元素支持 |
|------|------|-----------|
| `Row` | 水平布局容器 | ✅ `children` |
| `Column` | 垂直布局容器 | ✅ `children` |
| `List` | 滚动列表 | ✅ `template` / `explicitList` |
| `Card` | 卡片容器 | ✅ `child` |
| `Tabs` | 标签页 | ✅ `tabs` |
| `Modal` | 模态对话框 | ✅ `child` |
| `Divider` | 分隔线 | ❌ |
| `Container` | 通用容器 | ✅ `child` |

**Content 组件**（5 个）

| 组件 | 功能 | 关键属性 |
|------|------|---------|
| `Text` | 文本显示 | `text`, `variant` (h1/h2/h3/body/caption) |
| `Image` | 图片 | `url`, `alt` |
| `Icon` | 图标 | `name`, `size` |
| `Video` | 视频 | `url`, `autoplay` |
| `AudioPlayer` | 音频 | `url` |

**Input 组件**（6 个）

| 组件 | 功能 | 关键属性 |
|------|------|---------|
| `Button` | 按钮 | `label`, `action`, `variant` |
| `TextField` | 文本输入 | `label`, `value`, `placeholder` |
| `CheckBox` | 复选框 | `label`, `value` |
| `ChoicePicker` | 选择器（单/多选） | `label`, `options`, `value` |
| `Slider` | 滑块 | `label`, `value`, `min`, `max` |
| `DateTimeInput` | 日期时间输入 | `label`, `value` |

---

## 3. A2UI 社区实现（按语言/框架）

### 3.1 React / Next.js 生态

| 项目 | 链接 | 特点 | 参考价值 |
|------|------|------|---------|
| **a2ui-shadcn** | https://github.com/rezashahnazar/a2ui-shadcn | A2UI v0.9 + shadcn/ui + Tailwind CSS + Framer Motion，30+ 组件适配器 | ⭐⭐⭐⭐⭐ 与项目技术栈完全一致 |
| **a2ui-react-runtime** | https://github.com/naveenraj-g/a2ui-react-runtime | Next.js + ShadCN UI 渲染器，含基础 Catalog 实现 | ⭐⭐⭐⭐ |
| **a2ui-builder** | https://github.com/josephsenior/a2ui-builder | AI 驱动 UI 构建器，Gemini 生成 A2UI JSON，Next.js 16 + ShadCN | ⭐⭐⭐ 了解动态生成模式 |
| **@a2ui/react (npm)** | https://www.npmjs.com/package/@a2ui/react | 官方 npm 包，含 `basicCatalog`（Layout/Content/Input 组件） | ⭐⭐⭐⭐⭐ |
| **CopilotKit A2UI** | https://docs.showcase.copilotkit.ai/langgraph-typescript/generative-ui/a2ui | CopilotKit 作为 A2UI 设计和发布合作伙伴，支持 Dynamic Schema / Fixed Schema 两种模式 | ⭐⭐⭐⭐⭐ |
| **CopilotKit Generative UI** | https://github.com/CopilotKit/generative-ui | 包含 A2UI + Open-JSON-UI 的 Declarative Generative UI 实现 | ⭐⭐⭐⭐ |

### 3.2 其他语言/框架

| 语言/框架 | 项目 | 链接 | 说明 |
|-----------|------|------|------|
| **Android / Compose** | a2ui-compose | https://github.com/coder-brzhang/a2ui-compose | Kotlin + Jetpack Compose，A2UI v0.10 完整实现 |
| **Swift / SwiftUI** | a2ui-swift | https://github.com/BBC6BAE9/a2ui-swift | SwiftUI 渲染器，A2UI v0.9，含 A2UISwiftCore / A2UISwiftUI / A2UIUIKit / A2UIAppKit |
| **.NET / Blazor** | a2ui-blazor | https://github.com/23min/a2ui-blazor | Blazor WASM + Server 渲染器，含服务端 Fluent Builder |
| **Go** | a2ui-go | https://github.com/burka/a2ui-go | 纯 stdlib 实现，零依赖，适合后端 JSONL 生成 |
| **Python / ADK** | a2ui-adk | https://github.com/coolxeo/a2ui-adk | Claude Code Skill，ADK Agent + A2UI，Tailwind + shadcn 设计系统 |
| **Python / LangChain** | langchain-ucp | https://github.com/muzaffersenkal/langchain-ucp | 含 A2UI 模板（ProductCard, Checkout, OrderConfirmation） |
| **AG2 (AutoGen)** | A2UIAgent | https://docs.ag2.ai/latest/docs/user-guide/reference-agents/a2uiagent/ | AG2 框架的 A2UIAgent，支持 A2UI v0.9，含 basicCatalog |

---

## 4. 学术文章与深度分析

### 4.1 协议栈全景分析

| 文章 | 链接 | 核心观点 | 参考价值 |
|------|------|---------|---------|
| **Six Agent Protocols Every AI Builder Needs to Know** | https://www.mindstudio.ai/blog/six-agent-protocols-ai-builders-2026 | MCP → A2A → AG-UI → A2UI → AP2 → X42 六层协议栈完整地图 | ⭐⭐⭐⭐⭐ 理解 A2UI 在协议栈中的位置 |
| **The Agent Protocol Stack: From Data to UI** | https://www.adamsilvaconsulting.com/insights/agent-protocol-stack-from-data-to-ui | 将六协议映射为 OSI 模型，A2UI 是第 5 层（静态 UI 合成），AG-UI 是第 6 层（实时流式） | ⭐⭐⭐⭐⭐ 理解 A2UI vs AG-UI 的区别 |
| **The Agentic Protocol Ecosystem** | https://www.solenya.ai/blog/20-agent-protocols | 2024-2026 协议时间线，MCP → A2A → AG-UI/A2UI/MCP-UI → ACP/UCP → AP2 | ⭐⭐⭐⭐ |

### 4.2 A2UI 专项分析

| 文章 | 链接 | 核心观点 | 参考价值 |
|------|------|---------|---------|
| **A2UI Protocol: Google's New Agent-Driven Interface Standard** | https://getdiffer.com/blog/a2ui-protocol-googles-new-agent-driven-interface-standard | A2UI 是声明式协议（非可执行代码），安全性高，支持流式 JSON 生成，可跨平台渲染 | ⭐⭐⭐⭐⭐ |
| **Building with A2UI: Extending the Expressiveness** | https://mlops.community/blog/building-with-a2ui-extending-the-expressiveness-of-ai-agent-interfaces | 提出 AVC（Agent-View-Controller）模式，分离 Controller Agent（业务逻辑）和 View Agent（UI 渲染） | ⭐⭐⭐⭐⭐ 架构设计参考 |
| **用 A2UI 构建智能体用户界面（中文）** | https://www.hubwiz.com/blog/build-agent-ui-with-a2ui/ | 完整架构：Lit 客户端 → A2A 传输 → 后端 Agent → A2UI 流式渲染 | ⭐⭐⭐⭐ 中文资料 |
| **Macaron-A2UI: A Model for Generative UI** | https://arxiv.org/html/2605.24830v1 | 学术论文，含 A2UI 渲染实现、Catalog 系统、23 个组件类型、系统 Prompt 模板 | ⭐⭐⭐⭐⭐ 学术参考 |
| **LLM Applications: Current Paradigms and Next Frontier** | https://arxiv.org/html/2503.04596v2 | 协议层在 LLM 应用中的角色，MCP/A2A/ACP/ANP 对比 | ⭐⭐⭐⭐ |
| **A Unified Review of Memory, Skills, Protocols and Harness** | https://arxiv.org/html/2604.08224v1 | 引用 A2UI 和 A2A，作为 Agent 协议栈的组成部分 | ⭐⭐⭐ |

### 4.3 关键概念辨析

**A2UI vs AG-UI**

| 维度 | A2UI | AG-UI |
|------|------|-------|
| 定位 | 静态 UI 合成（持久状态同步） | 实时流式 UI（事件驱动） |
| 传输 | JSONL / SSE（可静态也可流式） | WebSocket / SSE（双向事件流） |
| 适用场景 | 配置页、表单、结果卡片 | 聊天界面、实时仪表盘、交互式会话 |
| 标准制定 | Google（2025.12） | CopilotKit（2025.01） |
| 关系 | 互补，可叠加使用 | 互补，CopilotKit 已兼容 A2UI |

---

## 5. 协议栈关系图谱

```
┌─────────────────────────────────────────────────────────────────┐
│ L6  用户交互层                                                     │
│     AG-UI (CopilotKit) — 实时流式、双向事件、Human-in-the-loop    │
│     A2UI (Google) — 声明式 UI、数据绑定、渐进式渲染               │
├─────────────────────────────────────────────────────────────────┤
│ L5  Agent 协作层                                                   │
│     A2A (Google) — Agent Card、Task 委托、Artifact 交换            │
│     ACP (OpenAI/Stripe) — 异步 MIME-typed 消息                    │
│     ANP (Agent Network) — 去中心化 DID + JSON-LD                │
├─────────────────────────────────────────────────────────────────┤
│ L4  工具访问层                                                     │
│     MCP (Anthropic/Linux Foundation) — 工具、资源、Prompt 服务    │
├─────────────────────────────────────────────────────────────────┤
│ L3  支付/商业层                                                    │
│     AP2 (Google) — Agent 支付协议                                │
│     UCP (Google/Shopify) — 通用商业协议                           │
├─────────────────────────────────────────────────────────────────┤
│ L2  治理/信任层                                                    │
│     X42 — 跨边界 Agent 权限与治理                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Colosseum 项目当前协议使用**：

```
┌─────────────────────────────────┐
│ 用户界面（Spectator）             │
│  ← 未来可引入 A2UI 配置页渲染     │
├─────────────────────────────────┤
│ A2A 协议（已实现）                 │
│  - Agent Card（Agent 元数据）     │
│  - message:stream（SSE 决策流）   │
│  - Task / Artifact（状态+输出）   │
├─────────────────────────────────┤
│ 游戏引擎（纯函数）                 │
│  - 无需 A2A/A2UI（状态机）        │
└─────────────────────────────────┘
```

---

## 6. 项目内参考文件

### 6.1 A2A 相关实现

| 文件 | 路径 | 说明 |
|------|------|------|
| A2A 类型 | `src/backend/a2a-core/types.ts` | `TaskState`, `A2AStreamEvent`, `A2AEmitter` |
| A2A 客户端 | `src/backend/a2a-core/client.ts` | `requestAgentDecisionRpc`, `requestAgentDecisionToy` |
| Agent Card | `src/backend/a2a-core/agent-card.ts` | `buildAgentCard` |
| SSE 写入 | `src/backend/a2a-core/sse-writer.ts` | SSE 响应流构建 |
| 服务端辅助 | `src/backend/a2a-core/server-helpers.ts` | A2A 服务端工具函数 |
| 流式端点 | `src/app/api/agents/[agentId]/message/stream/route.ts` | POST 流式决策端点 |
| 非流式端点 | `src/app/api/agents/[agentId]/message/send/route.ts` | POST 非流式决策端点 |
| Agent Card 端点 | `src/app/api/agents/[agentId]/.well-known/agent-card.json/route.ts` | GET Agent Card |
| Orchestrator | `src/backend/orchestrator/game-master.ts` | GM 使用 A2A Client 调用 Agent |

### 6.2 游戏模块（当前注册方式）

| 文件 | 路径 | 说明 |
|------|------|------|
| 游戏注册表 | `src/platform/core/registry.ts` | `GameModule` 接口，`registerGame` / `getGame` |
| 德扑插件 | `src/games/poker/poker-plugin.ts` | `pokerPlugin` 注册对象 |
| 狼人杀插件 | `src/games/werewolf/werewolf-plugin.ts` | `werewolfPlugin` 注册对象 |
| 引擎契约 | `src/platform/engine/contracts.ts` | `GameEngine` 接口定义 |
| 记忆契约 | `src/platform/memory/contracts.ts` | `MemoryModule` 接口定义 |

### 6.3 配置页（当前实现，需迁移）

| 文件 | 路径 | 说明 | 游戏 |
|------|------|------|------|
| 德扑配置页 | `src/frontend/components/forms/MatchSetupForm.tsx` | 硬编码 6 座位 + 盲注/筹码参数 | 德扑 |
| 狼人杀配置页 | `src/frontend/components/forms/WerewolfMatchSetupForm.tsx` | 硬编码 6 玩家 + Moderator | 狼人杀 |
| 配置页标签 | `src/frontend/components/forms/NewMatchTabs.tsx` | 游戏切换 Tab | 通用 |
| Agent 表单 | `src/frontend/components/forms/AgentForm.tsx` | 硬编码 Agent 创建表单 | 通用 |

### 6.4 旧项目参考（GamePlugin 架构）

| 文件 | 路径 | 说明 |
|------|------|------|
| 游戏插件协议 | `archive/old/src/core/protocols/plugin.protocol.ts` | 旧版 `GamePlugin` 接口（含 `SetupComponent`） |
| 引擎协议 | `archive/old/src/core/protocols/engine.protocol.ts` | 旧版 `EngineProtocol` 接口 |
| 上下文协议 | `archive/old/src/core/protocols/context.protocol.ts` | `ContextBuilder`, `ResponseParser`, `BotStrategy` |
| 德扑插件 | `archive/old/src/games/poker/poker-plugin.ts` | 旧版德扑注册对象 |
| 斗地主插件 | `archive/old/src/games/doudizhu/doudizhu-plugin.ts` | 旧版斗地主注册对象（含 `SetupComponent`） |
| 通用配置页 | `archive/old/src/pages/PluginSetupPage.tsx` | 旧版通用配置页（`SetupComponent` 注入） |
| 德扑配置页 | `archive/old/src/pages/SetupPage.tsx` | 旧版德扑专属配置页 |
| 游戏参数 | `archive/old/src/components/setup/GameParams.tsx` | 旧版德扑参数组件 |
| 座位配置 | `archive/old/src/components/setup/SeatConfig.tsx` | 旧版座位选择组件 |
| 时序参数 | `archive/old/src/components/setup/TimingParams.tsx` | 旧版平台参数组件 |

### 6.5 项目设计文档

| 文件 | 路径 | 说明 |
|------|------|------|
| 重写设计文档 | `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md` | 完整技术 Spec，含 A2A 层设计、引擎契约、数据流 |
| 重写简要 | `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md` | 快速全局图景 |
| 实施计划 | `docs/superpowers/plans/` | 按 Phase 拆分的实施计划 |
| 会话状态 | `docs/ai/session-state.md` | 长任务状态记录 |
| 架构规则 | `docs/ai/rules/project-context.md` | 项目架构红线 |
| 前后端边界 | `docs/ai/rules/frontend-backend.md` | 前后端 import 约束 |
| UI 风格 | `docs/ai/rules/ui-style.md` | Tailwind + shadcn/ui 设计规范 |

---

## 7. 快速检索表

### 7.1 按开发任务检索

| 开发任务 | 首选参考 | 辅助参考 |
|---------|---------|---------|
| 理解 A2UI 协议核心 | [A2UI 规范 v0.8](https://github.com/google/A2UI/blob/main/specification/v0_8/docs/a2ui_protocol.md) | [A2UI 介绍](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) |
| 查看标准组件清单 | [A2UI v1.0 Catalog](https://a2ui.org/specification/v1.0-a2ui/catalogs/basic/catalog.json) | [@a2ui/react npm](https://www.npmjs.com/package/@a2ui/react) |
| 实现 React 渲染器 | [a2ui-shadcn](https://github.com/rezashahnazar/a2ui-shadcn) | [a2ui-react-runtime](https://github.com/naveenraj-g/a2ui-react-runtime) |
| 理解协议栈关系 | [Agent Protocol Stack](https://www.adamsilvaconsulting.com/insights/agent-protocol-stack-from-data-to-ui) | [Six Protocols](https://www.mindstudio.ai/blog/six-agent-protocols-ai-builders-2026) |
| 设计架构模式 | [Building with A2UI](https://mlops.community/blog/building-with-a2ui-extending-the-expressiveness-of-ai-agent-interfaces) | [Macaron-A2UI 论文](https://arxiv.org/html/2605.24830v1) |
| 实现后端 JSON 生成 | [a2ui-go](https://github.com/burka/a2ui-go) | [CopilotKit Python SDK](https://docs.showcase.copilotkit.ai/langgraph-typescript/generative-ui/a2ui) |
| 了解 CopilotKit 集成 | [CopilotKit A2UI](https://docs.showcase.copilotkit.ai/langgraph-typescript/generative-ui/a2ui) | [CopilotKit Generative UI](https://github.com/CopilotKit/generative-ui) |
| 中文资料 | [用 A2UI 构建 UI](https://www.hubwiz.com/blog/build-agent-ui-with-a2ui/) | - |

### 7.2 按协议版本检索

| 版本 | 官方文档 | 状态 |
|------|---------|------|
| v0.8 | [GitHub 协议文档](https://github.com/google/A2UI/blob/main/specification/v0_8/docs/a2ui_protocol.md) | 稳定，社区广泛实现 |
| v0.9 | [React 渲染器](https://github.com/google/A2UI/tree/main/renderers/react) | 官方 React 包基于此版本 |
| v0.10 | [a2ui-compose](https://github.com/coder-brzhang/a2ui-compose) | 社区跟进版本 |
| v1.0 | [a2ui.org](https://a2ui.org/specification/v1.0-a2ui/) | 最新官方版本 |

---

*文档结束。维护时请更新链接有效性，协议仍在快速迭代中。*
