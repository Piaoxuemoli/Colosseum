# Plan: A2UI 游戏配置页接入（Claude 独立版）

> **关联 Spec**：`docs/superpowers/specs/2026-06-16-a2ui-config-page-design-claude.md`
> **分支**：`feature/a2ui-config-page`
> **目标**：用官方 `@a2ui/react` 渲染器替换硬编码配置页；新增游戏零前端代码；并交付一个「组件测试工具」（左粘 surface / 右渲染）。

---

## Goal

落地 spec 的方案 B：官方渲染器 + 自定义 `colosseumCatalog` + 非流式静态 surface + 每游戏 `.a2ui/` 模板。德扑配置页闭环 + 一个 surface playground 工具。**不做视觉/浏览器人工测试**，靠 `npm run check`（lint/typecheck/build）作为门禁。

## Architecture summary

游戏包 `.a2ui/`（surface/data/handle/runtime）→ GameModule.config* → 前端 `<A2UIConfigSurface>` 用 `@a2ui/react` 静态喂消息渲染 → `configHandle.submit` 校验 → `POST /api/matches`。Playground 复用同一渲染核心，左粘 JSON / 右实时渲染。

## Tech stack / dependencies

- 新增：`@a2ui/react@^0.10.0`、`@a2ui/web_core@^0.10.0`、`react-is`（peer）、`zod3`（npm alias = `npm:zod@^3.25.76`，解决 zod 3/4 共存）。
- 既有：React 19、Next 15、Tailwind 4、shadcn/Radix、zod 4、`@a2a-js/sdk`。

## Files

- `src/platform/core/a2ui-types.ts`（新）— SurfaceDefinition / A2UIManifest / ConfigHandle。
- `src/platform/core/registry.ts`（改）— GameModule += config* 字段。
- `src/platform/env.ts`（改）— `A2UI_CONFIG` 读取（默认 off）。
- `src/frontend/components/a2ui/catalog/colosseum-catalog.json`（新）— Catalog JSON Schema 契约。
- `src/frontend/components/a2ui/catalog/adapters.tsx`（新）— 组件名 → shadcn/Radix + AgentPicker/KeyCheckPanel。
- `src/frontend/components/a2ui/a2ui-renderer.ts`（新）— 渲染核心：surface + catalog → React 节点（config 与 playground 共用）。
- `src/frontend/components/a2ui/A2UIConfigSurface.tsx`（新）— 配置页封装 + 提交闭环。
- `src/frontend/components/a2ui/SurfacePlayground.tsx`（新）— 左粘 surface / 右渲染（组件测试工具）。
- `src/app/a2ui-playground/page.tsx`（新）— playground 路由（「游戏壳子」）。
- `src/games/poker/.a2ui/{surface,data,handle,runtime}/*`（新）— 德扑三件套 + manifest。
- `src/games/poker/poker-plugin.ts`（改）— 注册 config*。
- `src/frontend/components/forms/NewMatchTabs.tsx`（改）— kill-switch 切换。
- `docs/ai/templates/game-a2ui/.a2ui/*`（新）— 模板骨架。
- `scripts/a2ui/validate-surfaces.mjs`（新）— 构建期 surface↔catalog 校验。

## Task steps

- [ ] **Task 0 — 依赖安装 + 渲染器 API spike**
  - `npm i @a2ui/react@^0.10.0 @a2ui/web_core@^0.10.0 react-is`；`package.json` 加 `"zod3": "npm:zod@^3.25.76"`。
  - 读取已装 `@a2ui/react` 的 exports/`.d.ts`，确认 `MessageProcessor`/`<A2UISurface>`/静态喂 API。
  - 若静态喂 API 不可用 → 回退薄自建渲染器（spec D9/A）。
  - 验证：`npm run typecheck` 通过。

- [ ] **Task 1 — 共享类型 + GameModule 扩展**
  - 新增 `a2ui-types.ts`。
  - 扩展 `registry.ts`（config* 可选字段）。
  - 验证：`npm run typecheck`。

