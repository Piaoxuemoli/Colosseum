# 2026-09 德州扑克（Texas Hold'em）引擎实现深度调研

- 日期：2026-09-08
- 性质：调研文档（research），为新引擎 PRD 提供输入；不是 PRD 本体
- 方法：Web 调研（Wikipedia / Poker TDA / StackExchange / arXiv / GitHub，来源见文末）+ 现有代码审读（`src/games/poker/`）
- 读者：新 poker 引擎 PRD 作者、审计者
- 备注：规则类论断尽量给出 ≥2 个独立来源；文内 `[Rn]` 对应文末来源编号

## 0. TL;DR

1. 现有引擎是**非标准 fixed-limit 变体**（preflop/flop 下注额 = SB 而非 BB、每街硬编码 4 注上限、config 的 `maxBetsPerStreet` 根本没被读取），与业界 canonical 规则差异大。
2. 最严重的正确性缺陷：**多人全下后 run-out 流程断裂**——`currentActor` 变 null 而 `handComplete=false`，`game-master.ts` 看到 null 直接 `finalizeMatch`，整场比赛提前终结且奖池未发放。
3. 其余关键缺口：无 min-raise 追踪、不完整全下加注错误地重开行动、奇数筹码归属顺序不符 TDA 规范、无 ante/盲注升级/ICM、`Math.random` 无种子不可回放、事件流是快照式而非事件溯源、公共状态泄露全员手牌。
4. 选型建议：新引擎走「immutable state + 纯函数 `applyAction(state, action) → {state, events}` + 事件溯源 + 种子化 RNG」路线；评估器 v1 用 7 选 5 枚举（正确性优先），性能瓶颈时再换 Cactus Kev/查表法。

---

## 1. 规则权威梳理（最核心）

### 1.1 牌型排名与 kicker 细则

牌型从大到小（Wikipedia「Texas hold 'em」与「Poker」条目一致）[R1][R2]：

| # | 牌型 | 英文 | 比较键（依次比较） |
|---|------|------|--------------------|
| 1 | 皇家同花顺 | Royal Flush | （同花顺 A 高，本质是 straight flush 特例） |
| 2 | 同花顺 | Straight Flush | 顺子最高牌；A-5「轮子」以 5 为高 |
| 3 | 四条 | Four of a Kind | 四条点数 → kicker |
| 4 | 葫芦 | Full House | 三条点数 → 对子点数 |
| 5 | 同花 | Flush | 五张牌从高到低逐张比 |
| 6 | 顺子 | Straight | 最高牌；A-5 以 5 为高 |
| 7 | 三条 | Three of a Kind | 三条点数 → 两张 kicker 逐张 |
| 8 | 两对 | Two Pair | 大对 → 小对 → kicker |
| 9 | 一对 | One Pair | 对子点数 → 三张 kicker 逐张 |
| 10 | 高牌 | High Card | 五张逐张比 |

kicker 细则（五张牌规则）[R1]：

- **最优五张**：摊牌时从 7 张（2 底牌 + 5 公共牌）中任选 5 张组成最强牌，底牌可以 0/1/2 张参与。仅比较这 5 张。
- **Kicker 平局判定**：牌型类别相同则按上表比较键逐位比较；全部相等才平分。经典例子：公共牌 `A-A-K-Q-J` 时，所有人「打板」成对 A、kicker K-Q-J，底牌不再参与，平分 [R1]。
- 花色**永不**参与大小比较（同点数同牌型必是平局）[R1][R3]。

### 1.2 平局分割（split pot）与奇数筹码归属

- 平分：赢家数 n，池内筹码均分；除不尽时余数逐枚分配 [R1][R4]。
- 奇数筹码归属（TDA 规则「Awarding Odd Chips」）：**板牌类游戏（含 Hold'em）中，奇数筹码归按钮左侧第一个（顺时针方向）有资格分池的座位**；高低分池游戏归高牌方；每个边池单独分割 [R4][R5]。
- 现金桌另一常见变体：按「最大单张花色（按花色桥牌序 spade>heart>diamond>club）」决奇数筹码归属；线上平台普遍采用 TDA 的按钮左侧规则 [R5]。

### 1.3 下注轮结构：街、盲注、行动顺序

- 四条街：**preflop → flop(3 张) → turn(1 张) → river(1 张)**，flop/turn/river 前各烧一张牌（线上环境烧牌仅是形式，不影响公平性，可省略但建议在事件流中保留占位以贴合观战习惯）[R1]。
- 盲注：SB/BB 是「活注」（live bet），BB 在 preflop 无人加注时有 option（可 check 或 raise）[R1][R3]。
- 行动顺序：
  - preflop：从 BB 左侧第一位（UTG）开始顺时针；BB 最后行动（option）[R1]。
  - postflop：从按钮左侧第一位仍在手的玩家开始（SB 位置先动），按钮最后 [R1]。
  - **heads-up 特殊顺序**：按钮位 = SB；preflop 按钮（SB）先行动，postflop BB 先行动 [R1][R6]。
