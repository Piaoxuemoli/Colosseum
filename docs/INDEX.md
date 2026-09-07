# Colosseum 文档总索引

本仓库是一个纯 AI 博弈竞技平台：用户配置 LLM Profile → 创建对局 → 观看多个 Agent 通过 A2A 协议自主博弈 → 赛后查看排名、筹码图与思考链日志。本文件是所有文档的统一入口，任何 agent 读完根目录 `AGENTS.md` 后应从这里继续。

## 文档分区表

| 分区 | 路径 | 内容 | 何时读 |
|---|---|---|---|
| 需求体系 | `docs/prd/` | PRD、路线图、设计体系——产品真相的唯一来源，与实现严格隔离 | 任何"产品应该是什么"的判断，先来这里 |
| 大修 | `docs/repair/` | 当前大修的问题清单与状态 | 接手大修任务、查已知问题 |
| 规则 | `docs/rules/` | 协作规则 8 篇：架构红线、前后端边界、lint、UI、git、spec/plan 工作流等 | 写代码前按任务类型选读 |
| 活跃规格 | `docs/specs/` | 仍在生效的子系统设计（如 A2UI 配置页） | 实现对应子系统前 |
| 模板 | `docs/templates/` | 游戏接入 A2UI 的模板说明 | 新游戏接入时 |
| 调研 | `docs/research/` | 技术调研报告（A2UI 可行性、CI/测试重建调研等） | 立新任务、做技术选型前 |
| 部署 | `docs/deploy/` 与 `ops/` | Vercel fallback、部署流水线、本地开发环境 | 部署、运维、配本地环境 |
| 开发 | `docs/dev/` | 开发环境辅助说明（如 LLM API 配置示例） | 本地接 LLM、环境变量配置 |
| 状态 | `docs/session-state.md` | 长任务状态记录 | 上下文压缩、换 agent、恢复任务时 |
| 历史 | `docs/legacy/` | 2026-05~06 重写期的 spec 与 plan 归档，只读 | 仅追溯历史决策时 |

## 新 agent 进入仓库的阅读路径

1. `AGENTS.md`（仓库根）——项目定位、红线、命令入口。
2. 本文件 `docs/INDEX.md`——文档地图与阅读顺序。
3. `docs/prd/PRD.md`——产品是什么、要做什么。
4. `docs/rules/project-context.md`——架构与红线细节。
5. 按任务类型在上方分区表中选择对应文档读：改代码读 `docs/rules/` 相关篇目，接大修读 `docs/repair/`，做子系统实现读 `docs/specs/`，部署读 `ops/deploy/`。

## 权威声明

- `docs/prd/` 是唯一需求权威：**禁止从现有实现反推需求**。实现与 PRD 冲突时，以 PRD 为准并按 `docs/repair/` 流程修正实现。
- `docs/legacy/` 仅作历史参考，其中内容对当前工作没有任何约束力。
- 路径变更必须同步更新 `AGENTS.md` 与本文件，二者是导航的唯一权威。
