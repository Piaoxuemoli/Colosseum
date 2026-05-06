# 修复盲注位置 & LLM 重复思考 Bug

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复两个 Bug：(1) D/SB/BB 在桌面 UI 上位置不相邻；(2) 同一轮下注中 LLM 玩家被重复调用思考。

**Architecture:** Bug 1 是 UI 层座位布局问题——玩家在配置页被安排到任意座位（如 seat 0/1/3/4/5），但 UI 的 `SEAT_POSITIONS` 按固定 0-5 映射，导致 D/SB/BB 在视觉上可能不相邻。需要在游戏开始时 shuffle 座位分配。Bug 2 是引擎层 `isBettingRoundOver()` 只过滤 `status === 'active'`，当 allIn 玩家被排除后，betting round 可能提前结束或 `nextActiveSeatIndex` 找不到下一个玩家导致重复调用同一玩家。

**Tech Stack:** TypeScript, React, Zustand

---

## Bug 分析

### Bug 1: 盲注位置不相邻

**根因**: 玩家在配置页选择座位后，`seatIndex` 可能不连续（如玩家在 seat 0, 1, 3, 4, 5 而 seat 2 空）。`nextActiveSeatIndex()` 按 seatIndex 顺时针找下一个 active 玩家，所以 D→SB→BB 在逻辑上是正确的连续关系。但是**UI 的 `SEAT_POSITIONS` 把 seatIndex 直接映射到固定的屏幕位置**（bottom, bottom-left, top-left, top, top-right, bottom-right），如果 seat 2 为空，那么 top-left 位置没人，其他人之间就出现了视觉空隙，导致 D/SB/BB 看起来不相邻。

**修复方案**: 在游戏初始化（`startNewHand` 第一手或 `GameEngine` 构造函数）时，随机打乱所有参与玩家的 `seatIndex` 分配，确保它们占据连续的 seat 0, 1, 2, ... N-1，从而在 UI 上紧密相邻。

### Bug 2: LLM 重复思考

**根因**: `isBettingRoundOver()` (game-engine.ts:826-833) 只过滤 `status === 'active'` 的玩家。当有玩家 allIn 后，他们被排除出 `activePlayers`。如果剩余 active 玩家都已 `hasActed && currentBet === highestBet`，betting round 就被判定为结束，可能跳过还需要行动的玩家。另外 `nextActiveSeatIndex()` 也只找 `status === 'active'` 的玩家，当所有 active 玩家都 fold 后回退到 `currentSeatIndex`，同一个玩家可能被再次调用。

**修复方案**: `isBettingRoundOver()` 的判断逻辑需确保在 allIn 玩家存在时正确处理；`advancePhase` 在只剩一个 active + 多个 allIn 时应直接快进到 showdown。

---

## Task 1: 随机分配座位（修复盲注位置不相邻）

**Files:**
- Modify: `src/engine/game-engine.ts:51-110` (constructor)

- [ ] **Step 1: 在 GameEngine 构造函数中 shuffle seatIndex**

在构造函数创建 players 数组后、设置 `this.state` 前，随机打乱玩家的 seatIndex 分配，使所有参与者占据连续的 seat 0 ~ N-1：

```typescript
// 在 players.push(...) 循环之后，this.state = {...} 之前添加：

// Shuffle seat assignments so players occupy consecutive seats 0..N-1
// This ensures D/SB/BB appear visually adjacent on the table
const seatIndices = players.map(p => p.seatIndex)
// Fisher-Yates shuffle
for (let i = seatIndices.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[seatIndices[i], seatIndices[j]] = [seatIndices[j], seatIndices[i]]
}
for (let i = 0; i < players.length; i++) {
  players[i].seatIndex = seatIndices[i]
}
```

等等——这并不能确保连续性。正确做法是将玩家分配到 seat 0, 1, 2, ..., N-1（打乱顺序）：

```typescript
// Shuffle player order, then assign consecutive seatIndices 0..N-1
// This ensures D/SB/BB are visually adjacent on the poker table
for (let i = players.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[players[i], players[j]] = [players[j], players[i]]
}
for (let i = 0; i < players.length; i++) {
  players[i].seatIndex = i
}
```

- [ ] **Step 2: 验证**