- 每街结束条件：所有未弃牌玩家对当前最高下注额都已行动且跟平（BB 的 option 也算一次行动）[R1][R3]。
- 弃牌至最后一人：直接赢家拿池，无需摊牌、无需发完公共牌 [R1]。

### 1.4 加注规则：min-raise、incomplete all-in、bet 上限类型

- **min-raise（NLHE）**：最小加注增量 = 上一次 bet/raise 的增量（不是「加到额」本身）。例：盲注 2，加注到 8（增量 6），下一次最小 re-raise 须再加 6 到 14 [R1][R7]。街内首个下注的 min bet = 1 BB。
- **不完整全下加注**：全下金额不足一个完整加注增量时，**不构成完整加注、不重开行动**——已行动玩家只能跟平差额，不能再 raise（「half bet rule」：≥ 半个增量算 raise 并重开行动，各地规则有差异）[R1][R3][R7]。引擎必须跟踪 `lastRaiseSize` 与「谁已被完整加注重开」。
- **bet 上限类型差异**：

| 类型 | 规则要点 |
|------|----------|
| No-limit | min bet = 1 BB；min raise 见上；最大可至全下（任意金额）[R1] |
| Pot-limit | 无人下注时 max bet = 当前池；面对下注时 **max raise = 3 × 当前需跟注额 + 其余池内金额**（等价于「先跟注再加注当前池」）。加注本身最小为 min-raise 规则 [R8][R9] |
| Fixed-limit | preflop/flop 下注额 = 小注（small bet = 1 BB），turn/river = 大注（big bet = 2 BB）；**每街注/加注总数封顶（通常 4）**，封顶后只能跟或弃 [R1][R10] |

### 1.5 边池（side pot）规则与标准算法

规则要点 [R3][R11][R12]：

- 按各玩家**整手牌累计贡献额（total commitment）**分层，而不是按单街下注。
- 每个池的参赛资格（eligibility）独立判定：某玩家只与「贡献额 ≤ 自己贡献上限」的对手竞争；**all-in 玩家可以赢主池和自己够资格的池，但永远不能赢超出其贡献的更外层边池**。
- 弃牌玩家的贡献不消失：按层归入各池，但弃牌者无资格赢任何池。
- 多个 all-in 嵌套：按 all-in 门槛升序切层（内层 = 主池，外层依次为 side pot 1..n），每个池独立用该池有资格玩家中的最强牌判定胜负。
- 结算顺序：从最外层边池往内（或等价地从内往外），每个池独立结算、独立处理平分与奇数筹码 [R11][R12]。

标准算法（贡献分层法，社区共识写法）[R11][R12]：

```
按 totalCommitted 升序去重得到层级 L1 < L2 < ... < Ln
prev = 0
for each 层级 Lk:
  contributors = 所有 totalCommitted > prev 的玩家
  pot.amount   = (Lk - prev) × contributors 数
  pot.eligible = contributors 中未弃牌者
  prev = Lk
若某层 eligible 为空（该层只剩弃牌者贡献），金额并入上一层（或下一层）池
```

验证手段：与 PokerListings side pot calculator 等工具的对拍用例 [R11]。

### 1.6 摊牌规则

- **亮牌顺序**：river 有下注时，**最后的进攻者（最后一次 bet/raise 的人）先亮**；无人下注时从按钮左侧第一位开始依次亮 [R13][R14]。
- **Muck 权利**：后行动者可以不亮牌直接 muck 认输该池；但**要赢池必须全部亮牌**（不能"赢了还不亮"）；已被跟注的进攻者若 muck 则放弃池 [R13][R14]。
- **全下摊牌例外**：all-in run-out 时所有在池玩家通常必须亮牌（不再有诈唬空间），这也是观战回放最戏剧化的节点 [R13]。
- 比牌用 best 5 of 7（见 1.1）。AI 对战平台建议：引擎事件流显式建模「reveal 事件 + 顺序」，muck 决策对 LLM agent 可以简化为配置项（默认全员亮牌，利于观战）。

### 1.7 锦标赛 vs 现金桌语义

| 维度 | 现金桌（cash） | 锦标赛（tournament） |
|------|----------------|----------------------|
| 筹码语义 | 筹码=钱，可随时入座/离桌/补码 | 筹码是分数，淘汰制，打完为止 |
| 盲注 | 固定 | 按 **levels schedule** 周期性上升（+ ante 常见于后期）[R1][R15] |
| 淘汰 | 不适用 | 筹码归零出局；最后剩者夺冠；按出局顺序排名次 |
| 奖励 | 按池直接结算 | 按名次分配奖池；**bubble**（泡沫期=差一位进钱圈）策略压力来自 **ICM** [R16][R17] |
| Rebuy/Add-on | N/A | 前期可选：rebuy=淘汰/短码时再买一次起始码；addon=暂停时追加。AI 平台可作配置项 |
| Run it twice | 现金桌常见（全员同意才生效） | 一般不允许 [R18] |

