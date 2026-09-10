# AI Session State

> 长任务恢复用的当前状态快照。每完成一个 roadmap 任务、遇到阻塞或 SDK/API 漂移后更新。
> 不记录密钥、cookie、token 或个人隐私。历史版本在 git 历史中（2026-09-08 之前的老流水账已随 R0 重建清掉）。

## Active Context

- 当前阶段：**R4-1 + 首页重构 + R4-3 全部完成并上线（生产 18cdb2c1，2026-09-10）**。R4 剩余：R4-4 分享链接（硬前置：用户确认 key 吊销）、R4-2/5/6 按需。
- **生产 ELO 已回填**：`POST /api/stats/elo/rebuild`（10 局 poker 历史 → 6 名选手，doubao-seed 1071 领跑）；此后每局 completed 由结算钩子自动更新（幂等对账随时可重跑）。
- **⚠ 未结案：生产间歇性 heap 泄漏（2026-09-10 发现）**。现象：nextjs 容器部分实例以 ~47MB/min 涨满 OOM（0238ddb5 上线后 18+ 次重启），部分实例数小时平稳 173MB——**间歇双态**。已实验排除：首页流量（本地 prod 压测平稳）、SSE 在线+连断风暴（600 churn 后完全回收）、fd/连接泄漏（fd=22）、Redis 断连重试堆积、GM tick（纯被动）、logger/metrics/registry（全有界）、业务写入（泄漏窗口零写入零事件）。**取证机制已固化随发版**：compose `NODE_OPTIONS=--heapsnapshot-near-heap-limit=2 --max-old-space-size=1600` + Dockerfile `chmod 777 /app`（上一轮「Wrote snapshot」文件消失 = nextjs 用户对 /app 无写权限）+ 服务器 cron 每 10 分钟 docker cp 快照到 /opt（`heapsnapshot-guard`）。**下一波触发时快照自动落地，取 /opt/Heap.*.heapsnapshot 解析即可定位；定位修复后移除三处取证设施**（compose 注释已标）。OOM 期间 docker restart 自动拉起兜底，服务可用性影响 = 偶发瞬断。
- **安全闭环（2026-09-10 用户确认）**：全部 6 家泄露 key 已吊销（豆包/Kimi/DeepSeek/GLM/通义/MiniMax）+ git 清史完成 → R1-3 勾选；R4-4 分享链接硬前置解除；仓库公开化（OD-3）凭据阻塞解除（公开形态待所有者拍板）。
- **发版链路新坑（2026-09-10）**：① 本机代理进程死亡 → git 走 7890 全挂——已设仓库级 `http.proxy=""` 直连（直连时通时断，push/fetch 需重试）；release.mjs precheck 的 fetch 已加容忍（fetch 失败但 origin/main==HEAD 放行）；② **国际线路 SSH 数据通道被 QoS 掐**（命令通道稳定、scp/管道传输必断）——破解 = base64 切 30KB 块 × 77 次 ssh 命令通道追加 + md5 校验 + 手动跑 remote-deploy.sh（可复用套路，见本轮操作记录）。
- **A2UI 子系统现状（2026-09-10 核实）**：PoC 完成度——依赖 @a2ui/react@0.10 + web_core@0.10（zod3 npm alias 共存）；已建 colosseumCatalog（官方组件 + AgentPicker/KeyCheckPanel **stub 占位**）、A2UIConfigSurface、/a2ui-playground、poker `.a2ui/surface/match-config.json`（9 组件）、check:surfaces 构建期校验、kill-switch（NEXT_PUBLIC_A2UI_CONFIG **默认关**）。缺口：核心自定义组件未实现、A2UI 路径无 keyring 上传链路（传统表单是生产路径）、狼人/阿瓦隆未接、官方库 0.x 早期。定性：**实验并行路径，PoC 阶段完成，v1 生产化未启动**。
- R4-1 / 首页 / R4-3 交付细节见 git 历史（b980c2f / 0238ddb5 / 03b9367 / 18cdb2c）与下文。
- **R4-3 交付（FR-4.9-01，OD-5 方向 b 落地）**：公平性口径七条代决（品类分列 / Agent 实体即选手 / 1000+K32 / 多人零和两两守恒[阵营游戏胜方全员 vs 负方全员、阵营内不分高下] / 平局跳过 / 胜负判定与 FR-4.6-05 同源 / 全量重放幂等）。实现 = migration 0003 `elo_ratings`（PK agent+gameType、无外键审计流水）+ `platform/stats/elo` 纯函数（delta = K×Σ(S−E)/(n−1)，零和有界）+ `queries/elo`（`applyEloForMatch` 挂 match-lifecycle finalize 后非阻塞；`rebuildEloFromHistory` 清空重放幂等；`getEloLadder`）+ `rankingRowOutcome` 补 avalon 分支（wolf/avalon 同门：score1 + 有效 faction 才胜）+ API `GET /api/stats/elo?gameType=`、`POST /api/stats/elo/rebuild` + /stats 天梯区（?eloGame= 切换）。28 新测试（纯函数 12 + 查询 16，内存库跑真实迁移链）。**发版后生产须执行一次 rebuild 回填存量**；本地 dev.db 已手工补 0003 表（drizzle-kit migrate 在 Git Bash 管道下静默不应用的老坑——直接 better-sqlite3 exec SQL）。
- **R4-1 交付（OD-1 落地：社交推理同品类扩板）**：需求 `docs/prd/games/avalon-engine.md`（5 轮 3 胜/连坐 5 次拒/刺杀环节/公开记名表决/讨论阶段/8 角色池/9 预设板 5–10 人，AVR-OD-1..7 代决）+ `avalon-frontend.md`（专属投影，AF-OD-1..3）。实现 = 引擎全量重写（`games/avalon/engine2` 3002 行 + 集成 + narration 触发注册，84 测试）+ 前端（`avalon-v2` 投影 + 10 组件 + 组局预设选择器，46 测试）+ **agent endpoint v2 装配**（`games/avalon/agent/context-builder-v2 + response-parser-v2` + `backend/agent/v2-agent-branch.ts` 条目注册——此缺口是冒烟版遗留：R3-2 只验证过 GM 兜底驱动，真实 LLM 链路首次走通时抓到 `no v2 context builder for gameType: avalon`，全部动作曾被兜底代打）。真实 LLM 双局验收（kimi-k3@ark）：basic-5 = 刺杀命中梅林 evil 翻盘（167 事件/4 默认/5 瞬时错误）；basic-6 = 指认落空 good 胜（178 事件/11 默认/9 瞬时错误/发言 22/26 非空）——**对称覆盖刺杀两分支**，双局自然终局。基线 646 测试 / 55 文件全绿。
- **首页重构（lobby PRD v0.1.2 首次实施）**：五区结构（顶部 slogan+运行中数锚点 / 直播区六要素卡片[呼吸点+阶段进度] / 快速开始 S0/S1/S2/S2′ 状态感知 / 最近对局 / 次级导航），删死信息三统计卡，修 avalon 误显示为狼人杀的品类 bug，过滤条补三品类；直播卡片阶段进度自 `game_events` 最近一条 phaseEntered/hand-started 派生（`list-matches-filtered.ts` 的 `phaseSummaryFromEvent`，matches 表无 stateJson——引擎态在 Redis，终局才落库）。取舍：直播区 SSE 实时与分批加载后置（server 渲染快照）。
- **本地 dev.db 新坑**：journal 空导致 `drizzle-kit migrate` 在 Git Bash 管道下静默不应用（spinner 截断无输出）——直接 better-sqlite3 执行 0002 SQL 补 llm_usage 表；生产 entrypoint 的 migrate 不受影响。
- 生产 `http://43.156.230.108/`：运行 `188555a`（R3 版本）；R4-1 + 首页重构待发版。
- 前一阶段（R3 + 发版链路）成果见 git 历史与本文件下文。
- **发版链路（已建成，双通道）**：`npm run release`（门禁→git archive→scp→远程部署[全量换树+镜像新鲜度守卫+健康门禁+失败自动回滚]）；GitHub Actions `deploy.yml` 手动 CD（需配 DEPLOY_SSH_HOST/USER/KEY secrets，详见 `docs/deploy/release-pipeline.md`）。回滚 `npm run release:rollback`。
- **首次发版踩坑实录（已全部修复，勿再踩）**：① tar 解包不删旧文件→服务器残留 6 月的 archive/ 死代码→Docker 构建编译死代码失败（dexie）；② `build | tail` 管道吞退出码（sh 无 pipefail）→旧镜像假阳性上线；③ git archive 不带执行位→backup.sh 自 5 月起 cron 全灭。对应修复：全量换树+.env 回迁、构建日志不接管道+镜像 Created 时间守卫、git 100755。
- 部署后运维：旧 running 局为 0（无需 force-end）；备份已修（服务器 chmod + 手动验证 + 仓库 100755）；/、/stats、/matches/new 全 200；TLS 仍等域名过审（audit 11 剩余项）。
- R3 交付一览与真实 LLM 验收记录见下；LLM key 只存 .env（gitignored）。
- 产品开放决策已全部代决（38 项，可推翻）；**key 吊销仍待用户线下处理（6 家）**。
- 测试基线：51 文件 / 539 测试全绿；CI 四 job。
- **R3-1 呈现契约抽象已实现（2026-09-09，FR-4.5-03 前半）**：规格 `docs/specs/presentation-contract.md`；契约类型 `platform/engine/presentation.ts`（经 contracts-v2 再导出，`GameModuleV2.presentation` 必选成员，方法语法无断言注册）；两游戏实现 `games/*/integration/presentation-v2.ts`（态势/事件流 hints/阶段模型/结算四支柱纯派生）；前端兜底投影 `frontend/store/projections/generic-v2.ts`（事件流通用锚点：信封/名册/轮次/阶段/结算，未知 gameType 观战回落 `GenericSituationPanel`）；一致性门禁 `tests/unit/platform/engine/presentation-contract.test.ts` 的 `assertPresentationContract`（R3-2 新品类接入必跑）。SpectatorView gameType 分派改为 poker/werewolf/通用三分支（prop 放宽为 string）。
- **R3-5 + R3-6 统计与用量集群已实现（2026-09-09，FR-4.6-05 观众面 / FR-4.8-03 / NFR-06）**：新表 `llm_usage`（migration 0002，无外键审计流水）；捕获链 = llm-runtime `runDecision` 返回 `usage`（ai@5 `result.totalUsage`，openai-compatible 已开 `includeUsage:true` 否则流式恒 undefined）→ agent endpoint 成功/失败双路径落流水（fire-and-forget-safe，mock 模式不记）。查询层 `platform/db/queries/stats.ts`（显式 dbh 注入，内存 SQLite 可测）：选手排行（仅 completed 对局，从 finalRanking JSON 读胜负——poker rank1 / 狼人 score1+winnerFaction≠tie；平局全员 score=1 不计胜）+ 用量聚合（agent/purpose/day 分组，day=UTC）+ 对局用量摘要。API：`GET /api/stats/agents`、`GET /api/stats/usage?matchId&agentId&purpose&groupBy`、`GET /api/matches/:id` 增加 `usage` digest。前端 `/stats`（排行表 + 用量面板 groupBy 切换，中文控制台风格），侧栏与大厅入口「统计」。测试 +27（`tests/unit/platform/db/stats.test.ts` 内存库跑真实迁移链 + `usage-capture.test.ts`）。**局限**：主持/解说用途的捕获点未接（parallel tenant owns commentary/GM，purpose 枚举已预留）；profile-test 探针未接（route 无 profileId 且非 SDK 路径）；存量 dev.db 需 `npm run db:migrate` 后才有 llm_usage 表。
- **R3-3 AI 主持人旁白增强已实现（2026-09-09，FR-4.7-01）**：触发判定纯函数 `games/werewolf/integration/narration.ts`（`werewolfNarrationTrigger(state, batch, context)`，触发点=deathsAnnounced（含平安夜）/ voteResult(outcome=exile) / gameEnded；digest **只由 audience=public 的事件渲染**——结构性约束，受限 payload 永不入 prompt；上下文窗口 12 事件 / 20 行 / 摘录 40 字封顶）。编排 `backend/match/narration.ts`（narrationEnabled 总闸关=零 LLM 调用；主持人解析 config.moderatorAgentId → findAgentById，存量局回落 listAgents(kind=moderator) 首个；key 走服务端 matchKeyring（`getApiKey`）；prompt=人设+「仅依据公开事实 ≤80 字、不虚构、不剧透」铁律+digest；成功落 `llm_usage` purpose=moderator-narration（mock 不记））。LLM 调用 = llm-runtime 新增 `runNarration`（无 <action> 解析、maxOutputTokens 256、30s 超时、M4_MOCK_LLM 模拟路径从 digest 取材）。GM 钩子在 game-master.ts 批落库后调 `generateModeratorNarration`，成功则经 `reserveEventSeq` 预留 seq 追加 `werewolf:v2:moderatorNarration` 公共事件（payload { text, source:'llm', triggeredByKinds }）；**任何失败 debug 日志静默跳过，无罐头兜底**。配套：match-lifecycle 把 moderatorAgentId 持久化进 matches.config（存量局回落 DB 主持人）；前端 werewolf-v2 投影 case `moderatorNarration` → ModeratorPanel 旁白流（两视角均见）。测试 +26（触发纯度/公开约束 10 + 编排 11 + GM 集成 3 + 投影 2）。
- **真实 LLM 验收已通过（本地 dev，kimi-k3@ark）**：狼人杀 2 天完整局（74 事件 / 0 错误 / 排名+角色+死因落库，好人胜：狼 1 放逐 + 狼 2 毒杀）+ 德扑含 all-in 自动 run-out 的受控局（3 次强制摊牌 / 边池 / 2 淘汰 / 2 次瞬时错误被三层容错兜底续跑）。驱动脚本 `scripts/dev/local-llm-validation.mjs`（外部 tick 补发 + `--resume` 续管）；**LLM key 只存 .env（gitignored），绝不入库**。
- **运维备注（部署后必办）**：① 生产遗留旧格式 RUNNING 对局逐个 `POST /api/matches/:id/force-end` 强制终结（不依赖 state 形状）；② 存量数据库需 `npm run db:migrate`（新增 llm_usage 表 migration 0002）。
- **R3-4 赛后解说已实现（2026-09-09，FR-4.7-02）**：`POST /api/matches/:id/commentary`（body 带 apiKey，profileId 或 baseUrl+model 二选一；仅本次调用、不持久化）；四层防虚构（digest 真实性 → prompt 铁律 #seq → 服务端逐 seq 校验 → 过半无效整体 422）；产物落 `match/commentary` 公共事件（幂等取最新）；CommentaryPanel 挂结算/回放，highlight 点击跳 seq；调用记 llm_usage（purpose=commentary）。33 测试。
- **R3-2 简化阿瓦隆已在线（冒烟品类）**：`src/games/avalon/`（38 测试含契约符合性 + GM default 驱动终局）；固定 5 人板、3 轮任务 2 胜制；观战走 GenericSituationPanel 通用兜底；平台接入仅 3 处条目级——NFR-08 实证。
- 产品开放决策已全部由 AI 产品代理代决（38 项，`docs/prd/` 各文档「已代决」标注，所有者可推翻）。
- 安全：git 历史已清除泄露 key（force push 完成）；**key 吊销待用户线下处理（豆包/Kimi/DeepSeek/GLM/通义/MiniMax）**。
- 测试基线：36 文件 / 408 测试全绿（v2 运行时 362 + R2-3/4 复盘结算 46）；CI 四 job。
- 导航入口：`AGENTS.md` → `docs/INDEX.md`。

