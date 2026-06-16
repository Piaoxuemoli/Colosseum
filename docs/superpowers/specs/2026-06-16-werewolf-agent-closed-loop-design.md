# Werewolf（狼人杀）Agent 闭环 — 设计 Spec

- 日期：2026-06-16
- 分支：`feature/werewolf-agent-loop`（从 `main` 切出，独立于未合并的 `feature/a2ui-config-page`）
- 目标交付：**最小闭环** —— 6 人狼人杀从开局到终局，由真实 agent 层（context-builder → mock LLM → response-parser → engine）驱动跑完一整局，用 mock 测试证明闭环成立；不做前端/视觉验收。

---

## 1. 结论（先给结论）

1. **不要从零造。** `src/games/werewolf/` 已有完整引擎 + agent + memory + plugin 骨架，且 agent 层（`WerewolfPlayerContextBuilder` / `WerewolfResponseParser` / `WerewolfBotStrategy` / `WerewolfModeratorContextBuilder`）**已忠实落地论文的 tuning-free 框架**（记忆检索 = recent+informative、reflection = episodic 复盘、experience = semantic 长期画像、CoT = `<thinking>`、信念追踪 = `<belief>`、最终 Action = speak/nighttime-whisper 对应 `day/speak` 与夜间动作）。
2. **真正的最小缺口**只有两个：
   - **零测试**：测试套件重建中（`npm test` 占位），没有任何证据表明狼人杀能跑完一整局。
   - **mock LLM 仅 poker-aware**：无法在不接真实 LLM/A2A/Redis 的情况下跑通 agent 决策路径。
3. **调研中发现一个真实引擎 bug**：`phase-machine` 在转入 `night/seerCheck` / `night/witchAction` 时用 `aliveByRole` 设置 `currentActor`；当该神职已死（狼杀了预言家/女巫）而狼仍存活（未结算）时，`currentActor = null` 但 `matchComplete = false`。GM/tick 见 null actor 会提前 finalize，导致**死局或误终局**。闭环测试必须捕获并修复它。
4. 因此本 spec 的"实现"= **加一个 mock 驱动的引擎级闭环测试** + **修上述死角色阶段 bug**，二者互相证明。agent 化本身无需重写。

---

## 2. 调研结论（字节相关 + 标准方法论）

| 来源 | 关键思路 | 可复用点 |
|---|---|---|
| **arXiv:2309.04658** *Exploring LLMs for Communication Games: Werewolf*（Xu et al.）—— 标准方法论（虽非字节，但是奠基工作，所有落地项目都引用它） | **tuning-free 框架**：冻结 LLM + 对过往通信与经验的**检索（retrieval）+ 反思（reflection）**；CoT prompt；浮现策略行为 | 记忆检索 / reflection / experience / CoT 四件套 |
| **MetaGPT werewolf 落地**（复现 2309.04658） | 把论文组件映射为 agent Action：`RetrieveMemory`（recent+informative 消息）/ `Reflect` / `RetrieveExperience` / CoT prompt；最终 Action = `Speak` / `NighttimeWhisper`；通信拓扑 1-1（预言家查验）/ 1-多（狼人击杀通知同伴+主持）/ 1-全（主持人广播） | 通信可见性分级（= 现有 event `visibility: public/role-restricted/private`）；狼人**策略先验=伪装神职** |
| **字节/火山引擎** `langgraph-demo/werewolf`（开源 AI 狼人杀，火山/豆包生态）；飞书《100 行 LLM-Agent 狼人杀》教程（豆包大模型） | LangGraph 状态机编排多 agent；豆包做决策 | 状态机驱动多 agent（= 现有 phase-machine + GM tick） |
| **datawhale easy-langent**、**DeepWerewolf**、**junjiem/werewolf-agent** | 9 人局 LangChain 群聊；Agentic-RL；纯 LLM 决策 | 参考角色数/夜间编排，但本平台固定 6 人 MVP |

**取舍**：本平台已用 TypeScript 纯函数引擎 + A2A agent + 记忆模块自研了等价能力，**不引入 LangChain/LangGraph/MetaGPT**（违反"游戏自治 + 不在共享模块加游戏差异"红线，且重复造轮子）。仅吸收**设计思想**（检索/reflection/experience/CoT/通信可见性/狼人伪装先验），这些 agent 层代码已体现。

