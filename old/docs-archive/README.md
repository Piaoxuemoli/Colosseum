# 过时文档归档区

本目录存放重写版 Colosseum 项目中**已完成、过时或仅具历史价值**的文档。

> 注意：`old/docs/` 目录下是旧前端项目（原 poker-arena）的归档文档；本目录 `old/docs-archive/` 专门存放当前重写版项目中不再维护的历史文档，两者不要混淆。

## 归档规则

- 已完结的 Phase plan / checklist / complete report 在闭环后移入此处。
- 与实际代码路径严重不符的设计文档（如从 Postgres 改为 SQLite 后的旧部署 plan）及时移入此处，避免误导新人和 AI。
- 此处文件**不再维护**，仅作历史参考。

## 当前归档内容

| 原路径 | 归档路径 | 说明 |
|---|---|---|
| `docs/superpowers/plans/2026-05-06-phase-4-deployment.md` | `superpowers/plans/2026-05-06-phase-4-deployment.md` | 旧 Phase 4 部署计划，基于 Postgres，与实际 SQLite 生产路径不符 |
| `docs/ai/phase-6-server-verify-plan.md` | `ai/phase-6-server-verify-plan.md` | 临时服务器验证与真实 key 清理计划，已完结 |
| `docs/superpowers/notes/phase-0-complete.md` | `superpowers/notes/phase-0-complete.md` | Phase 0 完成报告，后续 Phase 已合并 |
| `docs/demo/phase-1-m4-checklist.md` | `demo/phase-1-m4-checklist.md` | M4 demo checklist，已完成 |
| `docs/demo/phase-2-m5-checklist.md` | `demo/phase-2-m5-checklist.md` | M5 demo checklist，已完成 |
| `docs/demo/phase-3-m6-checklist.md` | `demo/phase-3-m6-checklist.md` | M6 demo checklist，已完成 |
| `docs/demo/a2a-compliance-check.md` | `demo/a2a-compliance-check.md` | A2A 合规检查清单，已完成 |

## 当前权威入口

- **部署 Skill**：`.kimi-code/skills/deployment/SKILL.md`
- **生产部署手册**：`ops/deploy/README.md`
- **Vercel fallback**：`docs/deploy/vercel.md`
- **开发环境**：`ops/dev/README.md`