**ICM 要不要进引擎？建议：不进 v1。** ICM（Independent Chip Model，Malmuth-Harville 法）把筹码栈映射为奖金期望，用于计算 bubble factor / risk premium；它是**策略层的派生量**而非规则层结算规则 [R16][R17]。引擎只需提供「名次→奖池分配表（payout schedule）」与当前筹码快照，ICM 数值可由 agent 侧或观战分析侧计算（作为 derived metric 注入 prompt 可选）。锦标赛采用固定盲注结构的简化版即可满足 AI 博弈观战需求。

### 1.8 特殊边界情形

- **Heads-up 盲注**：按钮 = SB，先拿牌、preflop 先行动、postflop 后行动 [R1][R6]。
- **全员 all-in 的 run-out**： betting 结束后应**一次性连续发完剩余公共牌**（逐街发，每街一个事件），再整体摊牌结算；发牌顺序与正常相同（先烧后发，可省略烧牌）[R13]。
- **盲注不足（short blind）**：SB/BB 玩家筹码不够时按剩余量全下（engine 代 post），仍保留其对应位置的权利（如 BB 短注仍有 option 概念，但只需跟平差额）[R3]。
- **Ante 变体**：经典 ante（每人每手前注）、**BB ante（大盲位代全桌前注，WSOP 2019 起主流）**、button ante；BB ante 不算入 BB 的活注；玩家筹码不足以同时付盲注+ante 时 TDA 有专门裁定（ante 优先）[R19][R20]。
- **死按钮（dead button）规则**：淘汰导致的按钮空洞处理，线上平台普遍用简化规则（直接移到下一个有码座位）；TDA 完整死按钮规则较复杂，AI 平台建议采用简化规则并在文档声明 [R5]。

---

## 2. 引擎实现模式调研

### 2.1 状态机设计：immutable state + 纯函数 + 事件溯源

社区高质量实现（如 `@hivetech/poker-engine`）的共同模式 [R21]：

- 引擎是**纯状态机**：`transition(state, command) → { ok, state, events }` 或 `applyAction(state, action) → { state, events }`；不做 I/O、不改输入 state、不隐藏私有信息（隐藏由「玩家视角投影 projection」单独提供）。
- state 设计成可序列化（JSON）快照：`{ handNumber, street, button, players[{stack, committed, status, cards}], board, deck, pots, lastRaiseSize, actor }`。
- **事件溯源（event sourcing）**：每次 apply 产出领域事件（`BlindPosted`, `CardsDealt`, `BetPlaced`, `StreetDealt`, `ShowdownRevealed`, `PotAwarded`…，含单调递增 seq）；回放 = 从初始 state 顺序 fold 事件流；快照 = 某一 seq 的 state 持久化，用于长局加速。观战端订阅事件流即可获得逐动作动画；审计端可用事件流重算校验。
- 校验分两层：`availableActions(state, seat)` 给出合法动作集（含 min/max 金额），`applyAction` 内部再做防御性校验并返回 typed error（不合法动作拒绝而不是静默修正）。

### 2.2 手牌评估器实现路线对比

| 路线 | 思路 | 性能 | 复杂度 | 备注 |
|------|------|------|--------|------|
| 朴素 7 选 5 枚举 | C(7,5)=21 组合，每组跑 5 张评估器取最大 | 慢（每手 ~21 次评估）；对每手一次摊牌完全够用 | 最低，最易测试 | **现状引擎即此路线**；正确性最直观 |
| Cactus Kev 位运算 | 每张牌编码（rank 位 + 4 bit 花色 + 质数积），位技巧判 flush/straight，查小表 | ~几百万手/秒 级 | 中（质数积、bit trick 要正确实现） | 原始站点与各种语言移植 [R22] |
| 2+2 查找表 | 预生成 ~32M 项 123MB 表，7 张牌 6 次内存查表 | 极快（>1 亿手/秒） | 高：表生成/加载/内存代价 | 适合 Monte Carlo 大规模模拟；JS/TS 环境表加载与内存是负担 [R23][R24] |
| 现成库 | treys/pokersolver/PokerHandEvaluator 等 | 见 2.5 | 最低 | 评估器是纯函数，最值得直接复用/对拍 |

