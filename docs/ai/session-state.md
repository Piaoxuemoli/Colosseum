# AI Session State

> 给长任务恢复用。每次完成一个 plan task、遇到阻塞、或发现 SDK/API 漂移后更新。不要记录密钥、cookie、token 或个人隐私。

## Active Context

- Active spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`
- Brief spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`
- Active plan set: Phase 5-2 (Vercel fallback + polish) up next — `docs/superpowers/plans/2026-05-06-phase-5-2-vercel-polish.md`
- Current phase: Phase 5-1 closed (replay player merged to main)
- Current task: — (Phase 5-2 not yet started)

## Last Known Status

- Phase 0 is merged to `main` and pushed. Tag `phase-0` exists remotely.
- Phase 1A is merged to `main` and pushed. Tag `phase-1a` exists remotely.
- Phase 1B is merged to `main` and pushed.
- Phases 2-1, 2-2, 3-1, 3-2, 3-3, 3-4 merged to `main` (merge commit `7acea7a`).
- Phase 5-1 (replay) merged to `main` (merge commit `6300b61`) and pushed.
- `npm run check` green on main: lint, typecheck, 87 test files / 349 tests, Next production build (includes new `/matches/:id/replay` route).
- Docker still unavailable locally; Phase 4 deploy + any real Redis/Postgres smoke must happen on a box with Docker.

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

## Open Questions / Blockers

- Docker is not installed on this machine — Phase 4 (Docker Compose + Caddy + Postgres 生产部署) cannot be executed locally; it must run on a box with Docker or against the target VPS `43.156.230.108`.
- Phase 1B-4 / 3-3 M6 manual 6-bot Redis/Docker E2E still deferred pending Docker.
- Real M1 LLM curl was not run because no real `TEST_LLM_*` key was used; mocked SSE path is verified.
- Default system moderator seed (`db/seeds/default-moderator.ts`) was deferred from Phase 3-3 Task 4 — fold into Phase 4 seeding step.

## SDK / Plan Drift Notes

- `next lint` is deprecated and failed with ESLint 10 option errors. Project now uses `eslint .` with `eslint.config.mjs`.
- Test code should use `vi.stubEnv('NODE_ENV', 'test')`; assigning `process.env.NODE_ENV` directly fails typecheck because it is readonly.
- `@ai-sdk/openai-compatible` / `@ai-sdk/anthropic` currently return provider v3 model types while `ai@5` exposes a v2 `LanguageModel` type. `lib/llm/provider-factory.ts` centralizes the temporary `unknown` bridge until dependencies are aligned.

## Resume Checklist

1. Read `AGENTS.md`.
2. Read this file.
3. Read the active plan and find the first unchecked checkbox.
4. Read the spec sections referenced by that task.
5. Implement one task, run validation, then update this file.
