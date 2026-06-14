# AI Session State

> 给长任务恢复用。每次完成一个 plan task、遇到阻塞、或发现 SDK/API 漂移后更新。不要记录密钥、cookie、token 或个人隐私。

## Active Context

- Active spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`
- Brief spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`
- Active plan set: Phase 4 Task 1–5 完成;Phase 4 Task 6 (M7 烟测 + demo 截图) + Phase 5-2 Task 7 (M8 Vercel) 挂起。
- Current phase: Phase 4 Task 1–5 完成(已部署到 `http://43.156.230.108`)
- Current task: Phase 4 Task 6 (M7 manual smoke checklist,生产部署已复测;仍建议用户跑一轮带真实 key 的 UI 对局)
- 生产部署:`http://43.156.230.108/`,栈 = nextjs(colosseum:prod) + redis:7-alpine + caddy:2-alpine,SQLite on `/data` 卷。

## Last Known Status

- Phase 0 is merged to `main` and pushed. Tag `phase-0` exists remotely.
- Phase 1A is merged to `main` and pushed. Tag `phase-1a` exists remotely.
- Phase 1B is merged to `main` and pushed.
- Phases 2-1, 2-2, 3-1, 3-2, 3-3, 3-4 merged to `main` (merge commit `7acea7a`).
- Phase 5-1 (replay) merged to `main` (merge commit `6300b61`) and pushed.
- `npm run check` green on main: lint, typecheck, 87 test files / 349 tests, Next production build (includes new `/matches/:id/replay` route).
- 2026-06-05 德扑观战/回放和引擎修复已在本地完成并部署到 `http://43.156.230.108`：公开 `poker/state` 快照、牌面/盲注/庄家/街池/边池展示、右侧状态面板、agent 名称化 action log、手后收尾 API/按钮、多手 GM continuation、回放终局摘要、事件 gameType 推断和测试 Web Streams polyfill。
- 2026-06-05 生产部署时修复 `ops/deploy/entrypoint.sh` CRLF 行尾导致 Alpine 报 `/entrypoint.sh: not found` 的问题；新增 `.gitattributes` 强制 `*.sh` LF 和 `tests/deploy/entrypoint-line-endings.test.ts` 回归测试。
- 2026-06-05 按用户要求，项目校验改为只在生产服务器执行：服务器主机无 Node，使用临时 `node:22-alpine` Docker 容器挂载 `/opt/colosseum` 跑 lint/typecheck/test/build。
- 2026-06-05 生产对局数据已清理并重启：备份 `/var/backups/colosseum/pre-clean-20260605-192227.db.gz`；保留 `api_profiles=1`、`agents=6`；清空 `matches/match_participants/game_events/agent_errors/working_memory/episodic_memory/semantic_memory`；Redis `DBSIZE=0`；`/api/matches` 返回空数组。
- 2026-06-05 德扑正式上线修复曾部署为持续桌 + 破产 rebuy；该 rebuy 语义已被 2026-06-05 后续澄清取代。`/end` 请求改用独立 Redis stop flag，避免被并发 tick 覆盖，此 race 修复保留。
- 2026-06-05 正式上线前生产数据再次清理并重启：备份 `/var/backups/colosseum/pre-launch-20260605-210821.db.gz`；保留 `api_profiles=1`、`agents=6`；清空所有对局/事件/错误/记忆表；Redis `DBSIZE=0`；`/api/matches` 返回空数组。
- 2026-06-05 德扑持续桌语义按用户澄清调整：不再 rebuy；筹码归零的玩家保持 `eliminated`、无手牌、不可行动；当仅剩 1 名有筹码玩家时自然 `completed`。
- 2026-06-05 仓库旧 Vitest/组件/集成测试体系已按用户要求清理，`npm run check` 收敛为 `lint && typecheck && build`；`npm test` 为测试体系重构期间的占位提示。测试专用 dev 依赖 Playwright/Vitest/Testing Library/jsdom 已移除并同步 lockfile。
- 2026-06-05 前端交互修复已部署：新增 pending 导航反馈和按钮按压反馈；创建对局去掉重复 `/api/matches/:id/keys` 上传，创建成功后立即进入“进入观战...”状态并跳转；大厅只保留一个“开始新对局”入口；侧栏左下角由过期 Phase 文案改为正式上线状态。
- 2026-06-05 生产最终清理并重启：备份 `/var/backups/colosseum/pre-final-launch-20260605-215416.db.gz`；保留 `api_profiles=1`、`agents=6`；清空对局/事件/错误/记忆表；Redis `DBSIZE=0`；`/api/matches` 返回空数组，健康检查 `{"ok":true,"db":"ok","redis":"ok"}`。
- Docker is available locally as of 2026-06-05 `npm run doctor`; production smoke can still use the server Docker stack for parity.
- 2026-06-13 德扑持续桌语义重新更正为“持续打下去”：文档中的“一手/一局结束即 completed”已改为手结束后自动开下一手，只有“本手后结束”/ stopRequested 才 completed；右侧栏已改为固定高度 Tab；Agent 动作容错新增 free fold→check 与金额规范化，agent endpoint 已记录的 `llm-*` fallback 不再被 GM 重复记为 `agent-invalid-action`。
- 2026-06-13 前端 polish 已完成：左侧导航基于 pathname + 点击乐观高亮，新增全局与观战页 loading skeleton，Tabs/Card/Dialog/Popover/右栏/牌桌座位收敛为紧凑控制台风格，右侧 Tab 内容按当前 Tab 懒挂载，UI 纲领更新为 React + Next.js + Tailwind CSS + shadcn/ui + Radix UI + lucide-react 的 award-grade arena console。
- 2026-06-13 已用 `C:/Users/Qoobeewang/Downloads/hermesqoobee.pem` 部署到 `http://43.156.230.108`：通过本地 `git archive HEAD` 上传到服务器解包，`docker compose up -d --build nextjs` 重建启动；健康检查和核心页面/API smoke 均通过。部署前尝试 `/opt/colosseum/scripts/backup.sh` 返回 `Permission denied`，未阻塞部署。
- 2026-06-14 新增错误分布详情、ErrorBadge 聚合展示、PlayerSeat/ThinkingBubble 细节打磨，已本地 lint/typecheck/build 通过并部署到 `43.156.230.108`，`/api/health` OK。
- 2026-06-14 新增 `.claude`/`.cursor` 部署命令与规则路由、thinking-bubble 布局辅助函数与测试、thinking-store 测试，已 lint/typecheck/build 通过并部署到 `43.156.230.108`，`/api/health` OK。
- 2026-06-14 修复 LLM 输出解析失败：`LlmStreamParser` 支持嵌套 `action` 字段与 markdown 代码块救援；Agent endpoint 在游戏 parser fallback 时复用 `runDecision` 已解析动作；`action-validator` 增加 `raise→call`、`call→check` 降级与金额 clamp；GM Agent endpoint 调用加一次 500ms 退避重试。本地临时脚本验证通过，lint/typecheck/build 通过，已部署到 `43.156.230.108`。
- 2026-06-14 修复 `/api/matches/[matchId]/end` 请求失败：路由缺少 `ensureGamesRegistered()` 导致 `getGame('poker')` 抛 `gameType not registered: poker`，已补上调用来注册游戏插件并重新部署。
- 2026-06-14 印象系统增加长文本描述：每手结束后 `persistHandImpressions` 自动基于观察者视角、semantic profile 分数和最近 5 条 episodic 记录生成一段中文印象段落，写入 `semantic_memory.profileJson.note`；`ImpressionsPanel` 已展示该字段。实现为本地规则化 summary 工具，无需额外 LLM 调用。已 lint/typecheck/build 通过并部署。

