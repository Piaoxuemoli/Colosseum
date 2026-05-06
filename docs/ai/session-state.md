# AI Session State

> 给长任务恢复用。每次完成一个 plan task、遇到阻塞、或发现 SDK/API 漂移后更新。不要记录密钥、cookie、token 或个人隐私。

## Active Context

- Active spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`
- Brief spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`
- Active plan: `docs/superpowers/plans/2026-05-06-phase-0-skeleton.md`
- Current phase: Phase 0 — skeleton
- Current task: not started

## Last Known Status

- 新仓库当前主要产物是 spec/plan/AI 基建。
- `old/` 是旧项目归档，只作参考。
- 已建立路由式 AI 基建入口：`AGENTS.md`、`docs/ai/rules/`、Cursor/Claude rules、`/execute-plan` 命令和本状态文件。
- `.cursor/rules` 与 `.claude/rules` 只放路由，详细规则集中在 `docs/ai/rules/`。
- 已补充 Git 工作流规范：分支类别、命名、提交、合入和 AI Git 安全边界。

## Validation Log

| Date | Command | Result | Notes |
|---|---|---|---|
| 2026-05-06 | ReadLints on AI docs | Passed | Markdown diagnostics clean in edited files |
| 2026-05-06 | ReadLints on routed AI infra | Passed | Added docs/ai/rules plus .cursor/.claude routers |
| 2026-05-06 | ReadLints on Git workflow rules | Passed | Added `docs/ai/rules/git-workflow.md` and Git routers |

## Open Questions / Blockers

- None.

## SDK / Plan Drift Notes

- None yet.

## Resume Checklist

1. Read `AGENTS.md`.
2. Read this file.
3. Read the active plan and find the first unchecked checkbox.
4. Read the spec sections referenced by that task.
5. Implement one task, run validation, then update this file.
