# AGENTS.md — Colosseum AI 协作入口

> 给 Cursor / Claude / 其他 AI 代码助手的稳定上下文。进入本仓库后先读本文件，再读当前任务涉及的 spec 和 plan。

## 项目定位

Colosseum 是一个纯 AI 博弈竞技平台：用户在浏览器里配置多个 LLM Profile，创建比赛，观看多个 Agent 通过 A2A 协议自主博弈，并在赛后查看排名、筹码图和思考链日志。

当前仓库是重写版。`old/` 是旧前端项目归档，只作为游戏规则、交互和视觉参考，不在 `old/` 内继续开发。

## 必读文档

1. `docs/ai/rules/README.md`：规则路由索引，按任务类型选择要读的详细规则。
2. `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`：简要设计，适合快速建立全局图景。
3. `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`：完整技术 spec，是架构与边界的主来源。
4. `docs/superpowers/plans/`：按 Phase 拆分的实施计划。执行代码任务时以当前 plan 的 checkbox 为进度来源。
5. `docs/ai/session-state.md`：长任务状态记录。上下文压缩或换 Agent 后先读这里。

## 规则加载策略

`.cursor/rules` 和 `.claude/rules` 只做路由，不承载完整规范。详细规则放在 `docs/ai/rules/`：

- 项目上下文与架构红线：`docs/ai/rules/project-context.md`
- lint / typecheck / test / build：`docs/ai/rules/linting-and-quality.md`
- UI 风格：`docs/ai/rules/ui-style.md`
- 前后端边界：`docs/ai/rules/frontend-backend.md`
- spec / plan 工作流：`docs/ai/rules/spec-plan-workflow.md`
- Git 分支、提交、合入：`docs/ai/rules/git-workflow.md`

按任务类型读取相关文档，不要默认把所有规则都加载进上下文。

## 实施方式

优先按 `docs/superpowers/plans/*.md` 的任务顺序执行。每次只推进一个可验证小任务：

1. 读当前 plan 的目标、文件列表、当前未完成 checkbox。
2. 对该任务先写/确认失败测试，再做最小实现。
3. 跑该任务指定验证命令；能全量验证时再跑 `npm test`、`npm run lint`、`npm run build`。
4. 更新 plan checkbox 和 `docs/ai/session-state.md`。
5. 遇到 SDK API 漂移时查官方文档或本地 `.d.ts`，不要用 `as any` 硬绕。

## 常用命令入口

Cursor 内执行高频 plan 流程时，使用自定义命令：

```text
/execute-plan
```

该命令会要求 AI 读取当前 spec / plan，找下一个未完成任务，实施、验证并更新状态。

项目脚本以后以 `package.json` 为准。最小质量门禁是：

```bash
npm test
npm run lint
npm run build
```

如果某个命令因依赖尚未安装或 Phase 尚未完成而不能运行，记录原因，不要伪造通过结果。
