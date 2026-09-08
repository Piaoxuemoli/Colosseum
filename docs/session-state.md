# AI Session State

> 长任务恢复用的当前状态快照。每完成一个 roadmap 任务、遇到阻塞或 SDK/API 漂移后更新。
> 不记录密钥、cookie、token 或个人隐私。历史版本在 git 历史中（2026-09-08 之前的老流水账已随 R0 重建清掉）。

## Active Context

- 当前阶段：**R2 核心体验补全进行中（2026-09-09）**。R2-1 密钥状态 UX ✅、R2-2 主持人种子+旁白开关 ✅；**引擎 v2 已接入平台且是唯一运行时**（spec `docs/specs/engine2-integration.md`：GM 只驱动 `GameModuleV2`，v1 引擎栈已于 2026-09-09 整体删除——旧 engine 目录、werewolf-hooks、action-validator、v1 bot/context/parser 与 v1 测试；`games/*/plugin.ts` 现为 v2 插件薄再导出）。下一步主线 = R2-3/2-4（历史复盘增强、结算可信化）+ R2-5/2-6（真实 LLM 全链路验收）。
- **运维备注（部署后必办）**：生产上遗留的旧格式 RUNNING 对局无法被 v2 运行时解读——部署本版后须逐个调 `POST /api/matches/:id/force-end` 强制终结（force-end 不依赖 state 形状，可安全收尾旧局）。
- 产品开放决策已全部由 AI 产品代理代决（38 项，`docs/prd/` 各文档「已代决」标注，所有者可推翻）。
- 安全：git 历史已清除泄露 key（force push 完成）；**key 吊销待用户线下处理（豆包/Kimi/DeepSeek/GLM/通义/MiniMax）**。
- 测试基线：31 文件 / 362 测试全绿（2026-09-09 v1 清理后；清理前 49 文件 / 694，删除的 332 个为 v1 引擎/解析器专属测试，v2 覆盖在 engine2/ 与 plugin-v2/GM-v2 测试中）；CI 四 job 全绿。
- 导航入口：`AGENTS.md` → `docs/INDEX.md`。

## 引擎 v2 接入落点（2026-09-09 完成后的入口知识）

- 德扑 v2：`src/games/poker/engine2/`（API barrel 见 index.ts；applyAction 返回 accepted/rejected 二态、事件带 audience、`reduceEvents` 重放、`filterEvents` 四视角投影含 god-view 通道、`decisionContext` 机械量）。
- 狼人杀 v2：`src/games/werewolf/engine2/`（`createMatch`/`applyAction`/`applyDefaultAction`/`visibleEvents`；板子预设 6 人基础 + 9 人 333；M1 不含警长/守卫/白痴——开启会结构化拒绝）。
- 平台插件面：`games/*/integration/plugin-v2.ts` 实现 `platform/engine/contracts-v2.ts` 的 `GameModuleV2`（方法语法双变注册，无双重断言）；`games/*/poker-plugin|werewolf-plugin.ts` 是其薄再导出（德扑另导出 A2UI 配置面五件套，`.a2ui/` 由 check:surfaces 校验）。
- GM/agent endpoint 均为 v2 单路径：agent 决策上下文唯一真相 = `visibleEventsFor(fullStream, actorId)`；normalizeAction 失败 → `applyDefaultAction` 兜底。v1 的 botStrategy 三层链、action-validator、werewolf-hooks 已删除；通用 `llm-stream-parser` 内联了狼人 v1 词法的截断救援别名表（v2 normalizeAction 仍接受该词法）。
- 记忆层留存：`games/*/memory/` 未删——德扑 memory 由 v2 插件的 impressions 钩子活用；狼人 memory 暂无 v2 消费方，其 v1 形状类型已本地化到 `werewolf/memory/types.ts`（接入时由插件层做形状适配）。
- 前端 v1 事件投影保留（回放历史对局的 legacy 事件 kind）；v2 投影在 `frontend/store/projections/*-v2.ts`，对未知 kind 静默忽略。

## R1 落点（2026-09-08）

> **⚠️ 2026-09-08 git 历史已重写**：为清除泄露凭据（见下），用 git-filter-repo 从全部历史剥离 `old/src/store/profile-store.ts` 与 `archive/old/src/store/profile-store.ts` 两个路径并 force push（main + 4 tag）。**本文及审计文档中此前的 commit 哈希引用（621168f、1ba955c、d3a6f0e、c20a3f9、c136aff、141aa76、de2179e、2937d9a、aa594f7 等）已随重写失效，仅作时间线索参考。** 6 个 key 前缀已验证全历史 0 命中；GitHub 端旧对象待其 GC 回收（私有仓库 + 用户自行吊销 key 后风险可控；如需立即清除可联系 GitHub Support）。审计 02 的「清史」可选项已完成，key 吊销仍待用户线下执行。