**选型建议**：观战引擎摊牌频率极低（每手 ≤1 次），v1 保持 7 选 5 枚举（正确性优先、零表依赖），把 Cactus Kev 列为 v2 性能选项；equity/Monte Carlo 才是性能敏感点（agent 辅助计算），可后移。评估器必须配对拍测试（与 PokerHandEvaluator / pokersolver 交叉验证全组合样本）[R24][R25]。

### 2.3 边池实现算法对比

- **贡献分层法**（1.5 的算法）：O(n log n) 排序 + O(n²) 分层，实现最短，社区标准写法 [R11][R12]。适合每手结算一次的观战引擎。
- 按街累计 + all-in 门槛切层（实现于若干开源引擎）：与贡献分层法等价，差别只在数据结构。
- 常见坑：忘记弃牌者贡献仍留在池内；遗漏「某层 eligible 为空」的退款；all-in 不足额时门槛层判错；主池/边池混淆导致 all-in 玩家赢了不属于自己的池 [R11][R12]。

### 2.4 RNG 与可复现性

- 洗牌标准：**Fisher–Yates**（无偏、52! 全排列可达）配 CSPRNG；种子熵不足是经典攻击面（Planet Poker 32 位种子被穷举的历史事故）[R26][R27]。
- **回放一致性的关键设计**：真实货币平台不公开种子（安全）；观战/AI 平台的常规做法是**每手记录 seed（或完整牌序）到事件流**（`DeckShuffled {seed}` 或 `CardsDealt` 事件全集），使回放端可以：a) 重放事件得到同一结果；b) 用 seed 重算验证。牌类游戏（Slay the Spire / Balatro）的 seed 化 run 是成熟先例 [R28]。
- 建议：每手派生独立 RNG 实例（master seed + handNumber 派生，如 HKDF/SplitMix64），既保证跨手独立又可单独复现 [R28]。

### 2.5 开源参考实现（3-5 个 + 评估器库）

| 项目 | 语言/许可 | 一句话架构点评 | URL |
|------|-----------|----------------|-----|
| `@hivetech/poker-engine` | TypeScript / MIT | 无依赖、确定性 NLHE 纯状态机：`transition(state, command) → {state, events}`，显式领域事件 + 玩家安全投影（redaction），与本平台需求最接近的架构范本 | https://github.com/AlexAllocated/poker-engine [R21] |
| PokerKit | Python / MIT（493★，含 arXiv 论文） | 规则覆盖最全的开源实现（hold'em/短牌/Omaha、ante、showdown 顺序、分池），参数化变异体控制；论文明示评估器性能非首要目标 | https://github.com/uoftcprg/pokerkit ；https://arxiv.org/pdf/2308.07327 [R29] |
| poker-ts | TypeScript / MIT | C++ 引擎的 TS 移植 + React 桌面视图，适合参考观战 UI 与引擎接口切分 | https://github.com/claudijo/poker-ts [R30] |
| fedden/poker_ai | Python / 1587★ | 面向 HUNL 研究的 self-play/CFR 训练框架，引擎侧参考价值一般，agent 侧参考价值高 | https://github.com/fedden/poker_ai [R31] |
| PokerHandEvaluator | C/JS/Python/Java / Apache-2.0 | 多语言高性能评估器（5/6/7 张 + Omaha），适合做对拍基准 | https://github.com/HenryRLee/PokerHandEvaluator [R24] |
| （评估器）treys / pokersolver | Python / JS，MIT | treys = Deuces 移植（查表+位运算，MIT Pokerbots 出身）；pokersolver 是最常用的 JS 评估器 | https://github.com/ihendley/treys ；https://github.com/goldfire/pokersolver [R25][R32] |

### 2.6 牌谱/历史格式（Hand History）对回放设计的启示

- 事实标准是 **PokerStars 风格文本 HH**：header（手号/盲注/桌型/按钮位）→ 座位与码量 → 盲注/ante 行动 → `*** HOLE CARDS ***` → 分街行动 → `*** SUMMARY ***`（总池、board、每座结果）[R33][R34]；arXiv 2308.11753 给出了形式化规格。
- 对本平台启示：a) **事件流即结构化牌谱**——设计事件 schema 时对齐 HH 语义（street 分段、行动记 `seat + action + amount`、summary 汇总），回放端可直接渲染；b) 支持**导出为 PokerStars HH 文本**是一笔小投入大收益的生态位（用户可导入分析工具）；c) HH 的「board + 每座 showed/folded/won」summary 块 = 引擎 `hand-end` 事件的天然 payload 结构 [R33]。

---

## 3. LLM Agent 适配视角

### 3.1 最小决策信息集与引擎应提供的派生量

Agent 必需的原始信息（缺失即无法决策）：自己底牌、座位/位置（相对按钮）、自己码量、各对手码量与状态、当前街、公共牌、各玩家当前街已投入、总池、合法动作集（含 min/max 金额）、本手行动历史（完整 streets）。

