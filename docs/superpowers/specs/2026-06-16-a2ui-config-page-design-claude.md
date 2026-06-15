# A2UI 游戏配置页接入 — 设计 Spec（Claude 独立版）

> - **日期**：2026-06-16
> - **作者**：Claude（基于 web-search 独立调研 + brainstorming 三节确认）
> - **状态**：待用户审阅 → 通过后进入 `writing-plans`
> - **范围**：仅 Match 配置页（闭环验证），架构按可扩展设计
> - **并行说明**：仓库内另有 kimi-code 产出的同名设计（`2026-06-16-a2ui-config-page-design.md`）与 plan/spike；本文件为 Claude 独立完成的并行版本，互不覆盖，最终以用户裁定为准。
> - **关联**：`docs/A2A-A2UI-游戏配置页可行性调研报告.md`、`docs/a2ui-dev-references.md`、`docs/a2ui-enhancement-scenarios.md`、`docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`

---

## 1. 结论（先给结论）

采用 **官方 A2UI 渲染器 + 自定义 Catalog + 非流式静态 surface** 方案，把每款游戏的 Match 配置页从硬编码 React 组件下沉为**游戏包内的声明式 `.a2ui/` 配置**，实现「新增游戏 = 零前端代码」。本轮只做配置页闭环（**德扑先行、狼人杀第二**），目录/catalog/GameModule 架构按可扩展到后续所有 A2UI 增强场景设计。

理由：web-search 核实官方 `@a2ui/react` 已发布**稳定版 0.10.0**（Apache-2.0，React 18/19 兼容），自定义 Catalog 是官方推荐用法，非流式是默认模式——「自建渲染器」属重复造轮子。详见 §3、§4。

---

## 2. 背景与动机

当前配置页痛点：

- `MatchSetupForm.tsx`（德扑，~194 行）、`WerewolfMatchSetupForm.tsx`（狼人杀，~236 行）均为**硬编码** React 组件。
- 新增一款游戏需新写 ~200 行 TSX，必须懂 React + Tailwind + shadcn/ui。
- 座位选择、API Key 检查、提交逻辑在不同游戏中重复。
- 违反项目「游戏自治」红线：配置页 UI 应由游戏包自己定义，而非前端。

A2UI（Google，2025-12 开源）的「声明式组件树 + JSON Pointer 数据绑定」天然契合静态配置表单，且与项目已实现的 A2A 协议（`src/backend/a2a-core/`）同层。

---

## 3. 调研结论（web-search 独立核实）

### 3.1 已验证属实

