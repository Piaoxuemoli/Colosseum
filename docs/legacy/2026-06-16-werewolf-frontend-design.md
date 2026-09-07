# Werewolf 前端 — 监控布局 + 页面结构 Design Spec

- 日期：2026-06-16
- 分支：`feature/werewolf-frontend`（基于 `feature/werewolf-agent-loop`，继承引擎死角色修复 + tsx）
- 目标：**完成狼人杀观战前端** —— 复用德州扑克的「思考气泡 + 右侧 tab」体验，但内容按狼人杀设计；先给「整体监控布局 spec」与「页面结构 spec」，再实现。
- 参照：`docs/ai/rules/ui-style.md`（award-grade arena console，三块布局，思考链 streaming）、`docs/ai/rules/frontend-backend.md`（前端只读 store/SSE，不 import backend）、德州扑克 `src/app/matches/[matchId]/SpectatorView.tsx`。

---

## 0. 结论（先给结论）

1. **骨架已存在但未完成**。`SpectatorView` 已有 `gameType==='werewolf'` 分支，6 个 UI 组件（WerewolfBoard/PlayerCard/SpeechBubble/VoteTally/ModeratorPanel/WerewolfResultPanel）已实现，事件契约**端到端打通**（GM 既 emit `werewolf/moderator-narrate` 驱动 day/phase，也 emit `werewolf/game-end` 带 winner+actualRoles，store reducer 全处理）。
2. **三个真实缺口**（=本次"完成前端"的工作）：
   - **思考气泡缺失**：`PlayerCard` 无 `thinking`/气泡 —— 目标点名项。扑克 `PlayerSeat` 有完整气泡；狼人未接。
   - **死亡不可见**：`WerewolfBoard` 写死 `alive={true}`，store 无 deaths 字段 → 观战看不到谁出局。需主持词携带死亡信息。
   - **右侧 tab 未适配**：状态 tab 是占位 div（"狼人杀状态面板"）；rank/chart 是扑克筹码概念，不适配狼人。
3. **不重做布局**：复用扑克的「header + 主赛场 + 右侧 rail + 结果弹层」三块布局与响应式，只换棋盘内容与 tab 内容。

---

## Part A — 整体监控布局 spec（监控布局）

### A.1 设计目标
狼人杀是**信息不对称的社交推理博弈**，观战 = "上帝视角 lite"：看到公开事件流（主持词/发言/投票）、可见死亡、思考气泡，但**真实身份仅在终局揭示**。布局要让「当前阶段、轮到谁、谁死了、谁在思考」始终可见。

### A.2 三块布局（镜像扑克，ui-style §布局原则）
```
┌───────────────────────────────────────────────────────────────┐
│ Header / 状态条  (标题"狼人杀·Day N" · phase · status · 回放)   │  shrink-0
├──────────────────────────────────┬────────────────────────────┤
│  主赛场 WerewolfBoard (flex-1)     │  右侧 Rail (lg:w-[22rem])   │
│  ┌────────┬────────────┬────────┐ │  ┌──────────────────────┐  │
│  │主持面板│  发言时间线  │ 右半座 │ │  │ Control Rail 对局信息 │  │
│  │左半座  │  Day·phase  │ +投票板│ │  │ Tabs(状态/名册/行动/  │  │  h-[100dvh]
│  │ +气泡  │  +气泡      │ +气泡  │ │  │   思考/印象)          │  │
│  └────────┴────────────┴────────┘ │  └──────────────────────┘  │
│  [3 列 grid: 1fr 2fr 1fr @lg]      │  移动端→ floating Menu+Sheet│
├──────────────────────────────────┴────────────────────────────┤
│ 终局：WerewolfResultPanel 弹层（winner + 全员身份揭示表）        │
└───────────────────────────────────────────────────────────────┘
```
- 容器：`flex h-[100dvh] flex-col lg:flex-row gap-3`（扑克同款）。
- 主赛场 `<main>` `flex-1 min-w-0`；右侧 `<aside>` `hidden lg:flex w-[22rem]`；移动端 `Sheet`（floating `Menu` 按钮）—— **RightPanel 组件已实现**，直接复用。
- 棋盘内 `grid grid-cols-1 lg:grid-cols-[1fr_2fr_1fr]`（左主持+3座 / 中发言时间线 / 右3座+投票）。