## 本地真实验收的运维经验（重要，勿再踩）

- **`.next-build` 是 dev 与 build 共享的 distDir**：dev server 运行时跑 `npm run build` 会互相清对方的 chunk（`Cannot find module './xxx.js'` → 全站 500）。验收/构建前必须先停 dev server。
- **dev 模式下 tick 自驱动链不抗编译风暴**：自链 fetch 失败被静默吞掉导致对局停摆；用 `local-llm-validation.mjs`（内置外部补发 tick）或手动 `POST /api/matches/:id/tick` 续推。生产模式（next start）无此问题。
- 后台起 dev server 不要用 `| head`（管道关闭杀日志且可能留孤儿进程占端口）；用 `> tmp/dev-server.log 2>&1`。
- Docker Hub 直连不可用：`docker pull docker.m.daocloud.io/library/redis:7-alpine` 再 `docker tag` 成 `redis:7-alpine`。
- 端口僵尸进程：`netstat -ano | grep :3000` 找 PID → `taskkill //PID <pid> //F`。

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

## 必须记住的运维事实（2026-09-09 全面刷新）

- 生产：`http://43.156.230.108/`（裸 IP，域名审核未过→无 TLS；过审后在 `ops/deploy/Caddyfile` 启用域名块自动签证书）。栈 = colosseum:prod(Next) + redis:7 + caddy:2，SQLite 挂 `/data` 卷。**发版 = `npm run release`**（权威文档 `docs/deploy/release-pipeline.md`；CD 通道需在 GitHub 配 `DEPLOY_SSH_HOST/USER/KEY` secrets——用户尚未配置）。
- 备份：cron 03:07 正常（backup.sh 执行位已双修：服务器 chmod + git 100755）；发版前另有 pre-deploy 备份；历史断档区间 2026-05-21 ~ 2026-09-09（执行位丢失所致，已修复验证）。
- **安全未闭环（唯一用户动作）**：泄露的 6 家旧 key（豆包/Kimi/DeepSeek/GLM/通义/MiniMax，见 audit 02）**吊销未完成**。git 历史清除已于 2026-09-08 完成（filter-repo + force push，全历史 0 命中）；吊销完成前仓库保持私有。
- 本地 Node v25 可跑全部门禁；`.nvmrc`、CI 与生产容器钉 22。
- 服务器验证流程已退役（CI 取代）；临时上服务器用 root@ + 本地 `~/Downloads/hermesqoobee.pem`（或 `ops/private/deploy.pem`）。

