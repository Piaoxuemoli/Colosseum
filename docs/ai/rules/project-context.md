# 项目上下文与架构红线

## 项目定位

Colosseum 是一个纯 AI 博弈竞技平台。用户配置 LLM Profile，创建比赛，观看多个 Agent 通过 A2A 协议自主博弈，赛后查看排名、筹码图和思考链日志。

当前仓库是重写版。`old/` 是旧项目归档，只能作为游戏规则、交互和视觉参考；除非用户明确要求，不在 `old/` 内继续开发。

## 必读材料

- 简要设计：`docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`
- 完整 spec：`docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`
- 实施 plan：`docs/superpowers/plans/`
- 长任务状态：`docs/ai/session-state.md`

## 架构红线

- 游戏引擎是纯函数层：输入 `(state, action)`，输出 `newState`。不碰 React、DB、HTTP、Redis、LLM。
- Game Master 是唯一真相来源。Agent 决策必须经 GM 校验后才能改变状态。
- 游戏自治：每个游戏拥有自己的 `engine`、`memory module`、`context builder`、`response parser`、`bot strategy`、`plugin`、`UI` 子目录。
- 不在共享模块中新增 `if (gameType === ...)` 处理游戏规则、prompt、记忆、解析器、bot 或 UI 差异。
- Agent Route Handler 必须位置透明：输入来自 HTTP body、DB、Redis，不 import 进程内 GM 状态。
- 环境变量统一通过 `lib/env.ts` 读取。
- 用户 LLM API key 不做服务端持久化。浏览器保存配置，开局时只进入内存 keyring。
- 禁止提交 `.env*`、token、cookie、私钥、生产密钥、`old/ops/private/*`。

## 实施原则

- 优先按当前 plan 的 checkbox 顺序执行。
- 一次推进一个可验证任务。
- 先测试或确认失败，再做最小实现。
- 遇到 SDK API 漂移时查官方文档或本地 `.d.ts`，不要用 `as any` 逃避。
