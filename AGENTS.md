# AGENTS.md — Colosseum AI 协作入口

Colosseum 是纯 AI 博弈竞技平台：配置 LLM Profile → 创建对局 → 观看多个 Agent 通过 A2A 协议自主博弈 → 赛后排名/筹码图/思考链。

**当前阶段：R0 重建期。** 需求体系已重建于 `docs/prd/`，实现层将按 PRD 逐任务重构——现有 `src/` 不是基线，只是现存；不要把现状当作正确性的依据。

## 第一步

任何 agent 进入本仓库，先读 [docs/INDEX.md](docs/INDEX.md)：文档分区表、阅读路径、权威声明都在那里。本文件不重复维护文档清单。

## 仓库地图

```
.
├── src/
│   ├── app/         # Next.js App Router：页面 + API routes（HTTP 边界）
│   ├── frontend/    # 页面组件、store、前端工具
│   ├── backend/     # orchestrator、agent、a2a-core、auth、match
│   ├── platform/    # core、db、redis、llm、telemetry、memory、engine
│   └── games/       # 游戏自治包：poker / werewolf（各含 engine、agent、memory、ui）
├── docs/            # 唯一权威文档树（入口 docs/INDEX.md）
├── ops/             # 部署流水线 + 本地开发环境
├── scripts/         # dev-bootstrap / dev-sync / dev-doctor / a2ui 校验等脚本
└── tmp/             # 临时产物，不提交
```

- `src/app/` 是 HTTP 边界：页面在 `src/app/(page)`，A2A 与 GM 端点在 `src/app/api/`。
- `docs/rules/*.md` 仍以路由方式按任务类型选读，不默认全部加载。

## 红线

1. 依赖方向 `app → frontend/backend → platform/games` 严格向下；frontend 只 import `@/frontend/*` 和 `@/platform/*` 的纯类型/工具，禁止 import `@/backend/*` 或 `@/platform/db`。
2. `games/` 自治：每个游戏拥有自己的 engine/agent/memory/ui，禁止跨游戏 if/else 或共享游戏逻辑。
3. 需求只来自 `docs/prd/`，禁止从现有实现反推需求；实现与 PRD 冲突时以 PRD 为准并记入 `docs/repair/`。
4. `AGENTS.md` 与 `docs/INDEX.md` 是导航的唯一权威，改路径必须同步两者。
5. 生产部署走 `.kimi-code/skills/deployment/SKILL.md`（Cursor/Claude 经各自 deployment-router 路由），手册在 `ops/deploy/README.md`。

## 工作流

任务开始前读 `docs/rules/spec-plan-workflow.md`。每个任务走：

1. spec → plan：写清目标、文件列表、验证命令、Done 定义。
2. 最小实现；遇到 SDK API 漂移查官方文档或本地 `.d.ts`，不用 `as any` 硬绕。
3. 验证：`npm run check`（check:surfaces + lint + typecheck + build）。
4. 更新 `docs/session-state.md` 与相关 plan checkbox。

Cursor / Claude 内可用 `/execute-plan` 执行高频 plan 流程（读 spec/plan → 下一个任务 → 实施 → 验证 → 更新状态）。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` / `build` / `start` | 开发 / 构建 / 启动 |
| `npm run lint` / `typecheck` | ESLint / tsc |
| `npm test` / `test:watch` / `test:coverage` | Vitest 单测（`tests/unit/`，19 文件起步） |
| `npm run check:surfaces` | A2UI surfaces 校验 |
| `npm run check` | 唯一上线门禁（check:surfaces && lint && typecheck && test && build） |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle schema 迁移 |
| `npm run infra:up` / `infra:down` / `infra:logs` | 本地 docker compose（Redis） |
| `npm run bootstrap` | 新设备初始化 |
| `npm run sync` / `doctor` | 开发前安全同步与环境检查 |

## 不变约束

- 测试只放顶层 `tests/unit/`（镜像 src 结构，配置见 `vitest.config.ts`）；`src/` 内不放任何测试文件（工程与测试独立）。
- 两个游戏的新引擎/前端工作以 `docs/prd/games/` 四份 PRD 为需求权威，不从现有 src/games/ 反推。
- `tmp/` 不提交。
- 不要伪造验证结果；命令跑不了就记录原因。