| 项 | 结论 | 来源 |
|---|---|---|
| A2UI 真实性 | Google 2025-12 开源的声明式 Agent-UI 协议 | [a2ui.org](https://a2ui.org/)、[Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) |
| 消息类型 | `createSurface`/`beginRendering`、`surfaceUpdate`/`updateComponents`、`dataModelUpdate`、`deleteSurface`（v0.9 起 `createSurface` 并入 `beginRendering` 流） | [Client Setup](https://a2ui.org/guides/client-setup/)、[Catalogs](https://a2ui.org/concepts/catalogs/) |
| 数据绑定 | JSON Pointer (RFC 6901)，如 `/user/name` | [Data Binding](https://a2ui.org/concepts/data-binding/) |
| Catalog 模型 | 官方原话「Your design system is what matters. The catalog is just the contract between your agent and your renderer.」——**强烈推荐自定义 Catalog** | [Catalogs](https://a2ui.org/concepts/catalogs/) |
| 非流式 | 非流式是**默认模式**（Angular 客户端官方原话「By default uses the non-streaming API」） | [Client Setup](https://a2ui.org/guides/client-setup/) |
| A2UI vs AG-UI | A2UI = 表示层声明式 UI 规范；AG-UI（CopilotKit）= 传输/交互层；互补 | [CopilotKit 对比](https://www.copilotkit.ai/ag-ui-and-a2ui) |

### 3.2 官方 SDK 接入可行性（npm registry 核实）

| 维度 | 结果 |
|---|---|
| `@a2ui/react` | ✅ **latest 0.10.0（稳定，非 alpha）**，2026-05 发布，Apache-2.0 |
| React 兼容 | ✅ peer `react ^18‖^19`；项目 React **19.2.5** 满足 |
| A2A 复用 | ✅ 项目已有 `@a2a-js/sdk@0.3.13`；A2UI 官方传输层支持 A2A |
| 自定义 Catalog | ✅ 官方推荐成熟前端「定义镜像自身设计系统的 Catalog」 |
| **Zod 兼容** | ⚠️ `@a2ui/react@0.10.0` 在 `dependencies` 与 `peerDependencies` 均列 `zod ^3.23.8`；项目用 **Zod 4.4.3**（Zod 3→4 breaking） |

**Zod 冲突的解决（采用 npm alias）**：实施时在 `package.json` 加 `"zod3": "npm:zod@^3.25.76"` 显式别名——让 `@a2ui/react` 用 `zod3`（3.x），项目游戏 schema 继续用顶层 `zod`（4.x）。两者**各自命名、不跨边界共享 schema 对象**，install 时不再 ERESOLVE。这比 `--legacy-peer-deps` 更干净（依赖关系显式、可审计）。本 spec 将此列为锁定决策 **D12**（Task 0 落地）。

### 3.3 需修正项目内文档之处（实施期一并更新）

| 文档 | 问题 | 修正 |
|---|---|---|
| 三份文档 | 仓库地址写 `github.com/google/A2UI` | 搜索指向 `github.com/a2ui-project/a2ui`（**克隆前需最终核实真实路径**） |
| 调研报告 | 「完整 A2UI 协议过重，需自建子集」 | 低估官方渲染器对自定义 Catalog + 非流式的原生支持；自建渲染器属重复造轮子 |
| `a2ui-dev-references.md` | `@a2ui/react` 标 alpha（0.9.0-alpha.x） | 实际 latest = **0.10.0 稳定** |
| `a2ui-dev-references.md` | arxiv ID `2605.24830`、`2604.08224` 格式可疑 | 引用前需核验 |

---

## 4. 锁定决策（可引用）

- **D1 渲染器**：采用官方 `@a2ui/react@^0.10.0` + `@a2ui/web_core@^0.10.0`，**不自建渲染器**。
- **D2 A2UI 用法**：用作「设计期手写声明式 UI schema」，非运行时 agent 生成；`surface.json` 构建期静态 import 打包进 GameModule。
- **D3 跳过运行时协商**：Catalog 退化为**编译期契约**（构建期校验 surface↔catalog）；运行时协商握手留给未来动态场景（如 Moderator SSE 旁白）。
- **D4 `.a2ui/` 目录模板**：每游戏建立 `.a2ui/`，五分类 `surface`/`data`/`handle`/`runtime`/`script`；poker + werewolf 补齐；模板放 `docs/ai/templates/game-a2ui/`。
- **D5 handle 替代**：`.a2ui/handle/submit.ts` 作为原 `handle.sh` 的 **TS 替代**（Zod 结构校验 + 跨字段规则 + payload 转换）。
- **D6 GameModule 扩展**：新增可选字段 `configSurface` / `configSchema` / `configDefaults` / `configHandle` / `configManifest`；共享类型放 `src/platform/core/a2ui-types.ts`。
- **D7 提交闭环**：`configHandle.submit` → `POST /api/matches`（**现有端点不动**）。
- **D8 迁移 kill-switch**：`A2UI_CONFIG`（经 `lib/env.ts`，默认 `off`）；两款验证后删旧表单 + 移除开关。
- **D9 实施首任务 = 接入 spike**：5 项验证；**任一失败回退方案 A**（薄自建渲染器 + 真 A2UI surface.json，保可移植性）。
- **D10 禁游戏分支**：共享前端代码**禁止 `if (gameType === ...)`**（架构红线）；游戏差异只在 `.a2ui/` 内。
- **D11 点目录回退**：`.a2ui/` 若 spike 不通过 bundler 解析 → 回退无点 `a2ui/`（结构不变）。
- **D12 Zod 共存**：用 `zod3` npm alias 让 a2ui 内部 zod 3 与项目 zod 4 显式并存，不跨边界。

---

## 5. 架构

### 5.1 渲染管线（静态、设计期声明）

```
┌─ 游戏包（设计期手写，零运行时 LLM）──────────────────────┐
│ src/games/<game>/.a2ui/                                  │
│   surface/match-config.json  ← A2UI v0.9 组件树（静态）  │
│   data/schema.ts             ← Zod 4 配置数据校验        │
│   data/defaults.json         ← 默认值                    │
│   handle/submit.ts           ← 校验/转换/提交            │
│   runtime/manifest.ts        ← surface 清单 + catalog 绑定│
│        │ 挂到 GameModule.config{...}                     │
└────────┼─────────────────────────────────────────────────┘
         ▼
┌─ 平台层（共享类型）─────────────────────────────────────┐
│ src/platform/core/registry.ts                           │
│   GameModule += configSurface? configSchema?             │
│                 configDefaults? configHandle? configManifest? │
│ src/platform/core/a2ui-types.ts                         │
│   SurfaceDefinition / A2UIManifest / ConfigHandle       │
└────────┬────────────────────────────────────────────────┘
         ▼
┌─ 前端（官方渲染器 + 项目 Catalog）───────────────────────┐
│ NewMatchTabs → 取活跃游戏 GameModule.config*             │
│   └─ <A2UIConfigSurface>  (client component)            │
│        ├─ MessageProcessor(@a2ui/web_core) + colosseumCatalog │
│        ├─ 静态喂: createSurface + updateComponents +     │
│        │          dataModelUpdate(defaults)             │
│        ├─ <A2UISurface surfaceId="match-config"/>        │
│        │    (@a2ui/react)                               │
│        └─ onUserAction → 读 dataModel →                 │
│           configHandle.submit → onSubmit(payload)        │
└────────┬────────────────────────────────────────────────┘
         ▼  onSubmit（已校验配置）
   POST /api/matches（现有端点）→ 比赛创建 → 跳转观赛页 = ✅闭环
```

### 5.2 分层与 import 边界（遵守架构红线）

| 层 | 路径 | 可 import |
|---|---|---|
| 游戏包 | `src/games/<game>/.a2ui/*` | `@/platform`（类型）、`zod`（4.x） |
| 前端渲染 | `src/frontend/components/a2ui/*` | `@a2ui/react`、`@a2ui/web_core`、`@/platform`（**仅类型**）、项目 UI 原语；**禁止** `@/backend`、`@/platform/db` |
| 平台共享类型 | `src/platform/core/a2ui-types.ts` | 仅类型定义，无运行时依赖 |

### 5.3 与架构红线对齐

- **游戏自治** ✅：`.a2ui/` 在 `src/games/<game>/` 内，配置页由游戏自治定义。
- **禁共享模块游戏分支** ✅（D10）：`<A2UIConfigSurface>` 是通用渲染器，游戏差异只在 `.a2ui/`。
- **env 统一经 `lib/env.ts`** ✅（D8）：`A2UI_CONFIG` 经 `lib/env.ts` 读取。
- **GM 仍是唯一真相源** ✅：配置页只影响 match 创建参数；GM 开局仍负责校验。
- **keyring 仅内存** ✅：`KeyCheckPanel` 在浏览器处理 keyring，不服务端持久化。
- **游戏引擎纯函数层** ✅：配置页与引擎无关。

---

## 6. `.a2ui/` 目录模板

### 6.1 结构

```
src/games/<game>/.a2ui/
├── README.md                 # 模板说明：每类放什么、如何新增 surface
├── surface/
│   └── match-config.json     # 【本轮】配置页 A2UI v0.9 组件树
├── data/
│   ├── schema.ts             # 【本轮】Zod 4 配置数据 schema
│   └── defaults.json         # 【本轮】默认值
├── handle/
│   └── submit.ts             # 【本轮】提交处理（= handle.sh 的 TS 版）
├── runtime/
│   └── manifest.ts           # 【本轮】登记本游戏可用 surface + catalogId 绑定
└── script/
    └── README.md             # 游戏专属构建脚本位；共享校验在项目级 scripts/a2ui/
```

### 6.2 分类语义

| 分类 | 职责 | 配置页闭环 |
|---|---|---|
| `surface/` | A2UI 组件树（声明式 UI） | ✅ `match-config.json` |
| `data/` | 数据模型：schema + defaults | ✅ `schema.ts` + `defaults.json` |
| `handle/` | 用户动作处理：校验/转换/提交（取代 `handle.sh`） | ✅ `submit.ts` |
| `runtime/` | 运行期配置：surface 清单 + catalog 绑定 | ✅ `manifest.ts`（最小） |
| `script/` | 构建期/开发期脚本 | 📄 README（共享校验在项目级） |

### 6.3 模板来源与补齐

- 模板：`docs/ai/templates/game-a2ui/.a2ui/`（**不**放 `src/games/`，避免被当真实游戏注册）。
- 补齐：现有 **poker、werewolf** 都建 `.a2ui/`——poker 本轮全量实现（闭环），werewolf 第二迁移。
- 新游戏：复制模板填三件套即可（零前端代码）。可选后续加 `npm run new-game:a2ui <name>` 脚手架（本轮**不做**，YAGNI）。

---

## 7. Catalog 组件清单（`src/frontend/components/a2ui/catalog/`）

### 7.1 标准组件（取自 Basic Catalog，映射到现有 shadcn/Radix）

| A2UI 组件 | 适配到 | 子元素 |
|---|---|---|
| `Column` / `Row` / `Grid` | `div` flex/grid | ✅ |
| `Card` | shadcn `Card` | ✅ |
| `Text` (h1–h3/body/caption) | 排版组件 | ❌ |
| `Button` | shadcn `Button` | ❌ |
| `TextField` / `NumberField` | shadcn `Input` | ❌ |
| `SelectField` | shadcn `Select` (Radix) | ❌ |
| `CheckBox` | shadcn `Checkbox` | ❌ |

### 7.2 项目自定义组件（从现有表单抽离）

- `AgentPicker` — 按 gameType 选 N 个 agent（拉 `/api/agents?gameType=`），复用现 `MatchSetupForm` 选人逻辑。
- `KeyCheckPanel` — API key 状态检查，复用现 key-check UI。

两者在 `colosseum-catalog.json`（JSON Schema）定义、在 `adapters.tsx` 实现 React 适配器。

---

## 8. GameModule 扩展

```typescript
// src/platform/core/registry.ts
export type GameModule<...> = {
  // ...现有字段...
  // ── A2UI 配置页（可选；未提供则该游戏无声明式配置页）──
  configSurface?: SurfaceDefinition        // ← .a2ui/surface/match-config.json
  configSchema?: z.ZodTypeAny              // ← .a2ui/data/schema.ts (Zod 4)
  configDefaults?: Record<string, unknown> // ← .a2ui/data/defaults.json
  configHandle?: ConfigHandle              // ← .a2ui/handle/submit.ts
  configManifest?: A2UIManifest            // ← .a2ui/runtime/manifest.ts
}
```

共享类型 `SurfaceDefinition` / `A2UIManifest` / `ConfigHandle` 放 `src/platform/core/a2ui-types.ts`。

---

## 9. 数据流与提交闭环

```
NewMatchTabs(gameType)
  → getGame(gameType).config{Surface,Defaults,Schema,Handle,Manifest}
  → <A2UIConfigSurface>（A2UI_CONFIG=on 时；off 走旧表单）
       ├─ MessageProcessor + colosseumCatalog
       ├─ 静态喂: createSurface + updateComponents(surface) + dataModelUpdate(defaults)
       └─ <A2UISurface surfaceId="match-config"/>
            └─ 用户填写 → JSON Pointer 双向绑定更新 dataModel
            └─ 点「开始对局」Button → userAction
       → 读 dataModel → configHandle.submit(dataModel)
            ├─ Zod 4 结构校验（configSchema）
            ├─ 跨字段规则（如 bigBlind≥smallBlind、恰好 6 名 agent）
            └─ 转换为 POST payload → {ok, payload} | {ok:false, errors}
       → onSubmit(payload) → POST /api/matches（现有端点）→ 比赛创建 → 跳转观赛页 ✅
```

---

## 10. 错误处理

| 场景 | 处理 |
|---|---|
| Zod 结构校验失败 | 字段级 inline 错误（Zod path → JSON Pointer → 组件 id）+ 表单级摘要 |
| 跨字段校验失败（`handle/submit.ts`） | 同上错误展示 |
| 未知组件 / surface↔catalog 不符 | 官方渲染器 graceful degradation（占位/降级，不崩）+ **构建期校验器**提前拦截 |
| 渲染器运行时异常 | `<A2UISurface>` 外包 ErrorBoundary → 降级提示；kill-switch 可切回旧表单 |
| `POST /api/matches` 失败 | 复用 NewMatchTabs 现有 toast 错误处理 |

---

## 11. 迁移策略（kill-switch）

- 新增 `A2UI_CONFIG`（经 `lib/env.ts`，`on`/`off`，**默认 `off`**）。
- `off` → 走旧 `MatchSetupForm`（现状不变，零风险）。
- `on` → 走新 `<A2UIConfigSurface>`。
- 流程：spike 通过 → 德扑 `on` 对照测试 → 狼人杀 `on` → 两款验证 OK 后**删除旧表单 + 移除开关**。

---

## 12. 测试与质量门禁

> 项目 `npm test` 当前「intentionally cleared while being rebuilt」。本特性最小测试集须与 `docs/ai/rules/linting-and-quality.md` 对齐（实施期再读）。

| 门禁 | 内容 |
|---|---|
| `npm run typecheck` | SurfaceDefinition / GameModule 扩展 / Zod schema 类型通过 |
| `npm run lint` | 新增文件通过 eslint |
| `npm run build` | Next 构建（含 `.a2ui/` import、JSON import 解析） |
| **surface 校验器**（新 `scripts/a2ui/validate-surfaces.mjs`） | 每游戏 `.a2ui/surface/*.json` 对照 `colosseum-catalog.json` 校验，挂进 `npm run check` / 预构建 |
| 单测 | 各游戏 `handle/submit.ts`（Zod + 跨字段）、catalog 校验逻辑（随测试套件重建补上） |

---

## 13. 风险与回退

| 风险 | 等级 | 缓解/回退 |
|---|---|---|
| `.a2ui/` 点目录不被 bundler 解析 | 中 | spike 验证（D11）→ 回退 `a2ui/` |
| 官方静态喂 API 不符预期 | 中 | spike 确认（D9）→ 回退方案 A |
| zod 3/4 ERESOLVE | 低 | `zod3` npm alias（D12）；不跨边界 |
| 自定义组件适配成本 | 中 | 标准件复用 shadcn；自定义仅 2 个，从现有表单搬 |
| 新旧表单功能不一致 | 中 | kill-switch 双路对照后再删旧 |
| A2UI 0.10 后续 breaking | 低 | 锁 `^0.10.0`；渲染器层隔离 |
| kimi-code 并行产物冲突 | 低 | 独立文件名（`*-claude.md`）；最终用户裁定合并 |

---

## 14. 范围与非目标（YAGNI）

本轮**不做**（留给后续扩大方案；架构已预留扩展点）：
- 观赛面板 A2UI 化（status / replay / impressions / tabs / agent 表单等，见 `a2ui-enhancement-scenarios.md`）。
- 流式 SSE 与运行时 Catalog 协商。
- 新游戏脚手架脚本 `npm run new-game:a2ui`。
- 直接渲染之外的 Agent 运行时生成 UI。

---

## 15. 参考与文档修正

### 15.1 验证过的官方源

- 官方站：[a2ui.org](https://a2ui.org/)
- Client Setup：[a2ui.org/guides/client-setup/](https://a2ui.org/guides/client-setup/)
- Catalogs：[a2ui.org/concepts/catalogs/](https://a2ui.org/concepts/catalogs/)
- Data Binding：[a2ui.org/concepts/data-binding/](https://a2ui.org/concepts/data-binding/)
- npm：`@a2ui/react@0.10.0`、`@a2ui/web_core@0.10.0`（Apache-2.0）
- A2UI vs AG-UI：[copilotkit.ai/ag-ui-and-a2ui](https://www.copilotkit.ai/ag-ui-and-a2ui)

### 15.2 随附小任务（plan 中纳入）

更新 `docs/a2ui-dev-references.md`：修正仓库地址（核实 `a2ui-project/a2ui`）、`@a2ui/react` 版本（稳定 0.10.0）、核验可疑 arxiv ID。

---

## 附录：术语

- **Surface**：A2UI 渲染区域，由 `surfaceId` 标识；本轮只有一个 `match-config`。
- **Catalog**：组件/函数/主题的 JSON Schema 目录；本项目自定义 `colosseum-catalog.json`。
- **BoundValue**：`{"literalString/Number": ...}` 或 `{"path": "/..."}`，组件属性与数据模型的绑定。
- **userAction**：用户交互（如点提交）回传的事件，客户端据其取 dataModel。
- **kill-switch**：`A2UI_CONFIG` env，迁移期在新旧表单间切换。
- **zod3 alias**：`"zod3": "npm:zod@^3.25.76"`，让 a2ui 的 zod 3 与项目 zod 4 显式并存。