### A.3 思考气泡落位（D2）
- 卡片在左右两列纵向排列（非扑克的环形牌桌），气泡**统一置于卡片上方**（`placement='top'`，居中）。
- 复用扑克同款视觉（`ThinkingBubble`：青色玻璃边框、streaming 文本、"思考中"药丸）；可见时长沿用 `THINKING_BUBBLE_VISIBLE_MS`（4.5s，无新文本追加则淡出）。
- 数据源：共享 `useThinkingStore.current[agentId].text`（SpectatorView 已把 `agent/thinking` + `thinking-delta` SSE 无差别喂入，狼人自动受益）。棋盘按 agentId 取当前思考文本传入 `PlayerCard`。

### A.4 监控态优先级（"始终可见"）
按重要性从上到下/左到右：① 主持人当前阶段词（ModeratorPanel，左上）→ ② 当前行动者高亮（PlayerCard `isCurrentActor` 绿环 pulse）→ ③ 发言时间线（中）→ ④ 投票板（右下）→ ⑤ 出局名单（ModeratorPanel/状态 tab）→ ⑥ 思考气泡（浮于卡片）。终局结果弹层置顶。

### A.5 共享 vs 游戏专属边界（D5，游戏自治红线）
- **共享（平台层，禁加 gameType 分支逻辑）**：SpectatorView 壳、RightPanel tab 骨架、`useMatchStream`(SSE)、`thinking-store`、`match-view-store` 的 reducer 框架、`ActionLog`、`ThinkingLog`、`ErrorBadge`。
- **狼人专属（`games/werewolf/ui/`）**：WerewolfBoard、PlayerCard、SpeechBubble、VoteTally、ModeratorPanel、WerewolfResultPanel、（新）WerewolfStatusPanel、WerewolfRoster。
- **扑克专属**：PokerBoard、PlayerSeat、PokerStatusPanel、LiveScoreboard、ChipChart、RankingPanel。
- `SpectatorView`/`RightPanel` 按 `gameType` 选择棋盘与 tab 内容是**允许的编排分支**（选哪个组件），不是把游戏规则塞进共享层。

---

## Part B — 页面结构 spec（页面结构）

### B.1 路由与 SSR
- `src/app/matches/[matchId]/page.tsx`（已存在，游戏无关）：`loadMatchSpectatorBundle(matchId)` → `<SpectatorView gameType initialPlayers initialEvents ... />`。
- 狼人走 `gameType==='werewolf'` 分支（SpectatorView.tsx:182）。

### B.2 组件树（狼人分支）
```
SpectatorView (werewolf)
├─ <main>
│  ├─ Header：标题"狼人杀 · Day {ww.day}" · Badge(ww.phase) · status · 回放链接
│  └─ WerewolfBoard {players, currentActor}
│     ├─ 左列：ModeratorPanel + 3× PlayerCard {…, thinking, alive, claimedRole, revealedRole, isCurrentActor}
│     ├─ 中列：Day·phase 条 + SpeechBubbleList
│     └─ 右列：3× PlayerCard + VoteTally
├─ RightPanel {matchId, gameType:'werewolf'}
│  └─ Tabs：状态(WerewolfStatusPanel) / 名册(WerewolfRoster) / 行动(ActionLog) / 思考(ThinkingLog) / 印象(ImpressionsPanel)
└─ WerewolfResultPanel {players}   // 终局弹层，读 ww.winner + ww.roleAssignments
```

### B.3 数据流
```
SSE(useMatchStream) ─┬─ event ─→ ingestEvent → reduceMatchViewEvent → store.werewolf
                     ├─ thinking-delta/agent/thinking → thinking-store.current
                     └─ match-end → finalizeAllThinking + setMatchEnd
store.werewolf {day, phase, speechLog, voteLog, moderatorNarration, deaths(新), roleAssignments, winner}
   ↓ selectors
WerewolfBoard/ModeratorPanel/SpeechBubble/VoteTally/PlayerCard(WerewolfBoard 传 alive/thinking)
```
- 初始事件由 SSR bundle 经 `ingestViewEvent` 重放（断线可从 DB events 恢复，frontend-backend §实时）。

