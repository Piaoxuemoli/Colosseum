# AI Session State

> 给长任务恢复用。每次完成一个 plan task、遇到阻塞、或发现 SDK/API 漂移后更新。不要记录密钥、cookie、token 或个人隐私。

## Active Context

- Active spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`
- Brief spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`
- Active plan: `docs/superpowers/plans/2026-05-06-phase-0-skeleton.md`
- Current phase: Phase 0 — skeleton
- Current task: Task 10 complete; proceeding to Task 11

## Last Known Status

- 新仓库当前主要产物是 spec/plan/AI 基建。
- `old/` 是旧项目归档，只作参考。
- 已建立路由式 AI 基建入口：`AGENTS.md`、`docs/ai/rules/`、Cursor/Claude rules、`/execute-plan` 命令和本状态文件。
- `.cursor/rules` 与 `.claude/rules` 只放路由，详细规则集中在 `docs/ai/rules/`。
- 已补充 Git 工作流规范：分支类别、命名、提交、合入和 AI Git 安全边界。
- Phase 0 Task 0 已创建 `package.json`、`tsconfig.json`、`.nvmrc`、`.env.example`。按安全规则，plan 中 commit step 暂未执行。
- Phase 0 Task 1 已安装核心依赖并生成 `package-lock.json`；npm audit 当前报告 6 个 moderate vulnerabilities，未自动执行 `npm audit fix --force`。
- 已新增可复用开发环境脚本：`npm run bootstrap`、`npm run sync`、`npm run doctor`，用于多设备初始化、日常安全拉取和环境检查。
- 已新增 task 边界分步提交脚本：`npm run commit:step -- "<message>"`，用于执行态下自动创建小粒度提交。
- Phase 0 Task 2 已创建 Next App Router 占位页、Tailwind/PostCSS 配置和 ESLint flat config。`next lint` 与当前 ESLint 10 不兼容，已改用 `eslint .`。
- Phase 0 Task 3 已创建 Vitest 配置、测试 setup 和 smoke test。
- Phase 0 Task 4 已创建 `lib/env.ts` 和环境变量测试；`loadEnv()` 支持读取本地 `.env` 后再做 Zod 校验。
- Phase 0 Task 5 已创建 `docker-compose.yml` 和 `ops/dev/README.md`；当前设备未安装 Docker，infra 运行验证暂未完成。
- Phase 0 Task 6 已创建 Drizzle SQLite schema/client/config、首个 migration 和 DB 集成测试。
- 独立开发模式：默认不创建或提示 PR / MR；任务分支只用于本地隔离、备份和跨设备同步，合入在本地处理。
- Phase 0 Task 7-10 已创建 Redis client、结构化 logger、LLM provider catalog 和 provider factory。

## Validation Log

| Date | Command | Result | Notes |
|---|---|---|---|
| 2026-05-06 | ReadLints on AI docs | Passed | Markdown diagnostics clean in edited files |
| 2026-05-06 | ReadLints on routed AI infra | Passed | Added docs/ai/rules plus .cursor/.claude routers |
| 2026-05-06 | ReadLints on Git workflow rules | Passed | Added `docs/ai/rules/git-workflow.md` and Git routers |
| 2026-05-06 | `npx --yes tsc --version` | Expected fail | TypeScript not installed yet; Task 1 installs it |
| 2026-05-06 | `npx tsc --version` | Passed | TypeScript 5.9.3 installed |
| 2026-05-06 | `npm run sync` | Passed | Skipped pull because working tree is dirty, as designed |
| 2026-05-06 | `npm run doctor` | Failed | Node is v20.19.5 but project expects >=22; Docker/Compose warn only |
| 2026-05-06 | Node script syntax checks | Passed | `dev-sync`, `dev-doctor`, `dev-bootstrap`, `git-step-commit` |
| 2026-05-06 | `npm run dev` + HTTP check | Passed | Homepage served on `localhost:3000` and contained `Colosseum` |
| 2026-05-06 | `npm run lint` | Passed | Migrated from deprecated `next lint` to ESLint CLI |
| 2026-05-06 | `npm run typecheck` | Passed | `tsc --noEmit` passed |
| 2026-05-06 | `npm test` | Passed | Smoke test: 1 file, 2 tests passed |
| 2026-05-06 | `npm test tests/lib/env.test.ts` | Expected fail then passed | Failed before `lib/env.ts`, then 2 tests passed |
| 2026-05-06 | `npm run infra:up` | Blocked | Docker command not found on current machine |
| 2026-05-06 | `npm run db:generate` + `npm run db:migrate` | Passed | Generated and applied initial SQLite migration |
| 2026-05-06 | `npm test tests/lib/db/client.test.ts` | Expected fail then passed | Failed before schema/client; then 3 tests passed |
| 2026-05-06 | `npm run lint` | Passed | ESLint CLI passed after DB task |
| 2026-05-06 | `npm run typecheck` | Passed | Fixed readonly `NODE_ENV` test assignments via `vi.stubEnv` |
| 2026-05-06 | `npm test` | Passed | 3 files, 7 tests passed |
| 2026-05-06 | `npm test tests/lib/redis/client.test.ts tests/lib/telemetry/logger.test.ts tests/lib/llm/catalog.test.ts tests/lib/llm/provider-factory.test.ts` | Passed | 4 files, 10 tests passed; Redis test uses lazy client because Docker/Redis is unavailable on this machine |
| 2026-05-06 | `npm run typecheck` | Passed | Provider factory compiles with SDK type bridge |

## Open Questions / Blockers

- None.
- Docker is not installed on this machine, so Docker Compose runtime checks and real Redis connectivity must be completed on a Docker-capable device.

## SDK / Plan Drift Notes

- `next lint` is deprecated and failed with ESLint 10 option errors. Project now uses `eslint .` with `eslint.config.mjs`.
- Test code should use `vi.stubEnv('NODE_ENV', 'test')`; assigning `process.env.NODE_ENV` directly fails typecheck because it is readonly.
- `@ai-sdk/openai-compatible` / `@ai-sdk/anthropic` currently return provider v3 model types while `ai@5` exposes a v2 `LanguageModel` type. `lib/llm/provider-factory.ts` centralizes the temporary `unknown` bridge until dependencies are aligned.

## Resume Checklist

1. Read `AGENTS.md`.
2. Read this file.
3. Read the active plan and find the first unchecked checkbox.
4. Read the spec sections referenced by that task.
5. Implement one task, run validation, then update this file.