---

## 3. 现状（已有，无需重写）

### 3.1 引擎契约（`src/platform/engine/contracts.ts`）
```
GameEngine<TState,TAction,TConfig> {
  createInitialState(config, agentIds): TState
  currentActor(state): string | null
  availableActions(state, agentId): ActionSpec[]
  applyAction(state, agentId, action): { nextState, events }
  boundary(prev, next): BoundaryKind | null
  finalize(state): MatchResult
}
```

### 3.2 狼人杀动作与状态（`engine/types.ts`）
- **角色**：`werewolf | seer | witch | villager`，6 人固定 2-1-1-2（`roles.ts` seededRng 分配）。
- **阶段**：`night/werewolfDiscussion → night/werewolfKill → night/seerCheck → night/witchAction → day/speak → day/vote →`（循环；`day/announce`/`day/execute` 为 legacy 已折叠，live 不进入）。
- **动作联合**：`night/werewolfKill` / `night/seerCheck` / `night/witchSave` / `night/witchPoison` / `day/speak` / `day/vote`。
- **胜负**（`win-condition.ts`）：狼全死→村民胜；村民全死或狼≥村民→狼胜；`day>=40`→平局（防 stall）。

### 3.3 agent 层（已落地 tuning-free 四件套）
- `WerewolfPlayerContextBuilder.build()` → `{systemMessage,userMessage}`：注入角色私信息（狼队友/验人结果/药剂）、最近发言+投票（**retrieval**）、semantic 长期画像 + episodic 复盘（**reflection+experience**），并规定 `<thinking>/<belief>/<action>` 输出契约（**CoT**）。
- `WerewolfResponseParser.parse()` → `<action>` 必需、`<belief>` 可选；解析失败回退合成 `day/speak`。
- `WerewolfBotStrategy.decide()` → 全阶段合法回退（deterministic-ish，纯函数，可作安全网）。
- `WerewolfModeratorContextBuilder` → 主持词（可选，无主持人时硬编码回退）。

### 3.4 编排（`src/backend/orchestrator/game-master.ts`，**本 spec 不改、不依赖**）
- `tickMatch`：Redis 锁 → 取 `currentActor` → `availableActions` → `requestAgentDecision`（A2A，失败回退 bot）→ `coerceToValidAction` → `applyAction` → 发事件 → 检查终局。
- 需要 Redis/DB/HTTP，**超出最小闭环范围**（Layer 3，本 spec 不交付）。

---

## 4. 锁定决策

- **D1（范围）**：只做"引擎 + agent 层"级 mock 闭环；**不**做 GM/Redis/DB/HTTP 全链路、**不**做 werewolf A2UI 配置页、**不**接真实 LLM。理由：目标=最小闭环 + mock 测试 + 无前后端验收。
- **D2（测试形态）**：`scripts/werewolf/run-closed-loop.ts`，由 `tsx` 运行（解析 tsconfig `@/*` 别名）；导出 `runClosedLoop(opts)` 并带断言。挂在 `npm run check:werewolf`，并入 `check` 门禁。理由：项目当前无测试运行器（vitest 未声明），沿用 `scripts/a2ui/validate-surfaces.mjs` 的"纯脚本 + check:* 脚本"模式，零额外基建。
- **D3（mock LLM 策略）**：保留**真实** context-builder 与 response-parser 在回路里；仅把"调 LLM"这一步替换成 `mockLlmDecide(state, role, phase, actorId)`，按阶段/角色产出**合法**的 `<thinking>/<belief>/<action>` XML。`applyAction` 失败时回退 `botStrategy.decide`（镜像生产安全网）。理由：最大化覆盖真实 agent 代码路径，mock 只在最不可控的 LLM 边界。
- **D4（闭环断言）**：一局跑完必须满足——① `matchComplete===true` 且 `winner ∈ {villagers,werewolves,tie}`；② 有界 tick（≤ 容差，如 600 步）不 stall；③ 全程 `applyAction` 无未捕获异常；④ 每个活人在其可行动阶段都获得过决策机会（覆盖度）；⑤ 多种子（seed）下统计终局分布合理（村民/狼/平局都有可能，不 100% 单边）。跑 ≥ N（如 12）局全通过。
- **D5（修 bug）**：`phase-machine` 死角色阶段跳过——转入 `seerCheck`/`witchAction` 时若对应神职无存活者，级联跳到下一可行动阶段（解析夜间死亡→白天），保证**非终局状态恒有非空 `currentActor`**。用 wrapper（`advancePhase` 内部对"null actor 且未结算"的状态继续推进）实现，最小改动。
- **D6（不回归）**：补 tsconfig 排除（`.next-build`、遗留 `*.test.ts`）——从 main 切出，main 的 tsconfig 缺这些排除会导致 typecheck 编译 vitest 测试文件失败。此为独立修复（与 A2UI 分支的同类修复合并时无冲突）。引擎层仍遵守"不 import React/DB/Redis/LLM"。
- **D7（依赖）**：新增 devDep `tsx`（标准 TS 脚本运行器，tsconfig paths 原生支持）。**单独提交** package.json + lock。不引入 vitest（测试套件仍在重建中，且非最小所需）。
- **D8（验收口径）**：本任务**不做**视觉/前端验收（不跑 `next dev`、不点页面）。验收= `npm run check:werewolf`（闭环多局通过）+ `npm run lint && npm run typecheck && npm run build`（无回归）。