- 测试体系：Vitest 4.1 + 顶层 `tests/unit/`，19 文件 / 367 测试全绿（poker 115、werewolf 184、平台/解析器/store 68）；`npm test` 接入 `check` 与 CI。
- CI：`.github/workflows/ci.yml`（lint / typecheck / test+surfaces / build 四并行 job，Node 22，npm 缓存，PR 并发取消）。**推送后需在 GitHub 上确认首轮 run 全绿。**
- 游戏调研 ×2 → 游戏 PRD ×4 + 大厅 PRD ×1；审计增补 23-36 号（§八）。
- 单测期间新发现并登记的旧引擎缺陷：审计 23-34（含 match-view-store 显示类小 bug 32/33，测试按现状断言 + NOTE，修复时同步翻转断言）。
- 待用户：① 吊销泄露 key（审计 02）；② 逐步拍板 PRD OD-1~7 与各游戏 PRD 的开放决策（WOD-1~7 / OD-P1~P8 / L-1~3 / PG/W 系）。

## R0 重建落点（2026-09-07/08 提交链）

| commit | 内容 |
|---|---|
| `621168f` | 安全清理：删除 archive/ 与 mcp-servers/（含真实形态泄露凭据） |
| `1ba955c` | 合并 feature/a2ui-config-page（A2UI 配置面板 + playground + poker .a2ui + check:surfaces） |
| `d3a6f0e` | 清空旧测试体系（6 个孤儿测试 + scripts/werewolf 验证脚本，-714 行） |
| `c20a3f9` | 死依赖 postgres / 配置漂移清理 / env 收口 / tmp/ 机制 |
| `c136aff` | docs/ 重构为唯一权威树 + AGENTS.md/INDEX.md 重建 |
| `141aa76` | PRD v0.1 + roadmap + design-system 从零重建 |
| `de2179e` | 大修审计文档（22 项编号问题） |
| `2937d9a` | npm 仓库 CI/测试体系调研报告 |

## A2UI 子系统现状（随 1ba955c 合入）

- 方案：官方 `@a2ui/react@0.10` + `@a2ui/web_core` + `colosseumCatalog` + 每游戏 `.a2ui/` 配置目录；设计文档 `docs/specs/2026-06-16-a2ui-config-page-design-claude.md`。
- kill-switch：`NEXT_PUBLIC_A2UI_CONFIG=on` 才启用，**默认关**——旧表单是默认零风险路径。
- 已知 stub：AgentPicker / KeyCheckPanel 为占位组件；A2UI 路径不含 keyring 上传（旧表单仍是完整路径）。
- zod 3/4 经 `zod3` npm alias 共存（A2UI 官方库依赖 zod3）。
- 构建期校验：`npm run check:surfaces`（`scripts/a2ui/validate-surfaces.mjs`）。

## 必须记住的运维事实

- 生产：`http://43.156.230.108/`（裸 IP，域名审核未过→无 TLS；过审后在 `ops/deploy/Caddyfile` 启用域名块自动签证书）。栈 = colosseum:prod(Next) + redis:7 + caddy:2，SQLite 挂 `/data` 卷。部署流程权威入口：`.kimi-code/skills/deployment/SKILL.md`。
- 生产 `scripts/backup.sh` 曾报 Permission denied（可执行位/挂载权限未排查，cron 备份可能未生效——R1 需验证 `/var/backups/colosseum/` 是否有新快照）。
- 服务器无 Node，验证用 `docker run --rm -v /opt/colosseum:/app -w /app node:22-alpine …` 容器跑 lint/typecheck/build（R1 建 CI 后此流程退役）。
- **安全未闭环**：泄露的旧 key（豆包/Kimi/DeepSeek/GLM/通义，见 audit 02）仍在 git 历史与 GitHub 远程；用户吊销前不得公开仓库；如需清史用 `git filter-repo` + force push（需用户确认后执行）。
- 本地 Node v25 可跑全部门禁；`.nvmrc` 与生产容器钉 22。

## SDK / 环境漂移备忘

- `ai@5` 与 provider 版本锁死：`@ai-sdk/openai-compatible` 必须 `^1.0.39`、`@ai-sdk/anthropic` 必须 `^2.0.79`（同 pin `@ai-sdk/provider@2.x`）。不升 `ai` 到 6 就不要 bump 这两个 provider。
- 环境变量一律走 `src/platform/env.ts` 的 zod schema；已知豁免：`logger.ts` 的 `LOG_LEVEL`（客户端 bundle 无法 import env.ts，已注释说明）、`a2ui-flag.ts` 的 `NEXT_PUBLIC_A2UI_CONFIG`（构建期内联）。
- `M4_MOCK_LLM` 语义：仅 `=1` 启用 mock（保持历史行为，勿改成 truthy 判断）。
- Next `build`/`dev` 会自动往 tsconfig include 回写 `.next-build/types/**/*.ts`——框架行为，非漂移；该 glob 因 `.next-build` 在 exclude 中而恒为空，删除后回写属正常。
- ESLint 10：用 `eslint .`（flat config），`next lint` 已废弃不可用。

## Resume Checklist

1. 读 `AGENTS.md` → `docs/INDEX.md`。
2. 读 `docs/prd/roadmap.md`，找当前阶段第一个未勾选任务。
3. 读该任务引用的 PRD FR 编号与 audit 编号，按 `docs/rules/spec-plan-workflow.md` 出 plan 再实施。
4. 验证用 `npm run check`（check:surfaces + lint + typecheck + build）。
5. 完成后更新本文件与 roadmap checkbox。
