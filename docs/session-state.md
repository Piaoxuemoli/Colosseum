# AI Session State

> 长任务恢复用的当前状态快照。每完成一个 roadmap 任务、遇到阻塞或 SDK/API 漂移后更新。
> 不记录密钥、cookie、token 或个人隐私。历史版本在 git 历史中（2026-09-08 之前的老流水账已随 R0 重建清掉）。

## Active Context

- 当前阶段：**R0 重建已完成（2026-09-08）**。仓库已转为「需求体系（docs/prd/）与实现体系（src/ + docs/specs/）严格隔离」的结构；现有实现被定位为「现存残留，非基线」，后续按 PRD roadmap 逐任务重构。
- 需求权威：`docs/prd/PRD.md`（v0.1 草案，含 OD-1~7 开放决策待所有者拍板）＋ `docs/prd/roadmap.md`（唯一排期权威）＋ `docs/prd/design-system.md`（前端重建的视觉/交互需求）。
- 导航入口：`AGENTS.md` → `docs/INDEX.md`。任何 agent 进入仓库先走这条路径。
- 下一步：roadmap **R1 质量地基**——① 用户吊销泄露的旧 API key（见下）；② 按调研报告建 GitHub Actions（`docs/research/2026-09-ci-test-survey.md` §6.3 有现成 ci.yml 草案）；③ 按同报告 §6.2 顶层 `tests/` 布局分阶段恢复单测。
- 大修跟踪：`docs/repair/2026-09-audit.md`（22 项编号问题；01/05/17/18 已修，06/07/08 随 R0 修复，02 key 轮换 / 03 CI / 04 测试为 P0 待办）。

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