### B.4 组件清单与缺口动作
| 组件 | 现状 | 本次动作 |
|---|---|---|
| SpectatorView(ww 分支) | ✓ 布局就绪 | 不变（气泡数据已在 thinking-store） |
| WerewolfBoard | ✓ 3列；**alive 写死 true，无 thinking** | 传 alive(由 deaths 推导) + thinking(读 thinking-store) |
| PlayerCard | ✓ 死亡/角色 UI 齐全；**无气泡** | 加 `thinking`/`alive` 真值 + ThinkingBubble + "思考中"药丸 |
| ModeratorPanel | ✓ 最新主持词 | 追加"出局名单"行（读 ww.deaths 当日） |
| SpeechBubble | ✓ | 不变 |
| VoteTally | ✓ | 不变 |
| WerewolfResultPanel | ✓ | 不变 |
| **WerewolfStatusPanel** | ✗ 占位 | 新建：阶段/天数/存活数/当前行动者/胜负临近 |
| **WerewolfRoster** | ✗（rank tab 用 LiveScoreboard 错配） | 新建：存活花名册 + 已揭/自称身份 |
| RightPanel | ✓ tab 骨架 | tab 内容按 gameType 切；狼人隐藏 chart |
| werewolf-hooks.moderatorNarrationEvent | ✓ emit 主持词 | **payload 加 deaths**（prev/next 存活差分+cause） |
| match-view-store reducer | ✓ 处理 4 类事件 | **werewolf.deaths 字段** + moderator-narrate 写入 |

---

## 1. 锁定决策

- **D1（观战视角）**：上帝视角 lite —— 公开事件 + 可见死亡 + 自称身份 + 思考；真实身份仅终局揭示。不泄露夜间私动作（狼刀/查验/救毒细节），死亡**事实**在白天公告（公告时附带 cause，观战控制台可见）。
- **D2（思考气泡）**：复用扑克同款 `ThinkingBubble`（移到共享 `frontend/components/match/`）+ 新建共享 `useThinkingBubble(thinking)` hook；狼人 `PlayerCard` 用之，气泡置于卡片上方 `placement='top'`。扑克逻辑零改动（仅 ThinkingBubble import 路径变）。
- **D3（死亡跟踪）**：`moderatorNarrationEvent`（GM hook，已有 prev/next state）在存活集合缩小时把 `deaths: {agentId, cause}[]` 塞进 `werewolf/moderator-narrate.payload`；store reducer 累积 `werewolf.deaths`；WerewolfBoard 由 deaths 推导 alive；ModeratorPanel 汇总当日出局。死亡 fact 公开、cause 对观战可见（D1）。
- **D4（右侧 tab）**：状态→`WerewolfStatusPanel`（新）；名册→`WerewolfRoster`（新，替代 rank 的 LiveScoreboard）；行动→`ActionLog`（共享）；思考→`ThinkingLog`（共享）；印象→`ImpressionsPanel`（共享，已带 gameType）；**隐藏 chart**（狼人无筹码走势）。RightPanel 按 gameType 渲染 tab 集与内容。
- **D5（自治边界）**：共享层不加游戏规则分支；编排级 `gameType` 选择组件允许。新组件落 `games/werewolf/ui/`；ThinkingBubble 落共享 `components/match/`。
- **D6（布局复用）**：不新增布局系统；镜像扑克三块 + 响应式 + 100dvh。狼人棋盘内 3 列 grid 不变。
- **D7（验收）**：`npm run lint && typecheck && build` 全绿；新增轻量 reducer smoke（tsx 喂脚本化 werewolf 事件序列，断言 day/phase/winner/deaths 推导正确），并入可选 `check:werewolf-ui`。**本环境不做浏览器/视觉验收**（建议人工 `npm run dev` 复核气泡/死亡/结果弹层）；交付报告中如实说明。
- **D8（YAGNI/不做）**：不做真实身份实时透视（除终局）；不做 9 人/守卫/猎人 UI；不改扑克观战逻辑；不接真实 LLM 主持人（主持词仍 fallback NARRATION_MAP，game-end 揭身份）。

---

## 2. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 移动 ThinkingBubble 影响扑克 | 仅改 import 路径，无逻辑变更；build 验证 |
| deaths 载荷泄漏过多信息 | 仅死亡 fact + cause，不含夜间私动作细节；观战控制台属性可接受（D1） |
| reducer smoke 依赖 store 文件 import 链 | 只 import 纯函数 `reduceMatchViewEvent`/`deriveMatchView`，避开 zustand/React；失败则退化为仅 build 验证 |
| tab 适配破坏扑克 | gameType 分支仅在 RightPanel 内，扑克路径不动；分别 build |

---

## 3. 交付与结束条件
- 思考气泡、死亡跟踪、WerewolfStatusPanel/WerewolfRoster、RightPanel tab 适配全部落地；
- `lint/typecheck/build` 全绿（+ 可选 check:werewolf-ui smoke 绿）；
- session-state / MEMORY 更新；Conventional Commits 分步提交；
- 给出交付报告（含布局图、组件清单、验证方案、未做项）后**结束任务**。