- [ ] **Task 2 — colosseumCatalog + 适配器**
  - `colosseum-catalog.json`（Column/Row/Grid/Card/Text/Button/TextField/NumberField/SelectField/CheckBox + AgentPicker/KeyCheckPanel）。
  - `adapters.tsx`：标准件映射 shadcn；AgentPicker/KeyCheckPanel 从现表单抽离 stub。
  - 验证：`npm run typecheck && npm run lint`。

- [ ] **Task 3 — 渲染核心 a2ui-renderer.ts**
  - `renderSurface({surface, dataModel, catalog, onDataChange, onAction})` → ReactNode。
  - 按 Task 0 确定的 API 走官方渲染器或自建薄渲染器。
  - 验证：`npm run typecheck`。

- [ ] **Task 4 — A2UIConfigSurface（配置页封装 + 提交闭环）**
  - 读 GameModule.config*，静态喂，onAction → configHandle.submit → onSubmit。
  - 错误处理（Zod/跨字段 → 字段级 + 摘要）。
  - 验证：`npm run typecheck && npm run lint`。

- [ ] **Task 5 — 游戏壳子 + 组件测试工具（Playground）**
  - `SurfacePlayground.tsx`：左侧 textarea 粘贴/编辑 surface JSON（带默认示例 + 校验提示），右侧用 Task 3 渲染核心实时渲染。
  - `src/app/a2ui-playground/page.tsx` 路由承载。
  - 验证：`npm run build`（页面可构建；**不做浏览器视觉测试**）。

- [ ] **Task 6 — .a2ui/ 模板 + 德扑 backfill**
  - `docs/ai/templates/game-a2ui/.a2ui/` 骨架 + README。
  - `src/games/poker/.a2ui/`：surface/match-config.json、data/schema.ts、data/defaults.json、handle/submit.ts、runtime/manifest.ts。
  - `poker-plugin.ts` 注册 config*。
  - 验证：`npm run typecheck`。

- [ ] **Task 7 — Kill-switch + NewMatchTabs 接线**
  - `src/platform/env.ts` 加 `A2UI_CONFIG`（默认 off）。
  - `NewMatchTabs` 按 kill-switch 切旧表单 / `<A2UIConfigSurface>`。
  - 验证：`npm run typecheck && npm run lint`。

- [ ] **Task 8 — surface 构建期校验器**
  - `scripts/a2ui/validate-surfaces.mjs`：遍历 `src/games/*/.a2ui/surface/*.json`，校验只用 catalog 已注册组件。
  - 加 `npm run check:surfaces`（或并入 `check`）。
  - 验证：`node scripts/a2ui/validate-surfaces.mjs` 通过。

- [ ] **Task 9 — 全量质量门禁 + 清理**
  - `npm run lint && npm run typecheck && npm run build`。
  - 修复所有报错；记录任何无法运行项的原因。
  - 更新 `docs/ai/session-state.md`（A2UI 进展）。

## Validation commands

- 每 Task：相关 `npm run typecheck` / `npm run lint`。
- 里程碑：`npm run check`（= lint + typecheck + build）。
- surface 校验：`node scripts/a2ui/validate-surfaces.mjs`。
- **不**做浏览器/视觉测试（per goal）。

## Done definition

1. `npm run check` 全通过（lint + typecheck + build）。
2. 德扑 `.a2ui/` 三件套就位，`poker-plugin` 注册 config*。
3. `<A2UIConfigSurface>` 经 kill-switch 可在 NewMatchTabs 切换（默认 off）。
4. `/a2ui-playground` 路由可构建：左粘 surface JSON、右实时渲染（组件测试工具）。
5. `colosseum-catalog.json` + 适配器齐全；surface 校验器通过。
6. 无 `as any`、无空 catch、无 prod `console.log`（per linting-and-quality）。

## SDK drift notes

- `@a2ui/react@0.10.0` 的静态喂 API（`MessageProcessor` 如何吃完整消息数组）需在 Task 0 对着已装包的 `.d.ts` 确认；若与文档示例不符，以包内类型为准，必要时回退自建薄渲染器（仍消费真 A2UI surface.json 形状）。
- zod 3/4 经 `zod3` alias 共存；不跨边界传 schema 对象。
- `.a2ui/` 点目录若 Next 构建不解析 → 回退 `a2ui/`（无点）。