---

## 5. 闭环架构

```
            ┌──────────────── runClosedLoop (tsx 脚本) ────────────────┐
            │                                                            │
 seed=0..N  │  state = engine.createInitialState({seed}, 6 agentIds)     │
 ─────────▶ │  while !matchComplete && ticks<cap:                        │
            │     actor = engine.currentActor(state)        ◀── 真实引擎 │
            │     valid  = engine.availableActions(state, actor)         │
            │     {sys,usr} = ctxBuilder.build({actor,state,valid,mem})  ◀── 真实 prompt
            │     xml = mockLlmDecide(state, role, phase, actor)         ◀── 仅此处 mock
            │     parsed = parser.parse(xml, valid)         ◀── 真实解析 │
            │     action = parsed.action                                │
            │     try engine.applyAction(state, actor, action)           │
            │     catch → action=bot.decide(state); applyAction(...)     ◀── 生产安全网
            │     record events; ticks++                                │
            │  finalize → assert D4                                      │
            └────────────────────────────────────────────────────────────┘
   无 Redis / 无 DB / 无 HTTP / 无 LLM / 无前端
```

---

## 6. 测试策略（对齐 `linting-and-quality.md`）

- **引擎与 parser**：本闭环即覆盖正常路径 + 边界（死角色跳过、投票平票、药剂、首夜自救赎禁、40 天平局封顶）。
- **LLM 真调用**：不进自动测试 —— 用 mock（D3）。
- **Redis/Postgres**：本测试**不需要**容器（纯引擎层）。
- 断言失败即非零退出；`check:werewolf` 并入 `check`，回归即拦截。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `tsx` 不解析 `@/*` 别名 | 先跑 3 行冒烟导入；不行则退 `tsconfig-paths/register`（仍单一 devDep） |
| `npm install -D tsx` 离线失败 | 先交付研究+spec+plan（已落盘价值）；记录阻塞，转人工 |
| 闭环暴露更多引擎 bug | 即测试价值所在；按 D5 同类手法修，每修一处补断言 |
| 多种子终局 100% 单边（策略失衡） | 记录分布，但不阻塞交付（最小闭环=能跑完，非平衡性）；女巫 bot 永不救药可在 Layer 2 顺手优化为"有药且有人死则救" |

---

## 8. YAGNI / 明确不做

- werewolf `.a2ui/` 配置页（A2UI spec 第二轮）。
- GM/Redis/DB/HTTP 全链路跑通（Layer 3，未来）。
- 真实 LLM 接入与策略调优（论文 reflection/experience 跨局学习等）。
- 9 人局/守卫/猎人等扩展角色。
- 任何前端/视觉变更与验收。

---

## 9. 交付与结束条件

- `npm run check:werewolf` 多局全绿；
- `npm run check`（lint+typecheck+build，含新 check:werewolf）全绿；
- 死角色阶段 bug 已修 + tsconfig 排除已补；
- `docs/ai/session-state.md` 与 MEMORY 已更新；
- 给出最终交付报告（含验证方案）后**结束任务**。