## Validation Log

| Date | Command | Result | Notes |
|---|---|---|---|
| 2026-05-06 | `npm run doctor` | Passed | Node v24.12.0; Docker/Compose warnings only |
| 2026-05-06 | `npm run check` | Passed | Phase 0 final gate passed |
| 2026-05-06 | `npx next start -p 3001` + toy agent HTTP checks | Passed | Phase 0 prod smoke passed |
| 2026-05-06 | `npm test tests/lib/core/ids.test.ts` | Passed | Task 1 core ID helpers, 5 tests |
| 2026-05-06 | `npm test tests/lib/core/types.test.ts` | Passed | Task 2 core types, 4 tests |
| 2026-05-06 | `npm test tests/lib/redis/keys.test.ts` | Passed | Task 3 Redis key helpers, 1 test |
| 2026-05-06 | `npm run db:generate` + `npm run db:migrate` | Passed | Task 4 generated/applied `0001_foamy_meteorite.sql` for 9 SQLite tables |
| 2026-05-06 | `npm test` | Passed | Task 4 regression: 18 files, 39 tests |
| 2026-05-06 | `npm run typecheck` | Passed | Task 4 schema expansion typecheck |
| 2026-05-06 | `npm test tests/lib/db/queries/agents.test.ts` | Passed | Task 5 agents/profiles queries round trip on migrated temp SQLite DB |
| 2026-05-06 | `npm test tests/lib/db/queries/matches.test.ts` | Passed | Task 6 matches/participants query round trip |
| 2026-05-06 | `npm test tests/lib/db/queries/events-memory.test.ts` | Passed | Task 7 events/errors/memory query round trips |
| 2026-05-06 | `npm test tests/lib/core/registry.test.ts` + `npm run typecheck` | Passed | Task 8 contracts/registry smoke and typecheck |
| 2026-05-06 | `npm test games/poker/engine/__tests__/deck.test.ts` | Passed | Task 9 poker card/deck, 6 tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/evaluator.test.ts` | Passed | Task 10 poker evaluator, 5 textbook tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/pot-manager.test.ts` | Passed | Task 11 side-pot manager, 4 tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/equity.test.ts` | Passed | Task 12 Monte Carlo equity, deterministic RNG, 2 tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/poker-types.test.ts` | Passed | Task 13 PokerAction/PokerState types, 5 schema tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/poker-engine.test.ts` | Passed | Task 14 PokerEngine initial state, 3 tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/poker-engine.test.ts` | Passed | Task 15 PokerEngine availableActions/applyAction, 9 tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/poker-engine.test.ts` | Passed | Task 16 PokerEngine street transitions/boundary, 11 tests |
| 2026-05-06 | `npm test games/poker/engine/__tests__/poker-engine.test.ts` + `npm run typecheck` | Passed | Task 17 PokerEngine settlement/finalize, 13 tests |
| 2026-05-06 | `npm test games/poker/agent/__tests__/bot-strategy.test.ts` | Passed | Task 18 rule-based PokerBotStrategy, 2 tests |
| 2026-05-06 | `npm test games/poker/agent/__tests__/response-parser.test.ts` | Passed | Task 19 PokerResponseParser, 4 tests |
| 2026-05-06 | `npm run typecheck` | Passed | Task 20 minimal PokerPlayerContextBuilder compiles |
| 2026-05-06 | `npm test games/poker/memory/__tests__` | Passed | Task 21 EMA + working memory, 5 tests |
| 2026-05-06 | `npm test games/poker/memory` | Passed | Task 22 PokerMemoryModule assembly, 7 tests |
| 2026-05-06 | `npm test tests/lib/core/register-games.test.ts` | Passed | Task 23 poker plugin registration, 1 test |
| 2026-05-06 | `npm test tests/lib/orchestrator` + `npm run typecheck` | Passed | Task 24 action validator + GM/orchestrator compile, 2 tests |
| 2026-05-06 | `npm run infra:up` | Blocked | Docker is not installed on this machine; M3 uses test-local Redis mock instead |
| 2026-05-06 | `npm test tests/integration/bot-match.test.ts` | Passed | Task 25 M3: 6 Bot match completed with mocked Redis, persisted final ranking/events |
| 2026-05-06 | `npm run check` | Passed | Phase 1A gate: lint, typecheck, 36 test files / 98 tests, Next production build |
| 2026-05-06 | `npm test tests/lib/instrument.test.ts` + `npm run typecheck` | Passed | Phase 1B-1 Task 1 game registration instrumentation |
| 2026-05-06 | `npm test tests/api/providers.test.ts` | Passed | Phase 1B-1 Task 2 provider catalog API |
| 2026-05-06 | `npm test tests/api/profiles.test.ts` | Passed | Phase 1B-1 Task 3 profiles CRUD API, 4 tests |
| 2026-05-06 | `npm test tests/api/agents.test.ts tests/api/agent-card-real.test.ts` + `npm run typecheck` | Passed | Phase 1B-1 Task 4 agents CRUD and DB-backed agent cards, 7 tests |
| 2026-05-06 | `npm test tests/api/agent-endpoint-real.test.ts` + `npm run typecheck` | Passed | Phase 1B-1 Task 5 real bot-backed agent endpoint with match token auth |
| 2026-05-06 | `npm test tests/api/matches-create.test.ts` + `npm run typecheck` | Passed | Phase 1B-1 Task 6 matches create/list/detail API, 4 tests |
| 2026-05-06 | `npm test tests/api/matches-tick.test.ts` + `npm run typecheck` | Passed | Phase 1B-1 Task 7 self-triggered tick route |
| 2026-05-06 | `npm test tests/api/matches-stream.test.ts` + `npm run typecheck` | Passed | Phase 1B-1 Task 8 Redis-backed spectator SSE API with mocked subscriber |
| 2026-05-06 | `npm test tests/integration/api-match-e2e.test.ts` | Passed | Phase 1B-1 Task 9 M4 API route-level end-to-end match with mocked Redis |
| 2026-05-06 | `npm run infra:up` | Blocked | Docker is not installed on this machine; real Redis curl/SSE smoke remains blocked locally |
| 2026-05-06 | `npm test tests/api/agent-card.test.ts tests/api/agent-message-stream.test.ts tests/api/agent-endpoint-real.test.ts` | Passed | P0 toy API regressions and P1B real agent endpoint regression after unknown-agent compatibility fix |
| 2026-05-06 | `npm run check` | Passed | Phase 1B-1 gate: lint, typecheck, 46 test files / 122 tests, Next production build |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-2 Task 1 local shadcn-style UI primitives and dependencies |
| 2026-05-06 | `npm test tests/lib/client/keyring.test.ts` + `npm run typecheck` | Passed | Phase 1B-2 Task 2 client API wrapper and localStorage keyring |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-2 Task 3 arena sidebar and global layout |
| 2026-05-06 | `npm run typecheck` + `npm run build` | Passed | Phase 1B-2 Task 4 Lobby server page with match list |
| 2026-05-06 | `npm run typecheck` + `npm run build` | Passed | Phase 1B-2 Task 5 profiles management page with local key actions |
| 2026-05-06 | `npm run typecheck` + `npm run build` | Passed | Phase 1B-2 Task 6 agents management page |
| 2026-05-06 | `npm run typecheck` + `npm run build` | Passed | Phase 1B-2 Task 7 match setup page |
| 2026-05-06 | `npm run check` | Passed | Phase 1B-2 gate: lint, typecheck, 47 test files / 125 tests, Next production build |
| 2026-05-06 | `npm install @floating-ui/react framer-motion` | Passed | Phase 1B-3 Task 1 spectator UI dependencies |
| 2026-05-06 | `npm test tests/store/match-view-store.test.ts` + `npm run typecheck` | Passed | Phase 1B-3 Task 2 spectator match view store |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-3 Task 3 client SSE subscription hook |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-3 Task 4 animated PlayingCard component |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-3 Task 5 floating ThinkingBubble component |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-3 Task 6 PlayerSeat component |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-3 Task 7 CommunityCards and Pot components |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-3 Task 8 PokerBoard six-seat oval layout |
| 2026-05-06 | `npm run typecheck` + `npm run build` | Passed | Phase 1B-3 Task 9 spectator route and SSE-integrated client view |
| 2026-05-06 | `npm run check` | Passed | Phase 1B-3 gate: lint, typecheck, 48 test files / 129 tests, Next production build |
| 2026-05-06 | `npm test tests/store/match-view-store.test.ts` + `npm run typecheck` | Passed | Phase 1B-4 Task 1 chipHistory, errorCount, and settled state in match view store |
| 2026-05-06 | `npm test tests/api/errors-list.test.ts` + `npm run typecheck` | Passed | Phase 1B-4 Task 2 match agent errors query/API |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-4 Task 3 ErrorBadge with Popover and polling |
| 2026-05-06 | `npm test tests/components/LiveScoreboard.test.tsx` + `npm run typecheck` | Passed | Phase 1B-4 Task 4 LiveScoreboard sorted by chips |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-4 Task 5 ChipChart with Recharts |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-4 Task 6 ActionLog and ThinkingLog |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-4 Task 7 RightPanel with Tabs integrated into SpectatorView |
| 2026-05-06 | `npm run typecheck` | Passed | Phase 1B-4 Task 8 RankingPanel on match settlement |
| 2026-05-06 | `npm test tests/store/match-view-store.test.ts` + `npm run typecheck` | Passed | Phase 1B-4 Task 9 settled status for legacy settlement events |
| 2026-05-06 | `npm run lint` + `npm test` + `npm run build` + `npm run doctor` | Passed | Phase 1B-4 automated gate; Docker/Compose are warnings because docker is unavailable locally |
| 2026-05-06 | `npm test lib/agent/tests/llm-stream-parser.test.ts` + `npm run typecheck` | Passed | Phase 1B-5 Task 1 streaming parser for thinking/action tags |
| 2026-05-06 | `npm test lib/agent/tests/llm-runtime.test.ts` + `npm run typecheck` | Passed | Phase 1B-5 Task 2 LLM runtime with mocked AI SDK streamText |
| 2026-05-06 | `npm test tests/api/agent-stream.test.ts tests/api/agent-endpoint-real.test.ts` + `npm run typecheck` | Passed | Phase 1B-5 Task 3 real LLM agent endpoint path, Redis key cache, and bot fallback |
| 2026-05-06 | `npm test tests/lib/client/keyring.test.ts` + `npm run typecheck` | Passed | Phase 1B-5 Task 4 client uploadKeysForMatch and match start integration |
| 2026-05-06 | `npm test tests/lib/a2a-core/client.test.ts tests/lib/orchestrator tests/integration/bot-match.test.ts tests/api/matches-tick.test.ts` + `npm run typecheck` | Passed | Phase 1B-5 Task 5 GM requests agent endpoint through A2A and forwards thinking deltas |
| 2026-05-06 | docs only | Passed | Phase 1B-5 Task 6 M4 manual checklist drafted; real run remains blocked locally by missing Docker / real keys |
| 2026-05-06 | `npm test tests/e2e/m4-smoke.test.ts lib/agent/tests/llm-runtime.test.ts` + `npm run typecheck` | Passed | Phase 1B-5 Task 7 mock-LLM M4 smoke through route handler + GM |
| 2026-05-06 | `npm run check` | Passed | Phase 1B-5 gate: lint, typecheck, 54 test files / 147 tests, Next production build |
| 2026-05-07 | `npm test` | Passed | Phase 2-1 A2A compliance suites (AgentCard skills, JSON-RPC route, SSE status/artifact frames) |
| 2026-05-07 | `npm test` | Passed | Phase 2-2 concurrency + observability (HMAC match tokens, in-process metrics, 2-match isolation e2e, ErrorBadge grouping) |
| 2026-05-07 | `npm test` | Passed | Phase 3-1 werewolf engine (roles/validator/win-condition/phase-machine, 47 engine tests) |
| 2026-05-07 | `npm test` | Passed | Phase 3-2 werewolf agent + three-layer memory |
| 2026-05-07 | `npm test` | Passed | Phase 3-3 moderator context + parser; werewolf plugin registered; GM boundary narration hook; match creation validation |
| 2026-05-07 | `npm test` | Passed | Phase 3-4 werewolf UI (PlayerCard / ModeratorPanel / SpeechBubble / VoteTally / WerewolfBoard / WerewolfResultPanel) + store derivations |
| 2026-05-07 | `npm run check` | Passed | Post-merge gate on main: 85 files / 333 tests, lint + typecheck + Next build |
| 2026-05-07 | `npm test` | Passed | Phase 5-1 replay player (replay-store 8 tests, ReplayControls 8 tests incl. drag-no-seek regression, seatSetup-survives-seek regression) |
| 2026-05-07 | `npm run check` | Passed | Phase 5-1 post-merge gate on main: 87 files / 349 tests, Next build includes `/matches/:id/replay` route |
| 2026-05-08 | `npx vitest run tests/redis/adapter.test.ts` | Passed | Phase 5-2 Task 1 Redis adapter factory + Upstash adapter, 4 tests |
| 2026-05-08 | `npm run typecheck` | Passed | Phase 5-2 Task 2/3 (vercel.json + env template + docs) + Empty component wiring |
| 2026-05-08 | `npx vitest run tests/components/Shortcuts.test.tsx` | Passed | Phase 5-2 Task 4 global `?` / `g h` / `n` shortcuts, 4 tests |
| 2026-05-08 | `npx vitest run tests/components tests/games` | Passed | Phase 5-2 Task 5 responsive pass (Sheet-based RightPanel on <lg, PokerBoard mobile stack, WerewolfBoard grid-cols-1); no UI regressions (22 files / 137 tests) |
| 2026-05-08 | `npx vitest run tests/lib/client/toast.test.ts tests/components/ErrorBoundary.test.tsx` | Passed | Phase 5-2 Task 6 zustand toast store + ErrorBoundary, 5 tests |
| 2026-05-08 | `npm run check` | Passed | Phase 5-2 gate: lint + typecheck + 91 files / 362 tests + Next build |
| 2026-05-08 | `npm run build`(本地 standalone 输出) | Passed | Phase 4 Task 1 `.next-build/standalone/server.js` 生成 |
| 2026-05-08 | `docker compose build` on `43.156.230.108` | Passed | Phase 4 Task 2 镜像 `colosseum:prod` 构建(3 stage: deps/builder/runner) |
| 2026-05-08 | `docker compose up -d` + `curl http://43.156.230.108/api/health` | Passed | Phase 4 Task 3+5:栈起,Caddy :80,`{"ok":true,"db":"ok","redis":"ok"}` |
| 2026-05-08 | `/opt/colosseum/scripts/backup.sh` + `/etc/cron.d/colosseum-backup` | Passed | Phase 4 Task 4 SQLite `.backup` 生成 `arena-YYYY-MM-DD-HHMM.db.gz`,cron 就位 |
| 2026-06-05 | `npm test` | Passed | 德扑修复 + deploy entrypoint 回归：98 files / 399 tests |
| 2026-06-05 | `npm run lint` + `npm run typecheck` | Passed | ESLint ignores `.remember/**`; typecheck 单独跑通过 |
| 2026-06-05 | `BASE_URL=http://localhost:3000 DB_DRIVER=sqlite SQLITE_PATH=./data/colosseum.db REDIS_URL=redis://localhost:6379 npm run build` | Passed | Next build 通过；仍有 Next ESLint plugin 提示和 Node `url.parse()` deprecation warning |
| 2026-06-05 | `docker compose up -d --build` on `43.156.230.108` | Passed | 生产镜像重建并启动；Next build 通过，仍有 Next ESLint plugin warning；`nextjs` / `redis` / `caddy` 均 Up |
| 2026-06-05 | `curl http://43.156.230.108/api/health` + page/API smoke | Passed | `/api/health` 返回 `{"ok":true,"db":"ok","redis":"ok"}`；`/`、`/agents`、`/profiles`、`/matches/new`、`/api/providers`、`/api/agents?gameType=poker` 均 200 |
| 2026-06-05 | Production poker smoke `match_08cca9c3-55b8-446f-8071-09e4219ffb6e` | Passed | 创建 6-agent poker match、调用 finish-after-hand 后 completed；SQLite 事件含 `poker/state` 3719、`poker/stop-requested` 1、`poker/match-end` 1；latest state 含 hand/communityCards/holeCards/dealer/SB/BB/pot/streetPots/sidePots |
| 2026-06-05 | `npx vitest run tests/deploy/entrypoint-line-endings.test.ts` | Passed | 回归测试确认 `ops/deploy/entrypoint.sh` 使用 LF，防止 Alpine shebang 失败 |
| 2026-06-05 | Server-only validation via `docker run --rm -v /opt/colosseum:/app -w /app node:22-alpine ...` on `43.156.230.108` | Passed | 服务器 Docker 环境通过 `npm run lint`、`npm run typecheck`、`npm test`(97 files / 398 tests)、`npm run build`；build 仍有 Next ESLint plugin warning 和 npm update notice |
| 2026-06-05 | Production data cleanup on `43.156.230.108` | Passed | 先备份 SQLite 到 `/var/backups/colosseum/pre-clean-20260605-192227.db.gz`，再清空对局/事件/错误/记忆表并 `FLUSHDB` Redis；验证 `agents=6`、`matches=0`、`game_events=0`、`agent_errors=0`、Redis `0` |
| 2026-06-05 | `docker compose up -d` + `curl http://127.0.0.1/api/health` on server | Passed | 重启后 `{"ok":true,"db":"ok","redis":"ok"}`；`nextjs` / `redis` / `caddy` 均 Up；`/api/agents?gameType=poker` 仍有 6 个 agent，`/api/matches` 返回 `[]` |
| 2026-06-05 | Red/green on server: `npx vitest run games/poker/engine/__tests__/poker-engine.test.ts` | Passed | 先确认新增 endless-table rebuy 回归失败，再修复后 17 tests passed |
| 2026-06-05 | Red/green on server: `npx vitest run tests/integration/bot-match.test.ts` | Passed | 先确认异步 stop flag 回归失败，再修复后 3 tests passed |
| 2026-06-05 | Production poker smoke `match_66de66df-813f-4d51-85a5-a43bd3be5e61` | Passed | 未请求结束时推进到第 2 手且仍 running；请求 finish-after-hand 后 completed，最终 public events=50 |
| 2026-06-05 | Server-only full gate via Docker on `43.156.230.108` | Passed | `npm run lint`、`npm run typecheck`、`npm test`(97 files / 400 tests)、`npm run build` 全通过；仍有 Radix Dialog Description warning、Next ESLint plugin warning 和 npm update notice |
| 2026-06-05 | Production pre-launch cleanup + restart | Passed | 备份 `/var/backups/colosseum/pre-launch-20260605-210821.db.gz`；清空对局/事件/错误/记忆，保留 `api_profiles=1`、`agents=6`；Redis `DBSIZE=0`；健康检查 `{"ok":true,"db":"ok","redis":"ok"}` |
| 2026-06-05 | Red/green on server: `npx vitest run games/poker/engine/__tests__/poker-engine.test.ts` | Passed | 先确认“只剩一名有筹码玩家时应结束而非 rebuy”的回归在生产工作树失败，再修复后 17 tests passed；随后按用户要求删除旧测试体系 |
| 2026-06-05 | Server-only core gate via Docker on `43.156.230.108` | Passed | 测试体系清理后通过 `npm run lint`、`npm run typecheck`、`npm run build`；build 仍有 Next ESLint plugin warning 和 npm update notice |
| 2026-06-05 | `docker compose -f ops/deploy/docker-compose.yml up -d --build` on `43.156.230.108` | Passed | 镜像 `colosseum:prod` 重建，`nextjs` 新容器启动，`/api/health` 返回 `{"ok":true,"db":"ok","redis":"ok"}` |
| 2026-06-05 | Production frontend smoke | Passed | `/` HTML 不再包含侧栏 `Launch table` 新对局导航；侧栏状态更新为“正式上线”；RSC payload 中文本会重复出现，不用于可见按钮数精确判断 |
| 2026-06-05 | Production poker elimination smoke `match_1cc5c78d-b54d-4179-b642-803ea1d215c4` | Passed | 低筹码德扑推进到第 74 手：4 个 `eliminated` 玩家均 `chips=0` 且 `holeCards=[]`，剩 2 名有筹码玩家继续运行，验证破产玩家未 rebuy |
| 2026-06-05 | Production final cleanup + restart | Passed | 备份 `/var/backups/colosseum/pre-final-launch-20260605-215416.db.gz`；清空对局/事件/错误/记忆，保留 `api_profiles=1`、`agents=6`；Redis `DBSIZE=0`；`/api/matches` 返回 `[]` |
| 2026-06-13 | Frontend performance fix + gate | Passed | Split thinking store, optimized player reference updates in `ingestEvent`, memoized PlayerSeat/PlayingCard/Pot/CommunityCards/PlayerCard/ThinkingBubble, fixed Framer Motion remount keys, batched thinking deltas on client/server, limited ActionLog/ThinkingLog rendering, capped spectator SSR events to 100, optimized `nextSeq` with MAX aggregate, added SSE exponential backoff. `npm run lint` + `npm run typecheck` + `npm run build` passed. |
| 2026-06-13 | Deployment skill + archive stale docs | Passed | Created `.kimi-code/skills/deployment/SKILL.md`; moved `docs/superpowers/plans/2026-05-06-phase-4-deployment.md`, `docs/ai/phase-6-server-verify-plan.md`, `docs/superpowers/notes/phase-0-complete.md`, and 4 `docs/demo/*` checklists into `old/docs-archive/`; added `old/docs-archive/README.md`; updated `AGENTS.md` with deployment section. `npm run lint` + `npm run typecheck` + `npm run build` passed. |
| 2026-06-13 | `npm run doctor` + `npm run check` | Passed | `sync` skipped because working tree is dirty; `doctor` passed. `check` passed after adding ESLint ignore for `**/.pytest_cache/**`: lint, typecheck, Next production build. Build still reports existing Next ESLint plugin warning and Node `url.parse()` deprecation warnings. |
| 2026-06-13 | `npm run lint` + `npm run typecheck` + `npm run check` | Passed | Frontend polish gate passed. Build route sizes stayed stable (`/matches/[matchId]` first load 316 kB). Existing Next ESLint plugin warning and Node `url.parse()` deprecation warnings remain. |
| 2026-06-13 | Production deploy via SSH key + Docker Compose | Passed | `docker compose up -d --build nextjs` succeeded on `43.156.230.108`; `/api/health` returned `{"ok":true,"db":"ok","redis":"ok"}`; `/`, `/agents`, `/matches/new`, `/api/providers`, and `/api/agents?gameType=poker` returned 200. Backup script attempt returned `Permission denied`. |
| 2026-06-13 | Project structure refactor gate | Passed | `npm run lint` + `npm run typecheck` + `npm run build` passed after moving source into `src/{app,frontend,backend,platform,games}` and archive into `archive/old/`. Local Docker unavailable so `npm run infra:up` / full poker UI smoke skipped; will verify on production after merge. |
| 2026-06-13 | Match spectator UI polish gate | Passed | `npm run lint` + `npm run typecheck` + `npm run build` passed. Deployed to production; `/api/health` OK; `/`, `/matches/new`, `/api/agents?gameType=poker` 200. Full poker match UI smoke will be verified live. |
| 2026-06-14 | UI/impressions gate | Passed | `npm run typecheck`, `npm run lint`, `npm run build`, and placeholder `npm test` ran. Build included `/api/matches/[matchId]/impressions`; existing Next ESLint plugin warning and Node `url.parse()` deprecation warnings remain. In-app Browser local visual check was blocked by browser security policy for `127.0.0.1:3000`; command-line local dev server requests also hung, so no browser screenshot was captured. |
| 2026-06-14 | Fixed-height match layout gate | Passed | `npm run typecheck`, `npm run lint`, `npm run build`, and placeholder `npm test` ran. Match and loading pages now use fixed `100dvh` shells with page-level overflow hidden; PokerBoard scales inside remaining height via container query units. Existing Next ESLint plugin warning and Node `url.parse()` deprecation warnings remain. |
| 2026-06-14 | Thinking bubble anchor gate | Passed | `npm run typecheck`, `npm run lint`, `npm run build`, and placeholder `npm test` ran. ThinkingBubble no longer uses FloatingPortal/fixed viewport coordinates; it is locally anchored to PlayerSeat, and current thinkers show a spinner label above the seat. Existing Next ESLint plugin warning and Node `url.parse()` deprecation warnings remain. |
| 2026-06-14 | Agent error debug panel gate | Passed | `npm run typecheck`, `npm run lint`, `npm run build`, and placeholder `npm test` ran. `/api/matches/:id/errors` now includes agentName and recoveryAction; ErrorBadge popover shows Chinese error causes, layer labels, agent name/id, timestamp, recovery action JSON, and raw response snippets. Existing Next ESLint plugin warning and Node `url.parse()` deprecation warnings remain. |
| 2026-06-14 | AI IDE deployment workflow sync gate | Passed | Synced Kimi deployment Skill routing into Cursor/Claude commands and rule routers; updated AGENTS and docs/ai/rules README. Verified Cursor/Claude deploy command bodies match and deployment routes are discoverable with rg; `npm run lint` passed. |
| 2026-06-14 | Thinking bubble overlap/expiry gate | Passed | Added targeted Vitest coverage for seat-based bubble placement and stale thinking expiry; `npm run typecheck`, `npm run lint`, and `npm run build` passed. Local browser visual smoke could not be completed because background Next dev processes are reclaimed by the desktop sandbox before `127.0.0.1:3000` becomes reachable. Existing Next ESLint plugin warning and Node `url.parse()` deprecation warnings remain. |

