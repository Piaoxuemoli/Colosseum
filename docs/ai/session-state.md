# AI Session State

> 给长任务恢复用。每次完成一个 plan task、遇到阻塞、或发现 SDK/API 漂移后更新。不要记录密钥、cookie、token 或个人隐私。

## Active Context

- Active spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md`
- Brief spec: `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md`
- Active plan set: `docs/superpowers/plans/2026-05-06-phase-1a-*.md`
- Current phase: Phase 1A — poker engine and GM foundation
- Current task: Phase 1A-4 complete; next Phase 1A-5 Task 18

## Last Known Status

- Phase 0 is merged to `main` and pushed. Tag `phase-0` exists remotely.
- Node was switched to `v24.12.0` via nvm; this satisfies `.nvmrc` / `npm run doctor`.
- Phase 0 quality gate passed: `npm run check` passed with lint, typecheck, 14 test files / 28 tests, and Next production build.
- Production smoke used port 3001 because local port 3000 was occupied; toy agent card and toy message stream worked.
- Next build output is `.next-build` because an old `.next/trace` file on this Windows machine has abnormal ACL/lock and cannot be removed by the current user.
- `old/` remains reference-only; do not edit it unless explicitly requested.
- Independent development mode: do not create or suggest PR / MR; all merges are local.

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

## Open Questions / Blockers

- Docker is not installed on this machine, so container-backed Postgres/Redis checks remain blocked locally.
- Real M1 LLM curl was not run because no real `TEST_LLM_*` key was used; mocked SSE path is verified.

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