## SDK / 环境漂移备忘

- `ai@5` 与 provider 版本锁死：`@ai-sdk/openai-compatible` 必须 `^1.0.39`、`@ai-sdk/anthropic` 必须 `^2.0.79`（同 pin `@ai-sdk/provider@2.x`）。不升 `ai` 到 6 就不要 bump 这两个 provider。
- 环境变量一律走 `src/platform/env.ts` 的 zod schema；已知豁免：`logger.ts` 的 `LOG_LEVEL`（客户端 bundle 无法 import env.ts，已注释说明）、`a2ui-flag.ts` 的 `NEXT_PUBLIC_A2UI_CONFIG`（构建期内联）。
- `M4_MOCK_LLM` 语义：仅 `=1` 启用 mock（保持历史行为，勿改成 truthy 判断）。
- Next `build`/`dev` 会自动往 tsconfig include 回写 `.next-build/types/**/*.ts`——框架行为，非漂移；该 glob 因 `.next-build` 在 exclude 中而恒为空，删除后回写属正常。
- ESLint 10：用 `eslint .`（flat config），`next lint` 已废弃不可用。

## Resume Checklist

1. 读 `AGENTS.md` → `docs/INDEX.md` → 本文件。
2. 当前阶段 R4（R4-1 已完成）：**默认推进顺序 = R4-4 分享链接（硬前置：key 吊销确认）→ R4-3 ELO（前置：公平性口径）**。也可等用户点名。
3. 每任务按 `docs/rules/spec-plan-workflow.md`：读对应 PRD FR → 出 plan → 实施 → 验证。
4. 验证 = `npm run check`（check:surfaces + lint + typecheck + **test** + build）。
5. 完成后更新本文件与 roadmap checkbox；发版 `npm run release`。