派生量该引擎算还是 agent 算？

| 派生量 | 定义 | 建议 |
|--------|------|------|
| toCall / pot odds | 跟注额 ÷（池+跟注额） | **引擎/上下文层算**。纯机械计算，LLM 心算极不可靠，PokerBench 等论文反复证明 GPT-4 级模型常把 pot odds 算错 [R35] |
| min-raise / max-raise 金额 | §1.4 规则 | **必须引擎算**（本就是合法动作集的一部分） |
| effective stack / SPR | 有效码量 = 双方最深可对撞额；SPR = 有效码量/池 | **上下文层算并注入 prompt**（两行代码，消除 agent 系统性误读） |
| 位置标签（UTG/CO/BTN/SB/BB） | 相对按钮 | **上下文层算**。位置是 LLM 最容易消化的形式，不要让 agent 自己数座位 [R35] |
| equity / 胜率 | Monte Carlo 或精确枚举 | **可选注入**（引擎已有 `equity.ts` Monte Carlo 能力但未接入 agent context）；建议作配置项，默认关（避免过度喂招导致 agent 同质化） |
| ICM / bubble pressure | 见 §1.7 | **不给**（策略层，留给 agent 自己或赛后分析） |

原则：**机械量引擎算、策略量 agent 算**——凡是确定性数学（pot odds、min-raise、SPR）由引擎侧提供可显著降低 LLM 非理性动作率 [R35][R36]。

### 3.2 相关 AI 研究一句话背景及其对引擎接口的启示

- **ReBeL**（Meta AI，2020）：自博弈 RL + 搜索，在 HUNL 达超人类；启示：若未来接 RL agent，引擎需要高吞吐 `applyAction` 与可 clone 的轻量 state [R37]。
- **Suphx**（微软，2020，麻将）：深度 RL + oracle guiding/策略蒸馏的超人类麻将 AI；启示：多玩家不完美信息博弈的 AI 研究管线依赖「引擎可批量并发跑局 + 可控随机种子」[R38]。
- **PokerBench**（2025）：LLM 打德扑基准，结论是 vanilla LLM 动作远逊 GTO，微调后改善；其接口把每步决策抽象为（信息集文本, 合法动作集）→ 动作，正是本平台 A2A 模式 [R35]。
- **PokerGPT**（2024）：LLM 端到端多人德扑 solver；**ToolPoker**（OpenReview）：给 LLM 接计算工具（pot odds 等）显著提升理性，验证了 §3.1「机械量引擎算」的结论 [R36][R39]。
- **vals.ai poker benchmark**：17 个前沿模型打 2 万手 10 人 NLHE 的公开横评——说明「多 LLM 同桌打牌」已是业界认可的评测形态，引擎规则正确性是评测公信力的底线 [R40]。

### 3.3 动作校验与容错设计（LLM 输出非法动作的降级链）

业界/论文常见降级链：**parse → normalize → coerce → fallback**：

1. **parse**：结构化输出解析（JSON schema / XML tag），解析失败进入降级；
2. **normalize**：同义词映射（中文「跟注/加注/全下」、口语 "all-in"→`allIn`）；
3. **coerce**：金额夹取到 [min, max]（LLM 常给超码量/低于 min 的数），类型纠偏（raise↔bet、check↔call 依合法集互换）；
4. **fallback**：仍不可用则取「安全动作」——有 check 给 check，否则 fold（**绝不让非法动作静默通过**，且必须记录 `fallbackUsed` 事件供观战与赛后审计）[R35][R36]。

现状仓库的 `response-parser.ts` + 编排层 `coerceToValidAction` 已实现该四级链，属于**值得在新引擎保留的现状优点**。注意点：fallback 偏向 fold 会使弱解析 agent 系统性输码，vals.ai/PokerBench 实践中通常把「有 check 时 fallback=check」写成硬规则以降低惩罚强度 [R35][R40]。

---

## 4. 与现状引擎的差距（审读 `src/games/poker/engine/*.ts`）

现状架构一句话：class-based `PokerEngine`，`applyAction(state, agentId, action) → {nextState, events}`，clone-then-mutate（非严格 immutable），事件附带全量 public state 快照；`context-builder.ts` 自述为 "6-max fixed-limit Texas hold'em"。

