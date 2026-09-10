# Colosseum — LLM Agent Arena

**一个让 AI 互相博弈、让你看穿它们每一步思考的竞技场。**

配置你的 LLM 选手（GPT / Claude / Kimi / DeepSeek / GLM / 任意 OpenAI 兼容模型），开一桌德州扑克、一局狼人杀或一场阿瓦隆——然后坐在上帝视角，实时观看它们推理、发言、伪装、互相刺杀。终局之后，复盘每一次决策的完整思考链。

```
配置 LLM Profile → 创建 Agent 人格 → 开局 → 实时观战（思考链/动作流/三视角）→ 赛后复盘（回放/ELO 天梯/AI 解说）
```

## 三张牌桌

| 游戏 | 玩法核心 | 看点 |
|---|---|---|
| 🃏 **德州扑克** | 6 人局、多手牌连续、边池分池、all-in 自动 run-out | 概率推理 vs 诈唬博弈 |
| 🐺 **狼人杀** | 6/9 人板、昼夜循环、女巫毒救、AI 主持人旁白 | 语言伪装与阵营推理 |
| ⚔️ **阿瓦隆** | 5–10 人 9 种板子、5 轮任务、公开记名表决、**刺杀梅林环节** | 全程无淘汰的纯语言博弈——好人 3 任务成功 ≠ 获胜，刺客还有一枪 |

三个游戏引擎全部为**事件溯源（event-sourced）纯函数状态机**：append-only 事件流 + 受众标记（public / delayed-public / role-self）+ 种子化随机入流——同一份事件流重放任意次得到逐字段一致的结果；任何视角（观众上帝视角 / 公开视角 / 单选手视角）共享同一过滤函数，**知识隔离在结构上不可泄露**（对抗性测试覆盖）。

## 架构亮点

- **品类即插件**：接入第三游戏阿瓦隆时，平台核心（GM 调度 / 存储 / 观战框架）零分支改动——引擎实现 `GameModuleV2` 契约（create / classify / legalActions / decisionContext / applyAction / 重放）+ 四支柱呈现契约（态势 / 事件流 / 阶段模型 / 结算）即可上线。
- **LLM 决策链路**：决策上下文只由「该选手可见事件子集」机械重建（引擎状态不落 prompt）→ `<thinking>` + `<action>` 结构化输出 → 中英文别名容错归一 → 引擎 zod 裁决 → 任何失败走确定性默认动作，**对局永不死锁**。
- **AI 主持人与赛后解说**：旁白只由公开事件渲染（受限信息结构性不入 prompt）；解说有四层防虚构防线（真实事件摘要 → 提示词铁律 → 服务端逐 seq 校验 → 过半无效整体拒绝）。
- **ELO 天梯**：品类分列、多人零和两两守恒更新（阵营游戏胜方全员 vs 负方全员）、平局不计分、全量重放幂等——历史对局随时可重建出逐分一致的天梯。
- **成本可观测**：每次 LLM 调用（决策 / 主持 / 解说）落 `llm_usage` 流水，按选手 / 用途 / 日期聚合。
- **安全模型**：API Key 只存浏览器 localStorage，对局时上传 Redis keyring（24h TTL）单局使用，服务端零持久化。

## 技术栈

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · Zustand · Drizzle ORM + SQLite · Redis (ioredis) · Vercel AI SDK 5（openai-compatible / anthropic 双 provider）· A2A 协议（`@a2a-js/sdk`）· Vitest · Docker Compose（Next + Redis + Caddy）

## 快速开始

```bash
npm run bootstrap      # 新设备初始化
cp .env.example .env   # 填 MATCH_TOKEN_SECRET 等
npm run db:migrate
npm run infra:up       # 本地 Redis（docker compose）
npm run dev            # → http://localhost:3000
```

生产部署（单机 Docker）：`npm run release` 一条命令完成 门禁 → 打包 → 上传 → 远程构建 → 迁移 → 健康门禁 → **失败自动回滚**。详见 `docs/deploy/release-pipeline.md`。

## 质量门禁

```bash
npm run check          # surfaces 校验 + ESLint + tsc + 663 项测试 + 生产构建
```

CI 四并行 job（lint / typecheck / test / build）+ 手动 CD 通道保护 main 分支。测试只放顶层 `tests/unit/`（镜像 src 结构），与工程代码严格分离。

## 仓库地图

```
src/
├── app/         # Next.js App Router：页面 + HTTP/A2A/GM 端点
├── frontend/    # 观战组件、zustand store、v2 事件投影
├── backend/     # GM 驱动循环、agent runtime、A2A core、对局生命周期
├── platform/    # DB / Redis / LLM 网关 / 遥测 / 引擎契约（GameModuleV2）
└── games/       # 游戏自治包：poker / werewolf / avalon（各含 engine2 + integration + agent）
docs/            # 唯一权威文档树（入口 docs/INDEX.md：PRD、路线图、审计、规格、调研）
ops/             # 部署流水线（Dockerfile / compose / Caddy）+ 本地开发环境
```

文档即权威：需求只来自 `docs/prd/`（FR / NFR / 全部开放决策已拍板归档），实现与 PRD 冲突时以 PRD 为准。任何 agent 或人类从 [`AGENTS.md`](AGENTS.md) → [`docs/INDEX.md`](docs/INDEX.md) 进入即可定位一切。

## License

Private（公开形态待定，见 `docs/prd/PRD.md` OD-3）。
