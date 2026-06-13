# Phase 3 M6 · Werewolf Engine + Agent + GM

Use this checklist to verify Phase 3-1 / 3-2 / 3-3 end-to-end before moving to Phase 3-4 (Werewolf UI).

## 引擎 (Phase 3-1)

- [ ] `npx vitest run tests/games/werewolf/engine` 全绿（含 roles / validator / win-condition / phase-machine / werewolf-engine）
- [ ] `werewolfEngine.createInitialState` 使用 seed 时可复现相同 role 分配
- [ ] 阶段机完整走一遍：`night/werewolfDiscussion → night/werewolfKill → night/seerCheck → night/witchAction → day/announce → day/speak → day/vote → day/execute → 回到 night`
- [ ] 胜负判定：狼全死 → villagers；村民 ≤ 狼 → werewolves；40 天未分胜负 → tie
- [ ] 合法性：首夜女巫不能自救；预言家不能验自己

## Agent / 记忆 (Phase 3-2)

- [ ] `npx vitest run tests/games/werewolf/agent tests/games/werewolf/memory` 全绿
- [ ] `WerewolfPlayerContextBuilder`：狼能看到同伙身份；预言家能看到自己的查验历史；村民看到的 private evidence 是空列表
- [ ] `WerewolfResponseParser`：同时能提取 `<thinking>` / `<belief>` / `<action>`；缺 tag 时回落到整段文本 slice
- [ ] `WerewolfBotStrategy`：在 6 个 phase 分支都能给出 fallback action，且动作通过 validator
- [ ] 记忆闭环：对局结束后 `settleMatch` 触发
  - working memory 删除（sanity query）
  - episodic 每个观察者一条（`beliefAccuracy` / `confidenceCalibration` 数值合法）
  - semantic 每位对手一条，`gamesObserved` 递增

## Moderator + Plugin + GM (Phase 3-3)

- [ ] `npx vitest run tests/games/werewolf/agent/moderator.test.ts` 全绿
- [ ] `npx vitest run tests/games/werewolf/plugin.test.ts` 全绿（plugin shape + registry 注入）
- [ ] `npx vitest run tests/orchestrator/werewolf-hooks.test.ts tests/orchestrator/match-lifecycle-validation.test.ts` 全绿
- [ ] `npx vitest run tests/api/matches-create-werewolf.test.ts` 全绿
- [ ] Moderator Context：system message 含"不参与决策"+"80 字"
- [ ] `parseModeratorResponse`：缺 `<narration>` 标签时 `error='narration-tag-missing'` 且 narration 长度 ≤ 80；过长时 `error='too-long'` 且 ≤ 120
- [ ] Event visibility：`werewolf/werewolfKill` 仅对 werewolfIds 可见；`werewolf/seerCheck` 仅对 actor 可见；`werewolf/speak`、`werewolf/moderator-narrate` 公开
- [ ] GM 在 werewolf 阶段切换时追加一条 `werewolf/moderator-narrate` public 事件（看 `/api/matches/:id/stream` SSE）

## Match 创建校验

- [ ] POST `/api/matches` with `gameType=werewolf` 少于或多于 6 个 agent → 400
- [ ] POST 无 `moderatorAgentId` → 400 且 message 含 "moderator"
- [ ] POST 将 moderator 同时放进 agentIds → 400
- [ ] POST 合法 6 玩家 + 1 moderator → 201，`matchId` 形如 `match_*`
- [ ] 创建后 `match.state` 包含 moderatorAgentId（Redis 里反序列化确认）

## 端到端手测（最小）

1. Seed 6 个 werewolf 玩家 agent（任意 profile）+ 1 个 moderator（`kind='moderator'`）
2. `curl -X POST http://localhost:3000/api/matches -d '{"gameType":"werewolf","agentIds":["a1",...,"a6"],"moderatorAgentId":"m1"}'`
3. `curl http://localhost:3000/api/matches/:id/stream` 订阅，观察：
   - 首个事件 `werewolf/match-start`
   - 接下来逐步出现 `werewolf/werewolfKill` / `werewolf/seerCheck` / `werewolf/witchSave | witchPoison` / `werewolf/speak` / `werewolf/vote`
   - 阶段切换处夹一条 `werewolf/moderator-narrate`（payload 含 `upcomingPhase` + `narration`）
4. 对局自然结束（≤40 天）→ `match.winnerFaction` ∈ `{werewolves, villagers, tie}`

## Lint / Typecheck

- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npx vitest run` 全绿

## 已知延后项（Phase 4+）

- 默认 SystemJudge seed 脚本（`db/seeds/default-moderator.ts`）— 等到 Phase 4 部署时和 api_profiles seed 一起搞
- 真正走 LLM 的 moderator 决策链（目前用 canned 80-char 话术）
- Werewolf UI（Phase 3-4）
