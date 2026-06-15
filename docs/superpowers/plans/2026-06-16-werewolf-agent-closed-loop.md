# Werewolf Agent 闭环 — 分层实施 Plan

- Spec：`docs/superpowers/specs/2026-06-16-werewolf-agent-closed-loop-design.md`
- 分支：`feature/werewolf-agent-loop`

## Goal
用 mock 驱动真实 agent 层跑通 6 人狼人杀整局到终局，修暴露的死角色阶段 bug，零前端/视觉验收，最小闭环即交付。

## Architecture summary
引擎纯函数闭环：`createInitialState → (currentActor → availableActions → ctxBuilder.build → mockLlmDecide → parser.parse → applyAction[bot 回退])× → finalize`。tsx 运行 `.ts` 脚本，tsconfig `@/*` 别名原生解析。

## Tech stack / dependencies
- 新增 devDep：`tsx`（单独提交 package.json + lock）。
- 复用：`werewolfEngine` / `WerewolfPlayerContextBuilder` / `WerewolfResponseParser` / `WerewolfBotStrategy` / `MemoryContextSnapshot`。

## Layers（分层计划）
- **Layer 0 — 调研**（已完成，见 spec §2）：字节/论文设计思想提炼，确认不重复造轮子。
- **Layer 1 — mock 闭环测试脚手架**（本 plan 主交付）：tsx 脚本 + `check:werewolf` + 并入 `check`。
- **Layer 2 — 修 bug**：死角色阶段跳过（D5）；女巫 bot 救药策略优化（可选，见风险）。
- **Layer 3 — 全链路 runtime mock（不交付）**：werewolf-aware `M4_MOCK_LLM` + GM/Redis 跑通。仅记录，超出最小闭环。

## Files
- `tsconfig.json`（补排除，D6）
- `package.json` + `package-lock.json`（加 tsx + `check:werewolf`，D2/D7）
- `scripts/werewolf/run-closed-loop.ts`（新建，Layer 1）
- `src/games/werewolf/engine/phase-machine.ts`（修死角色跳过，D5，Layer 2）
- `src/games/werewolf/agent/bot-strategy.ts`（女巫救药策略优化，可选 Layer 2）
- `docs/ai/session-state.md`、`memory/`（落盘）

## Task steps
- [x] T0: 调研完成（spec §2）
- [x] T1: spec + 本 plan 写就并提交
- [ ] T2: 补 tsconfig 排除（`.next-build`、`*.test.ts`/`*.test.tsx`/`__tests__`）—— D6
- [ ] T3: 加 devDep `tsx` + `check:werewolf` 脚本 + 并入 `check`（单独提交）—— D2/D7
- [ ] T4: 冒烟：`tsx` 能 import `werewolfEngine`（验证 `@/*` 别名解析）
- [ ] T5: 写 `run-closed-loop.ts`：mock LLM（D3）+ 主循环 + D4 断言 + 多种子
- [ ] T6: 跑 `npm run check:werewolf`，捕获死角色 bug（预期复现）
- [ ] T7: 修 `phase-machine` 死角色阶段跳过（D5）；重跑直到多局全绿
- [ ] T8:（可选）女巫 bot 救药策略优化；重跑
- [ ] T9: 跑 `npm run lint && npm run typecheck && npm run build`，确保无回归；修 lint/console（脚本顶 `eslint-disable no-console`）
- [ ] T10: 更新 session-state + MEMORY；commit；最终交付报告

## Validation commands
```bash
npx tsx scripts/werewolf/run-closed-loop.ts   # 或 npm run check:werewolf
npm run lint
npm run typecheck
npm run build
npm run check                                  # 含 check:werewolf
```

## Done definition
- `check:werewolf` 多（≥12）局全绿，终局分布非 100% 单边；
- `npm run check` 全绿；
- 死角色 bug 已修且 tsconfig 排除已补；
- session-state / MEMORY 更新；给出验证方案报告 → 结束。

## SDK drift notes
- 无 SDK 漂移。引擎纯 TS，无外部 SDK 新增。tsx 为标准 devDep。