启动游戏，确认所有玩家占据连续座位 0~N-1，D/SB/BB 标记在视觉上相邻。

- [ ] **Step 3: Commit**

```bash
git add src/engine/game-engine.ts
git commit -m "fix: shuffle player seats to consecutive indices so D/SB/BB are visually adjacent"
```

---

## Task 2: 修复 isBettingRoundOver 逻辑（修复 LLM 重复思考）

**Files:**
- Modify: `src/engine/game-engine.ts:826-833` (isBettingRoundOver)

- [ ] **Step 1: 分析当前逻辑**

当前代码：
```typescript
private isBettingRoundOver(): boolean {
  const activePlayers = this.state.players.filter(p => p.status === 'active')
  if (activePlayers.length <= 1) return true
  const highestBet = Math.max(...this.state.players.map(p => p.currentBet))
  return activePlayers.every(p => p.hasActed && p.currentBet === highestBet)
}
```

问题：当只剩 1 个 active + N 个 allIn 时，`activePlayers.length <= 1` 返回 true，round 结束。这本身是正确的（只有一个人能继续行动）。但关键问题在 `executeAction` 最后的分支：

```typescript
if (this.isBettingRoundOver()) {
  this.advancePhase()
} else {
  this.state.currentPlayerIndex = this.nextActiveSeatIndex(this.state.currentPlayerIndex)
}
```

当 `isBettingRoundOver()` 返回 false 且 `nextActiveSeatIndex` 回退到 `currentSeatIndex`（因为没有其他 active 玩家了），同一个玩家就会被再次选中。

- [ ] **Step 2: 修复 nextActiveSeatIndex 的回退逻辑**

在 `executeAction` 中，当 `nextActiveSeatIndex` 返回与当前相同的 seat 时，应该结束当前 round：

修改 `src/engine/game-engine.ts:437-442`：

```typescript
// Check if betting round is over
if (this.isBettingRoundOver()) {
  this.advancePhase()
} else {
  const nextSeat = this.nextActiveSeatIndex(this.state.currentPlayerIndex)
  if (nextSeat === this.state.currentPlayerIndex) {
    // No other active player found — round should end
    this.advancePhase()
  } else {
    this.state.currentPlayerIndex = nextSeat
  }
}
```

- [ ] **Step 3: 确保 isBettingRoundOver 在 raise 场景下正确**

当玩家 raise 后，其他玩家的 `hasActed` 需要被重置。检查 `executeAction` 中 raise/bet 分支是否重置了其他人的 `hasActed`。查找代码确认，如果缺失则添加。

在 `executeAction` 的 bet/raise 分支之后（`player.hasActed = true` 之前），需要重置其他 active 玩家的 `hasActed`：

```typescript
// After bet/raise: reset hasActed for other active players so they get a chance to respond
if (action.type === 'bet' || action.type === 'raise' || action.type === 'allIn') {
  for (const p of this.state.players) {
    if (p.id !== player.id && p.status === 'active') {
      p.hasActed = false
    }
  }
}
```

> **注意**: 需要先阅读 executeAction 中 line 412-443 确认是否已有此逻辑。如果已有，跳过此步。

- [ ] **Step 4: 验证**

开一局 6 人游戏，观察右侧 thinking chain，确认同一 round 中没有同一玩家出现两次思考记录。

- [ ] **Step 5: Commit**

```bash
git add src/engine/game-engine.ts
git commit -m "fix: prevent same player being called twice in one betting round

When nextActiveSeatIndex falls back to the same seat (no other active
players), advance the phase instead of re-calling the same player."
```

---

## Task 3: 验证完整流程

- [ ] **Step 1: 集成测试场景**

1. 创建 6 人 LLM 对局，观察：
   - D/SB/BB 标记是否在 UI 上相邻
   - 第二手时 D 是否正确轮转到下家
2. 观察 preflop 有 allIn 的场景：
   - 右侧思考链中同一 round 不应出现同一玩家两次
3. 观察多轮游戏：
   - 每手座位保持不变（只有 D 按钮轮转）

- [ ] **Step 2: 检查控制台日志**

查看浏览器控制台的 `LLM_PROMPT` 日志，确认同一 `handNumber` + `phase` 组合中没有重复的 `playerId`。

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration verification and minor adjustments"
```
