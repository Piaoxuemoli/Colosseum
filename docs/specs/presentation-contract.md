# 品类呈现契约（Presentation Contract）规格

- 日期：2026-09-09　状态：已定稿（实施依据；冲突以本文为准，上游见 `docs/prd/PRD.md` FR-4.5-03 / NFR-08）
- 上游规格：`docs/specs/engine2-integration.md`（本文扩展其 §6 前端投影契约为品类无关的呈现契约；事件信封、受众模型、GM 驱动方式不变）
- 实现物：`src/platform/engine/presentation.ts`（契约类型）、`games/*/integration/presentation-v2.ts`（两游戏实现）、`src/frontend/store/projections/generic-v2.ts`（通用兜底投影）
- 验收任务：roadmap R3-1（FR-4.5-03 前半）；R3-2 新品类冒烟复用本文的 §5 一致性门禁

## 1. 定位与原则

1. **契约是"通用视图层"**：把牌桌类（FR-4.5-01）与社交推理类（FR-4.5-02）共同满足的呈现要求收敛为品类无关的四支柱（态势 / 事件流 / 阶段 / 结算）。任何新品类只要实现本契约，观战框架（思考链、动作流、兜底可见性、结算页入口）即可自动复用——平台核心（GM、registry、观战框架）不得出现任何 `gameType` 分支。
2. **通用视图与游戏专属面板分层**：契约视图是保底呈现；游戏专属棋盘（PokerBoard / WerewolfBoard 等）可在其上叠加品类特化（边池、昼夜氛围等）。gameType 无专属面板时观战页回落到通用视图（§4）。
3. **纯函数边界**：契约成员全部是同步纯函数（state / 事件流入，视图模型出）；IO、时间、随机性一律归 GM / 前端。受众模型沿用 engine2（audience 是唯一可见性真相，契约层不另造口径）。

## 2. 插件面（GameModuleV2.presentation）

`GameModuleV2` 追加必选成员 `presentation: PresentationModule<TState>`（方法语法声明，泛型插件可无断言注册进 registry）：

```ts
interface PresentationModule<TState> {
  // ① 态势视图：选手/座位状态 + 聚合资源（筹码/命数）+ 当前焦点行动者
  situation(state: TState): GenericSituationView
  // ② 事件流 display hints：engine2 kind → 展示提示（类别/严重度/图标/中文名）
  eventHints(): Record<string, PresentationEventHint>
  // ③ 阶段模型：阶段清单、当前阶段、轮次计数（德扑=手数/狼人=天数）、边界标记（回放跳转锚）
  phaseModel(state: TState, fullStream?: readonly Record<string, unknown>[]): GenericPhaseModel
  // ④ 结算结构：排名行（含角色/分数）、获胜方标签、统计摘要；未终局为 null
  settlement(state: TState): GenericSettlement | null
}
```

类型定义见 `src/platform/engine/presentation.ts`（经 `contracts-v2.ts` 再导出）。要点：

- **态势**：选手行 `status` 收敛为三值（`active` / `sidelined`＝本手弃牌等回合外态 / `eliminated`）；`resources` 为数值聚合对（筹码、存活等，label 自定）；`privateNote` 承载上帝视角注记（角色/底牌），公开视角渲染时应省略；`focusAgentId` 是当前行动者（驱动"轮到谁"锚点）。
- **事件流**：hint 的 `category` 取九值封闭集（action/speech/vote/phase/reveal/award/death/system/error），供通用动作流映射图标与分组；`severity`（info/success/warning/critical）供高亮；`godOnly: true` 标记受众非 public 的事件（通用渲染在公开视角下降权）。**hint 表必须覆盖该游戏 engine2 的全部权威 kind**。
- **阶段**：`phases` 是本品类会经历的阶段全集（顺序即推进序）；`cycle` 是轮次计数器；`boundaries`（seq 升序）标记每次阶段/轮次切换，是回放跳转（FR-4.6-02"阶段列表完整无遗漏"）的通用锚。`fullStream` 形状即 DB 落库 payload（engine2 事件 JSON），插件内部用既有 guard 收窄。
- **结算**：`rows` 覆盖全部参赛者且 `rank` 唯一（1 = 冠军）；`winnerLabel` 人类可读（如"狼人阵营"）；`digest` 为键值摘要（对局时长口径、胜负依据等），承接 FR-4.6-01"排名可被过程数据验证"。

