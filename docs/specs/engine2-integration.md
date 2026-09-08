# 引擎 v2 平台接入规格（Engine2 Integration Spec）

- 日期：2026-09-09　状态：已定稿（实施依据，冲突以本文为准）
- 上游需求：`docs/prd/games/poker-engine.md`（PFR-3xx/4xx/5xx）、`docs/prd/games/werewolf-engine.md`（WFR-2xx/5xx）
- 实现物：`src/games/{poker,werewolf}/engine2/`（已完成，纯逻辑）
- 本文钉死：GM 驱动方式、事件落库/广播信封、agent 消息契约、前端投影契约、生命周期映射、清理清单

## 1. 接入原则

1. **v2 是唯一运行时**：`game-master.ts` 重写为只驱动 v2 插件面（旧引擎/旧 GM 分支随清理任务删除）。生产上遗留的旧格式运行中对局会被 force-end 兜底（`/api/matches/:id/force-end` 不依赖 state 形状）。
2. **红线治理**：GM 内不得有任何 `gameType === 'xxx'` 分支；跨游戏差异全部收敛进各游戏的 v2 插件面（`games/*/integration/plugin-v2.ts`）。扑克印象/狼人旁白等游戏专属钩子由插件面提供。
3. **受众模型贯通**：engine2 事件的 audience 是唯一可见性真相。落库全量、SSE 全量带 audience、前端按视角过滤；**agent 决策上下文只允许由 `visibleEvents(all, playerId)` 重建**（修掉审计 24 泄露的根因）。

## 2. GameModuleV2 插件面（platform/engine/contracts-v2.ts 新建）

每个游戏提供（全部同步纯函数，IO 归 GM）：

```ts
interface GameModuleV2<TState, TAction> {
  gameType: GameType
  createMatch(config: unknown, agentIds: string[], seed?: string): { state: TState; events: V2Event[] } | { rejection: StructuredRejection }
  classify(state: TState): { kind: 'awaiting-action'; actorAgentId: string } | { kind: 'finished'; result: MatchResult }
  legalActions(state: TState, actorAgentId: string): ActionSpec<TAction>[]          // 引擎 legalActionSet 包装
  decisionContext(state: TState, actorAgentId: string): Record<string, unknown>      // PFR-501/WFR 机械量
  normalizeAction(raw: unknown, state, actor): { ok: true; action: TAction } | { ok: false; rejection }   // 引擎 normalize + LLM 别名容错
  applyAction(state: TState, actorAgentId, action): { ok: true; state; events } | { ok: false; rejection }
  applyDefaultAction(state: TState): { ok: true; state; events } | { ok: false }      // 兜底/超时驱动
  requestStopAfterCurrentHand(state): TState                                          // 仅德扑有意义；狼人杀返回原 state
  terminateImmediately(state): { state: TState; events: V2Event[] }                   // 强制终局 + 排名
  onEventsBatch(state, events): void        // 游戏专属钩子：扑克 hand-ended → 印象合成信号；狼人杀无需
}
```

- 类型经判别联合消除现存 `as unknown as` 插件双重断言（审计 12 的接入侧部分）。
- registry 注册：`registerGameV2(module)`；`createAndStartMatch` 一律走 v2。

## 3. 事件信封（落库与 SSE）

- engine2 事件（权威 kind 联合：`src/games/poker/engine2/events.ts` 16 种 / `src/games/werewolf/engine2/types.ts` 26 种）持久化为现有 `game_events` 行：
  - `kind = \`${gameType}:v2:${engine2Kind}\``（如 `poker:v2:deck-shuffled`、`werewolf:v2:announce-deaths`）
  - `visibility`：audience 为 `public` → `public`；否则 `restricted`
  - `restrictedTo`：audience 原样字符串（`wolves` / `role-self:<agentId>` / `moderator` / `self:<seatId>` / `delayed-public`）
  - `payload`：{ ...engine2Event }（含 audience 字段本体）
  - `seq`：沿用引擎事件序（engine2 保证单调）；GM 不再自造 seq:0 事件
- SSE `event` 帧全量广播（含 restricted），payload 保留 audience——**单用户私有部署，观战端=所有者，过滤在前端**；agent 端永不消费 SSE。
- `agent/thinking` 持久化事件保留现有形态（handNumber/day/phase 由 GM 从 classify 前状态读 v2 字段），audience=public。

## 4. Agent 决策消息契约（GM → agent endpoint）

`message.parts[0].data` v2 形状（后端为 v2 状态时发送）：