| # | 规则点 | 现状（文件/行为） | 差距 |
|---|--------|-------------------|------|
| 1 | 变体/下注制 | `poker-engine.ts:189` 下注额 = preflop/flop 用 SB、turn/river 用 BB；`betsThisStreet < 4` 封顶（硬编码） | 实际是非标准 fixed-limit：canonical fixed-limit 的 small bet = **1 BB**（preflop/flop）、big bet = 2 BB（turn/river）[R1][R10]；用 SB 当 small bet 使 preflop 「加注额 < BB」这种怪态成立。无 no-limit/pot-limit 支持 |
| 2 | `maxBetsPerStreet` 配置 | `poker-types.ts:49` 定义、`match-lifecycle.ts:48` 传 4，但引擎从不读取，硬编码 `< 4` | 配置项形同虚设；新引擎应使 cap 真正可配 |
| 3 | min-raise 规则 | 无 `lastRaiseSize` 追踪；固定增量（+1 个 streetBetSize） | 无法表达 NLHE min-raise = 上次增量 [R1][R7]；all-in 折算、pot-limit 公式更无从谈起 |
| 4 | 不完整全下加注 | `poker-engine.ts:277-280`：任何超过 maxBet 的 all-in 都 `betsThisStreet+=1` 并 `resetOtherActivePlayers` | 违反「不足完整加注不重开行动」：已行动玩家被错误地允许 re-raise [R1][R3] |
| 5 | 街结构/行动顺序（3+ 人） | preflop UTG=BB 后一位；postflop 按钮左一先动；BB option 有（`hasActedThisStreet` 初始 false） | ✅ 基本正确 |
| 6 | Heads-up 顺序 | `smallBlindIndexFor` 2 人时按钮=SB；UTG preflop=按钮；postflop=BB 先 | ✅ 正确（与 TDA/Wikipedia 一致 [R1][R6]）；小瑕疵：2 人判定混入 sittingOut 计数 |
| 7 | 盲注不足（short blind） | `postBlind` 取 `min(chips, amount)` 并置 allIn | ✅ 正确 |
| 8 | Ante（含 BB ante） | 无 | ❌ 缺失（锦标赛语义需要，见 §1.8 [R19][R20]） |
| 9 | 盲注升级（levels） | 整场固定 SB/BB | ❌ 缺失；淘汰赛打到后期盲注占比失衡 |
| 10 | 边池 | `pot-manager.ts` 贡献分层法：按 `totalCommitted` 升序切层、弃牌者贡献保留、各池独立判胜、单资格池直接归赢家 | ✅ 算法正确（与 §1.5 标准算法一致）；小问题：`addToPot` 每次全量重算 sidePots（O(n²)/动作，规模小可接受） |
| 11 | 奇数筹码归属 | `settleHand` 余数逐枚给 `winners` 数组序前者 = 按**贡献额升序**排列的 eligible 顺序 | ❌ 不符 TDA「按钮左侧第一人」[R4][R5]；且分配顺序依赖排序实现，属未定义行为 |
| 12 | 全员 all-in run-out | `advanceStreet` 每次 applyAction 只推进一条街；全 all-in 后 `currentActor=null` 而 `handComplete=false`；`game-master.ts:72` 见 null 即 `finalizeMatch` | ❌ **致命缺陷**：river 之前的全下会导致整场比赛被提前终结、公共牌未发完、奖池未结算（只有恰好 river all-in 才正确）。引擎需要「无人可行动时自动连续 run-out 至摊牌」的内部推进 |
| 13 | 摊牌顺序/muck | `showdownWinners` 直接算赢家，无 reveal 顺序、无 muck 语义；弃牌致胜时不亮牌 | ⚠️ 缺 showdown 事件序列（观战与日志价值）；建议事件流显式建 `reveal`（可配 muck 简化） |
| 14 | best 5 of 7 评估 | `evaluator.ts` 21 组合枚举 + 轮子（A-5）正确处理 + kicker 编码比较 | ✅ 正确（性能见 §2.2，非瓶颈） |
| 15 | 平局分割 | `settleHand` 均分 + 余数逐枚 | ⚠️ 均分正确，余数归属见 #11 |
| 16 | 公共信息隔离 | `createPublicState` 把**所有玩家 holeCards** 放进 public state；agent prompt 侧靠 `context-builder` 只写自己牌 | ⚠️ 引擎层无视角投影（redaction）；完整 state（含全员底牌与牌堆）直接传给 `requestAgentDecision`，公平性依赖上层自觉，架构上应内建 per-seat projection [R21] |
| 17 | RNG/复现性 | `shuffleDeck(createDeck())` 与按钮位都用 `Math.random`，无种子 | ❌ 不可回放复现；`shuffleDeck` 已留 rng 注入参数但引擎未用（§2.4 建议 seed 进事件流） |
| 18 | 事件溯源 | 每动作产出事件，但 `seq: 0` 占位、`makePublicStateEvent` 内嵌全量快照；state 含 `deck` 全量 | ⚠️ 快照式而非事件溯源：无法仅凭事件流重建 state；回放=播快照，审计价值弱（§2.1） |
| 19 | 锦标赛语义 | 淘汰（chips=0 out）、`stopRequested`、按筹码排名 finalize | ⚠️ 有最小淘汰制；无 levels/ante/ICM/payout 表/rebuy（§1.7） |
| 20 | applyAction 防御校验 | bet/raise 只查 `> maxBet` 且 `paid ≤ chips`；不查 min-raise、不查 cap | ⚠️ 依赖 `availableActions` + 上层 coerce；引擎内部校验不完备（越权动作可绕过金额规则） |
| 21 | 烧牌 | 无 burn card | ✅ 可接受（线上惯例，可省略 [R1]） |
| 22 | streetPots 分街统计 | 有（观战筹码图友好） | ✅ 值得保留 |
| 23 | Agent 派生量 | context 仅给码量/当前注/合法动作；`equity.ts` 的 Monte Carlo 未接入 | ⚠️ 无 pot odds/位置标签/SPR/effective stack（§3.1 建议） |