## 3. 事件流通用锚点约定（前端兜底渲染的输入契约）

前端兜底投影（§4）只消费事件流，不触达游戏模块。为保证任意品类的 `${gameType}:v2:${kind}` 信封流都可被通用归约，所有品类的引擎事件**必须**满足以下结构锚点（现有两游戏已满足）：

| 锚点 | 约定 | 现有实例 |
|---|---|---|
| 信封 | `kind = \`${gameType}:v2:${engine2Kind}\``，payload = engine2 事件逐字段平铺（含 audience），seq 单调 | engine2-integration §3 |
| 作用域 | 锚点键在「载荷本体或其内嵌 `payload` 子对象」之一中查找（德扑平铺、狼人嵌套两种事件形态都覆盖） | 德扑平铺；狼人 `payload.payload` |
| 名册 | 存在开局事件携带 `seatIds: string[]`、`playerIds: string[]` 或 `seats: Array<{ playerId | agentId; seat? }>` 之一 | 德扑 `match-config.seatIds`；狼人 `matchStarted.seats` |
| 轮次 | 事件携带数值键 `day` / `handNumber` / `hand` 之一（轮次计数器） | 德扑 `hand`；狼人 `day` |
| 阶段 | 事件携带字符串键 `phase` / `street` 之一（当前阶段名） | 德扑 `street-dealt.street`；狼人 `phaseEntered.phase` |
| 结算 | 终局事件携带 `ranking: Array<{ seatId | agentId | playerId; rank }>` 或 `reveal: Array<{ playerId | agentId; role }>`，可选 `winner: string` | 德扑 `match-finished.ranking`；狼人 `gameEnded.reveal + winner` |

兜底标记：payload `isDefault === true` 的条目在通用动作流中带兜底角标（FR-4.4-04）。未知键一律忽略（向前兼容），事件本体全部留痕。

## 4. 前端兜底投影与观战分派

- `src/frontend/store/projections/generic-v2.ts`：消费任何满足 §3 锚点的 `${gameType}:v2:*` 事件流，归约出通用视图模型 `GenericV2View`（名册行 + 阶段条带 + 通用动作日志 + 结算摘要）。匹配顺序：`poker:v2:` / `werewolf:v2:` 优先走既有游戏投影，其余 `*:v2:` 走通用投影（两既有游戏行为零变化）。
- 观战页（SpectatorView）按 gameType 分派：有专属面板的品类渲染专属棋盘；无专属面板（未知品类，R3-2 冒烟场景）渲染 `GenericSituationPanel`（紧凑列表：态势名册 / 阶段条带 / 动作日志 / 结算摘要），设计系统 tokens 对齐，无品类知识。
- 游戏专属投影（poker-v2 / werewolf-v2）与通用投影互不依赖；通用投影的断言对既有两游戏的信封流同样成立（契约锚点的一致性回归，见 §5）。

## 5. 一致性门禁（assertPresentationContract）

`tests/unit/platform/engine/presentation-contract.test.ts` 提供可复用断言器 `assertPresentationContract(case)`，对任一注册游戏的确定性短局脚本检查：

1. `presentation` 四成员齐全；`eventHints()` 覆盖脚本流中出现的全部 kind，label 非空、category 合法；
2. `situation` 纯函数确定性（两次调用深度相等）；选手行覆盖完整名册、agentId 唯一；`focusAgentId` 为 null 或名册成员；
3. `phaseModel`：`current` ∈ `phases` ∪ {null}；`boundaries` seq 严格递增、cycle 非降；轮次计数随局推进；
4. `settlement`：未终局 state 返回 null；终局 state 返回覆盖全名册的排名（rank 唯一且含 1）+ 非空 winnerLabel。

**新品类接入（R3-2 / R4-1）必须跑通本门禁**——这是 FR-4.5-03"观战能力自动复用"与 NFR-08"不改平台核心"的可执行验证形态。

## 6. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-09-09 | 初稿：四支柱契约（态势/事件流/阶段/结算）、插件面 `GameModuleV2.presentation`、事件流通用锚点、前端兜底投影与观战分派、一致性门禁 |