```json
{
  "engineVersion": 2,
  "events": [...visibleEvents(allEvents, actorAgentId) 最近 N 条...],   // 见上：唯一上下文真相
  "legalActions": [...ActionSpec...],
  "decisionContext": {...机械量...},
  "gameInfo": { "gameType": "...", "板子/配置摘要": "..." }
}
```

- agent endpoint（`/api/agents/:id/message/stream`）按 `engineVersion===2` 分流到 `games/*/agent/context-builder-v2`（新文件）：prompt 由可见事件 + 合法动作 JSON 范式 + 机械量构成；响应解析进 `response-parser-v2`，输出交给 `normalizeAction`（GM 侧）容错。
- GM 校验链：`normalizeAction` 失败 → `applyDefaultAction`（记 agent-error + fallback 事件，audience=public 带 `isDefault:true` 标记）——取代旧 botStrategy 三层链的运行时部分。

## 5. GM v2 驱动循环（game-master.ts 重写）

```
tick: lock → load state
  force-end flag → terminateImmediately → 落库/广播 → finalize
  classify:
    finished → result 落 finalRanking → finalize → match-end SSE
    awaiting-action(actor):
      stopRequested → requestStopAfterCurrentHand（状态不变则照常）
      legalActions + decisionContext → requestAgentDecision(v2 消息)
      normalizeAction → applyAction；rejected/无响应/超时 → applyDefaultAction
      事件批量落库 + SSE；onEventsBatch 钩子（印象等）
      Redis 保存 nextState（v2 state JSON 原样）
```

- 移除：`publicStateEvent` / `continueAfterBoundary` / `boundary()` / `werewolf-hooks.moderatorNarrationEvent` 运行时依赖（engine2 的 announce 阶段事件取代旁白 shim；LLM 主持人=R3-3 后续）。
- 印象钩子：`onEventsBatch` 内识别本批 `hand-ended` → 调既有 `memory.synthesizeEpisodic`（poker）；working memory 从 v2 事件流推导（替代旧 actionHistory 读取）。

## 6. 前端投影契约（consumer 侧并行实施依据）

- `match-view-store` 新增 v2 投影分派：`frontend/store/projections/poker-v2.ts` / `werewolf-v2.ts`（新目录，消费第 3 节信封事件），产出与现有 UI 组件（PokerBoard/WerewolfBoard/各面板）兼容的 view model——**视觉重建是独立后续工作，不在本规格**。
- 视角切换（PK-1 已代决：德扑默认上帝视角）：`filterEvents` 语义在前端复刻——public 视角隐藏 audience≠public 且非 delayed-public 已到期 的载荷细节（底牌/夜间动作），god 视角全量；狼人杀观战同样默认上帝视角（终局前身份/死因可见，带视觉区分）。
- 回放：replay-store 复用同一 v2 投影（事件流即真相，engine2 保证可重放）。
- 旧事件 kind（`poker/state`、`werewolf/moderator-narrate` 等）在切换后不再产生；投影对未知 kind 静默忽略（向前兼容）。

## 7. 生命周期映射

| 旧入口 | v2 行为 |
|---|---|
| `POST /api/matches` | registry v2 创建；match.config 记 `engineVersion: 2`；狼人杀用板子预设（默认 6 人基础板，可传 boardId） |
| `POST /:id/end`（本手后结束） | `requestStopAfterCurrentHand` |
| `POST /:id/force-end` | `terminateImmediately`（带排名） |
| finalize 排名 | `classify().finished.result`（engine2 结算） |

## 8. 清理清单（接入验证通过后执行）

- 删 `src/games/poker/engine/`、`src/games/werewolf/engine/`（旧引擎）与 `tests/unit/games/*/engine/` 旧测试
- 删 `backend/orchestrator/werewolf-hooks.ts`、旧 `publicStateEvent/continueAfterBoundary/botStrategy` 插件面与 `action-validator` 的旧分支
- 审计 23/24/25/26/27/28/31 状态 → 已修（随 v2 接入关闭）；session-state 更新
- 旧运行中对局：部署后手动 force-end 清理（运维备注）

## 9. 验收

1. `npx vitest run` 全绿，含新增：GM v2 驱动两游戏 mock 对局到终局的集成测试（token 缺失 → applyDefaultAction 兜底路径）
2. 观战页对 v2 对局可渲染（两游戏）、上帝/公开视角切换生效、回放可用
3. `npm run check` 全绿；CI 绿