---

## 5. 对新引擎 PRD 的输入清单

### 5.1 建议的规则覆盖范围

**进 v1（正确性底线）**：

- 街结构、盲注（SB/BB，短盲全下）、preflop/postflop 行动顺序、heads-up 特殊顺序；
- fold/check/call/bet/raise/all-in 全动作 + **min-raise 追踪**（含不完整全下不重开行动）；
- 至少一种下注制完整实现：**建议 v1 直接做 no-limit**（观战戏剧性最强、vals.ai/PokerBench 等 LLM 对战事实标准都是 NLHE [R35][R40]），fixed-limit 降级为兼容模式；
- 边池贡献分层法 + 各池独立判胜 + **TDA 奇数筹码规则**（按钮左侧第一人）；
- 全员 all-in 自动 run-out 至摊牌 + 摊牌 reveal 事件序列；
- immutable state + 纯函数 + 领域事件（含单调 seq）+ 种子化 RNG（seed 记入事件）+ per-seat 视角投影。

**列为配置项**：变体（NL/FL/PL）、`maxBetsPerStreet`（FL cap）、ante 类型（无/classic/BB-ante）、盲注升级 schedule（含禁用）、run-it-twice、muck 行为（强制亮牌 vs 允许 muck）、equity/pot odds 注入开关、决赛桌 payout 表、rebuy/addon。

**明确不做（v1）**：ICM 引擎内计算（留给 agent/分析侧，§1.7）、Omaha/短牌等其他游戏（games/ 按游戏分包架构天然隔离）、死按钮完整规则（用简化移位并在规则文档声明）、rake（无真钱语义）、多桌。

### 5.2 开放决策点（需产品拍板）

1. **下注制**：v1 只上 no-limit，还是保留 fixed-limit 兼容现状观战体验？（涉及 UI、prompt、bot 策略全部重校）
2. **锦标赛盲注升级**：要不要 levels？要的话时间制（每 N 手升盲）还是手数制？
3. **ICM/奖池**：决赛 payout 表要不要进 v1？ICM 派生量要不要作为可选 prompt 注入？
4. **Run-it-twice**：观战方差缩小 vs 规则复杂度，是否做成开关？
5. **摊牌亮牌策略**：强制全员亮牌（观战最优）还是保留 muck 权利（更拟真、对 LLM 是额外决策点）？
6. **Agent 信息注入边界**：pot odds/SPR/位置标签注入到什么程度（§3.1 表）；equity 要不要喂（公平性 vs 对战质量）？
7. **回放格式**：事件流 schema 是否对齐 PokerStars HH 语义、要不要支持导出 HH 文本（§2.6）？
8. **公平性约束**：per-seat projection 作为引擎 API 硬边界（推荐）还是编排层约定（现状）？
9. **旧引擎迁移**：新引擎替换还是并行灰度？现有 `actionHistory`/事件 kind 的兼容范围？

---

## 6. 来源