## Open Questions / Blockers

- Phase 4 Task 6 (M7 生产烟测 checklist) 已完成服务器部署和 API/DB/replay 冒烟；仍建议用户真机配置 MiniMax/MiMo profile + agent 跑一局带真实 key 的 poker 或 werewolf，覆盖浏览器 localStorage keyring 上传路径。
- Phase 5-2 Task 7 (M8 Vercel fallback 烟测) 挂起,等用户拿到 Vercel 账号;Supabase / Upstash 实际联通仅能在有账号时做。
- 域名审核未通过 — 生产仍用 `http://43.156.230.108` 裸 IP;域名通过后在 `ops/deploy/Caddyfile` 取消 `your-domain.com { … }` 块注释,Caddy 会自动申请 TLS。
- 旧 `poker-arena` 容器仍在服务器上占 `:3000`,不影响 Colosseum(用 `:80`);需要时可 `docker rm -f poker-arena-poker-arena-1 && docker rmi poker-arena-poker-arena` 清理。
- Phase 1B-4 / 3-3 M6 manual 6-bot Redis/Docker E2E 已在生产 poker 路径部分覆盖；werewolf 真 LLM/manual 仍可后续补跑。
- Real M1 LLM curl was not run because no real `TEST_LLM_*` key was used; mocked SSE path is verified.
- Default system moderator seed (`db/seeds/default-moderator.ts`) still deferred — 服务器首次运行时 `matches` / `agents` 表空,创建 werewolf match 前需先手动建一个 moderator agent(通过 UI)。
- in-app Browser verification remains unavailable in this environment: Browser plugin returns `Browser is not available: iab`; production UI was verified with HTTP responses and server-side event payload checks instead.
- 2026-06-13 deploy note: `ops/private/puke.pem` / `ops/private/deploy.env` are still absent and `rsync` is unavailable locally, but deployment works with `C:/Users/Qoobeewang/Downloads/hermesqoobee.pem` after copying to a temporary ACL-restricted key. The temporary local key copy was removed after deployment.
- 2026-06-13 ops follow-up: `/opt/colosseum/scripts/backup.sh` on production returned `Permission denied` when invoked as part of deployment. Check executable bit / mount permissions before the next release.
- 2026-06-13 项目结构重组完成：源码迁入 `src/{app,frontend,backend,platform,games}`，归档整合到 `archive/old/`，`tsconfig.json` paths 改为 `@/*` → `./src/*`，`ops/deploy/Dockerfile` 同步复制 `src/platform/db/` 与 `src/platform/env.ts`；纲领文档 `AGENTS.md`、`docs/ai/rules/project-context.md`、`docs/ai/rules/frontend-backend.md`、`.kimi-code/skills/deployment/SKILL.md`、`README.md`、`.cursor/.claude rules` 已更新。
- 2026-06-13 对局 UI 优化完成：`/matches/*` 内左侧 Sidebar 收起为图标栏，底部文案改为用户视角平台介绍；思考气泡 4.5s 自动消失；右侧“思考”Tab 按手牌历史记录并结构化展示；“行动”Tab 按手牌分组并用中文描述决策；牌桌 `max-width` 扩至 `max-w-7xl`。
- 2026-06-13 对局 UI 第二轮打磨完成：思考气泡改用 `FloatingPortal` + fixed 定位避免撑出滚动条；行动/思考 Tab 改为升序排列并美化滚动条与 sticky header；结算弹窗 delta 从 `poker/state` 读取实际 `startingChips`；`chipHistory` 每手去重并兜底记录；筹码走势改用 Area+Line、带起始筹码参考线、点击放大 Dialog。
- 2026-06-13 UI/引擎/错误修复：气泡修复 `flip`+`autoPlacement` 冲突、增加 `whileElementsMounted:autoUpdate`、牌桌加 `overflow-hidden`；`ActionLog`/`ThinkingLog` 拆出固定“当前区”与可折叠历史区；德扑引擎移除破产 reload 改为淘汰制， settlement 后清零 pot/streetPots/sidePots，只剩一名有筹码玩家时自然结束；Agent endpoint 接入 `PokerResponseParser`，prompt 修正 `raise` 用 `toAmount`，`action-validator` 增加 `bet↔raise`/`check↔call` 容错；keyring TTL 从 2h 延长到 24h。`npm run lint` + `npm run typecheck` + `npm run build` 通过，并用临时 `tsx` 脚本验证引擎淘汰逻辑；已合并到 `main` 并部署到 `http://43.156.230.108`，`/api/health` OK。
- 2026-06-14 新增印象系统：每手牌结束时 `game-master` 为每位观察者生成对其他选手的 episodic / semantic memory；新增 `/api/matches/[matchId]/impressions` 与 `ImpressionsPanel`；德扑 memory 合成维度（松紧、进攻、粘性、诚实）。UI 同步调整 `SpectatorView` / `PokerBoard` / `CommunityCards` / `Pot` / `PlayerSeat`。已再次通过 `lint/typecheck/build` 并部署到 `43.156.230.108`。
- 2026-06-14 对局 UI/印象系统修复完成：德扑座位移入牌桌容器内并用 `clamp` 缩放，ThinkingBubble 以座位卡片为 anchor 并按座位方位选择 placement；右侧栏 tab/行动展开/思考展开状态迁入 match store，切换 tab/移动端 Sheet 不再丢状态；进入新对局会 reset thinking store，match-end 会 finalize 剩余 current thinking；新增 `/api/matches/:id/impressions` 与右侧“印象”Tab；德扑 hand-end 会从 `actionHistory` 生成 episodic 并更新 semantic memory，印象 Tab 可展示 observer→target 的长期画像。
- 2026-06-14 对局固定视口布局修复完成：`SpectatorView` poker/werewolf 分支和 match loading skeleton 改为 `100dvh` 固定高度、页面级 `overflow-hidden`；主赛场使用 flex 剩余高度，PokerBoard 桌面端用容器查询单位 `100cqw/100cqh` 等比缩放，避免顶部/底部座位被标题或视口遮盖；移动/平板牌桌改成紧凑公共牌、底池和 2 列座位网格；RightPanel 改为跟随父容器 `h-full`。
- 2026-06-14 思考气泡锚点修复完成：移除 `ThinkingBubble` 的 `FloatingPortal/useFloating/fixed` 定位，改为 `PlayerSeat` 内局部 absolute 定位，避免在缩放牌桌/动画座位下 reference 丢失后跑到视口左上角；当前正在思考的选手座位上方新增 `LoaderCircle` 旋转“思考中”状态，气泡继续展示最近思考文本。
- 2026-06-14 Agent 错误展示优化完成：`/api/matches/:id/errors` 返回 `agentName` 和 `recoveryAction`；`ErrorBadge` 从“errorCode × count + agentId”改成调试面板，显示中文错误原因/排查提示、错误层级、Agent 名称与 id、发生时间、兜底恢复动作 JSON、原始响应片段，方便定位 `llm-parse_fail` 等问题。
- 2026-06-14 AI IDE 部署流程同步完成：新增 `.cursor/.claude` 的 `deploy-production` 命令与 `deployment-router`，均回读 `.kimi-code/skills/deployment/SKILL.md` 作为权威部署流程；`AGENTS.md` 与 `docs/ai/rules/README.md` 已补充部署/运维路由信息。
- 2026-06-14 思考气泡重叠/过期修复完成：新增 `thinking-bubble-layout` 统一座位方位，底部左右座位气泡改为贴座位上方 start/end 对齐，移动端气泡宽度收窄；`PlayerSeat` 在 thinking 清空时立刻收起旧气泡，`thinking-store` 新增 `expireStaleThinking` 兜底把超时 current 归档到 history，`SpectatorView` 每秒清理超过 7s 的 stale thinking 并处理 `agent-action-ready`。

## SDK / Plan Drift Notes

- `next lint` is deprecated and failed with ESLint 10 option errors. Project now uses `eslint .` with `eslint.config.mjs`.
- Test code should use `vi.stubEnv('NODE_ENV', 'test')`; assigning `process.env.NODE_ENV` directly fails typecheck because it is readonly.
- ~~`@ai-sdk/openai-compatible` / `@ai-sdk/anthropic` currently return provider v3 model types while `ai@5` exposes a v2 `LanguageModel` type.~~ **Resolved 2026-05-08**:downgraded `@ai-sdk/openai-compatible` to `^1.0.39` 和 `@ai-sdk/anthropic` 到 `^2.0.79`(两者都 pin `@ai-sdk/provider@2.x`,和 `ai@5` 匹配)。不要在没同时升 `ai` 到 6 的情况下 bump 这两个 provider 到 v2/v3。`lib/llm/provider-factory.ts` 的 `as unknown` 胶水代码已删除。

## Resume Checklist

1. Read `AGENTS.md`.
2. Read this file.
3. Read the active plan and find the first unchecked checkbox.
4. Read the spec sections referenced by that task.
5. Implement one task, run validation, then update this file.