- [R1] Wikipedia: Texas hold 'em — https://en.wikipedia.org/wiki/Texas_hold_%27em
- [R2] Wikipedia: Poker (hand rankings) — https://en.wikipedia.org/wiki/Poker
- [R3] Wikipedia: Betting in poker — https://en.wikipedia.org/wiki/Betting_in_poker
- [R4] Poker TDA 官方规则（odd chip 等） — https://www.pokertda.com/view-poker-tda-rules/
- [R5] Poker TDA Forum: 奇数筹码/死按钮讨论 — https://www.pokertda.com/forum/index.php?topic=265.0
- [R6] Poker TDA Forum: Heads-up 按钮规则 — https://www.pokertda.com/forum/index.php?topic=1494.0
- [R7] Poker StackExchange: min-raise/re-raise — https://poker.stackexchange.com/questions/2729/what-is-the-min-raise-and-min-rereise-in-holdem-no-limit
- [R8] Upswing Poker: Betting Rules（pot 计算） — https://upswingpoker.com/betting-rules/
- [R9] CardPlayer: How to Play PLO（pot-limit 公式通用） — https://www.cardplayer.com/online-poker/how-to-play-pot-limit-omaha
- [R10] Wikipedia: Betting in poker（fixed-limit 小注/大注与封顶） — https://en.wikipedia.org/wiki/Betting_in_poker
- [R11] SoftwareEngineering SE: Poker split/side pots — https://softwareengineering.stackexchange.com/questions/317640/poker-split-side-pots
- [R12] StackOverflow: Distributing side pots — https://stackoverflow.com/questions/62672186/distributing-side-pots-in-poker
- [R13] Wikipedia: Showdown (poker) — https://en.wikipedia.org/wiki/Showdown_(poker)
- [R14] Poker TDA Forum: showdown 顺序 — https://www.pokertda.com/forum/index.php?topic=435.0
- [R15] Wikipedia: Texas hold 'em（锦标赛盲注上升、奖金约 10%） — https://en.wikipedia.org/wiki/Texas_hold_%27em
- [R16] Wikipedia: Independent Chip Model — https://en.wikipedia.org/wiki/Independent_Chip_Model
- [R17] ICMizer: Poker ICM 101 — https://www.icmizer.com/en/blog/poker-icm-101-what-is-icm-poker/ ；GTO Wizard: bubble factor — https://blog.gtowizard.com/what-is-the-bubble-factor-in-poker-tournaments/
- [R18] PrimeDope: Running It Twice — https://www.primedope.com/running-it-twice/ ；PokerNews 词条 — https://www.pokernews.com/pokerterms/running-it-twice.htm
- [R19] Poker StackExchange: Big Blind Ante — https://poker.stackexchange.com/questions/10314/what-is-the-big-blind-ante
- [R20] Poker TDA Forum: BBA/Button ante — https://www.pokertda.com/forum/index.php?topic=1501.0
- [R21] @hivetech/poker-engine（AlexAllocated/poker-engine） — https://github.com/AlexAllocated/poker-engine
- [R22] Cactus Kev's Poker Hand Evaluator — http://suffe.cool/poker/evaluator.html
- [R23] 2+2 evaluator 讨论（.NET 重写/性能） — https://www.reddit.com/r/dotnet/comments/1oe3v4h/i_rewrote_a_classic_poker_hand_evaluator_from/
- [R24] HenryRLee/PokerHandEvaluator — https://github.com/HenryRLee/PokerHandEvaluator
- [R25] ihendley/treys — https://github.com/ihendley/treys
- [R26] Wikipedia: Fisher–Yates shuffle — https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
- [R27] Hacker News: Planet Poker 弱种子事故 — https://news.ycombinator.com/item?id=8164245 ；StackOverflow: Properly seeding a RNG for a card game — https://stackoverflow.com/questions/7312700/properly-seeding-a-rng-for-a-card-game
- [R28] Unity 论坛: seedable deterministic RNG（Slay the Spire/Balatro 先例） — https://discussions.unity.com/t/seedable-deterministic-rng-slay-the-spire-balatro-spelunky-etc/1583758
- [R29] uoftcprg/pokerkit + arXiv:2308.07327 — https://github.com/uoftcprg/pokerkit ；https://arxiv.org/pdf/2308.07327
- [R30] claudijo/poker-ts — https://github.com/claudijo/poker-ts
- [R31] fedden/poker_ai — https://github.com/fedden/poker_ai
- [R32] goldfire/pokersolver — https://github.com/goldfire/pokersolver
- [R33] arXiv:2312.11753 Poker Hand History File Format Specification — https://arxiv.org/html/2312.11753v2
- [R34] Run It Once: Hand History Generator（HH 文本样例） — https://www.runitonce.com/chatter/hand-history-generator/
- [R35] PokerBench: Training LLMs to become Professional Poker Players（arXiv:2501.08328） — https://arxiv.org/html/2501.08328v1
- [R36] PokerGPT（arXiv:2401.06781） — https://www.alphaxiv.org/abs/2401.06781
- [R37] ReBeL（arXiv:2007.13544） — https://arxiv.org/abs/2007.13544
- [R38] Suphx（arXiv:2003.13590） — https://arxiv.org/abs/2003.13590
- [R39] ToolPoker: How Far Are LLMs from Professional Poker Players? — https://openreview.net/forum?id=vV54ShHvGi
- [R40] vals.ai Poker Agent Benchmark — https://vals.ai/benchmarks/poker_agent ；awesome-poker-ai — https://github.com/PokerBotAI/awesome-poker-ai

> 调研快照说明：星级/活跃度为 2026-09-08 查询值；规则以 Wikipedia 与 TDA 官方规则为准，两者冲突时以 TDA 为准（TDA 是线下赛事权威，Wikipedia 覆盖线上惯例）。
