# LLM Poker Arena — 更新路线图

> 版本: v0.2.0 规划
> 日期: 2026-04-03
> 状态: 🚧 进行中

---

## 概览

10 个更新方向 + 若干 Bugfix，按「基础 → 体验 → 架构」分层推进。

### 进度总览

| # | 任务 | 状态 |
|---|------|------|
| 1 | UI 优化 | ✅ 已完成（座位外扩、毡面美化、动画、配置页卡片化） |
| 6 | 思维链修复 | ✅ 已完成 |
| 5 | 对局重连 | ✅ 已完成（showdown 快照 + IndexedDB 持久化 + SetupPage 恢复提示） |
| 7 | 印象系统优化 | ✅ 已完成（结构化 4 维度 L/A/S/H 评分 + EMA 平滑 + 跨对局积累） |
| 9 | 筹码曲线交互优化 | ✅ 已完成（分层渲染 + 透明交互层 + crosshair + 多玩家 tooltip） |
| 3 | 流式输出优化 | ✅ 已完成（关键词高亮 + 自动滚动 + 列表渲染 + 流式自动展开） |
| 11 | Prompt 阶段感知 + 思考气泡同步 | ✅ 已完成（Bugfix） |
| 12 | AI 竞技暂停/恢复 | ✅ 已完成 |
| 2 | 表情系统 | 📋 待定 |
| 4 | Electron 封装 | 📋 待定 |
| 8 | 系统乐高化重构 | 📋 待定 |
| 10 | 第二引擎验证（UNO / 狼人杀） | 📋 待定（依赖 #8） |

---

## 1. 🎨 UI 优化 ✅

**状态**: 已完成

**已完成内容**:
- ✅ 座位位置外扩，解决手牌/气泡与牌桌重叠
- ✅ 头像放大、名字加宽、筹码等宽对齐
- ✅ 侧面座位手牌统一横排
- ✅ 底池与下注筹码间距拉开
- ✅ 公共牌区域增加背景容器
- ✅ 底池移除假筹码、增加 paid icon
- ✅ 毡面 box-shadow 多层边框替换粗 border
- ✅ 阶段指示器增加 icon 和字号
- ✅ 当前行动者脉冲动画
- ✅ 弃牌名字删除线
- ✅ 配置页 section 卡片化
- ✅ 空座位虚线降低 opacity

**未覆盖（可后续补）**:
- 响应式适配 / 移动端友好
- 发牌、筹码飞入动画
- 主题系统（深色/浅色切换）

---

## 2. 😊 表情系统

**目标**: LLM 玩家根据牌局情况表达情绪，增加拟人感

**方案**:
- 定义表情集（得意、紧张、愤怒、淡定、惊讶、bluff 脸等）
- LLM 决策时同时输出表情标签（扩展 `<action>` 格式，增加 `emotion` 字段）
- 表情气泡组件，定时消失
- Bot 玩家也根据策略匹配表情
- 人类玩家可手动发表情

**涉及文件**: `prompt-builder.ts`, `response-parser.ts`, 新增 `EmotionBubble.tsx`, `emotion-types.ts`

**预估工作量**: ⭐⭐

---

## 3. 💬 流式输出组件优化 ✅

**状态**: 已完成

**已完成内容**:
- ✅ **关键词高亮**：金额（`$1,234` 琥珀色）、概率（`67.8%` 天蓝色）、对手名字（tertiary 色）自动高亮
- ✅ **自动滚动**：流式内容自动滚到底部，用户手动上滚时暂停（30px 阈值检测），`scroll-smooth` 平滑过渡
- ✅ **Markdown 列表**：`- item` / `• item` 渲染为带圆点的 flex 布局列表
- ✅ **流式自动展开**：正在流式接收时自动展开 ExpandableThinking，不再折叠截断
- ✅ **流式指示器**：正在思考时标题栏显示脉冲绿点
- ✅ 全部 3 个渲染位置（player bubble / spectator bubble / ThinkingOverlay）统一升级

**涉及文件**: `ThinkingBubble.tsx`

**未覆盖（可后续补）**:
- 打字机逐字动画（当前 React 按 SSE chunk 批量刷新，体感已足够流畅）
- 完整 Markdown AST 渲染（remark/rehype，当前正则覆盖 90% 场景）
- 思考链搜索/过滤

---

## 4. 🖥️ Electron 封装

**目标**: 桌面端应用，脱离浏览器限制

**方案**:
- Electron 主进程 + 渲染进程架构
- 主进程运行 `ops/server/proxy-server.mjs`（无需单独部署服务器）
- `crypto.randomUUID` 等 API 天然可用
- 本地文件系统存储（替代 IndexedDB，可选）
- 自动更新机制（electron-updater）
- 系统托盘、窗口管理
- 打包分发（Windows .exe / macOS .dmg）

**新增文件**: `electron/main.ts`, `electron/preload.ts`, `electron-builder.yml`

**预估工作量**: ⭐⭐⭐

---

## 5. 🔄 对局重连 ✅

**状态**: 已完成

**已完成内容**:
- ✅ Dexie `version(3)` 新增 `gameSnapshots` 表 + `GameSnapshotRecord` 类型
- ✅ `snapshot-service.ts` 提供 save / load / delete 接口
- ✅ `GameEngine.serialize()` / `static restore()` 完整序列化（Map↔Object 转换，deck 省略）
- ✅ `syncState()` 在 showdown 时自动保存快照到 IndexedDB（fire-and-forget）
- ✅ `restoreGame()` action：重建引擎 + 适配器 + 重置模块级锁 + 恢复全部 store 状态
- ✅ `resetGame()` / `endGame()` 自动删除快照
- ✅ SetupPage 启动时检测未完成快照，显示恢复提示 banner（手数 + 时间）
- ✅ "恢复对局"→ 跳转 game 页；"放弃"→ 删除快照

**涉及文件**: `database.ts`, `snapshot-service.ts`(新建), `game-engine.ts`, `game-store.ts`, `SetupPage.tsx`

---

## 6. 🔒 非上帝模式思维链修复 ✅

**状态**: 已完成

**已完成内容**:
- ✅ `game-store.ts` 根据 `viewMode` 过滤 thinking 推送
- ✅ 上帝模式：所有玩家思维链可见
- ✅ 玩家模式：只显示自己的思考指示器
- ✅ ThinkingBubble 组件增加 visible 逻辑

---

## 7. 🧠 印象系统优化 ✅

**状态**: 已完成

**已完成内容**:
- ✅ 结构化 4 维度评分（L 入池意愿 / A 攻击性 / S 抗弃牌 / H 诚实度，各 1-10 分）+ ≤30 字备注
- ✅ EMA 指数移动平均平滑（α=0.3），冷启动直接用 raw，后续手牌加权融合
- ✅ 跨对局持久化：按 `[observerProfileId+targetName]` 存 IndexedDB，新对局自动加载历史印象
- ✅ LLM prompt 升级：系统消息展示 `L=7.2 A=8.0 S=3.1 H=6.5 | 备注 (12手观察)` 格式
- ✅ LLM 输出解析：`<scores>` 标签 + `L=X A=X S=X H=X | 备注` 格式
- ✅ ImpressionPanel UI 改为 4 维度色彩 badge（蓝/红/琥珀/绿）+ 观察手数 + 备注
- ✅ HandDetail 历史页适配结构化印象展示
- ✅ Dexie `version(4)` 新增 `structuredImpressions` 表

**涉及文件**: `player.ts`, `database.ts`, `structured-impression-service.ts`(新建), `ema.ts`(新建), `response-parser.ts`, `prompt-builder.ts`, `impression-manager.ts`, `game-engine.ts`, `game-store.ts`, `ImpressionPanel.tsx`, `HandDetail.tsx`, `history.ts`

**未覆盖（可后续补）**:
- 印象可视化雷达图
- 印象影响决策的可解释性标注

---

## 8. 🧱 系统乐高化重构

**目标**: 参考 Claude Code 三层架构 + OpenClaw 网关模式，将系统拆解为可独立替换的模块，使平台从"德扑专用"升级为"通用 AI Agent 桌游对战平台"

**关键设计决策**:
- 引擎同步: mutation + Gateway clone 包装（德扑引擎几乎不改）
- 事务边界: Gateway 层统一管控（requestAgentAction = 原子事务）

**三层架构**:
```
UI Layer (GamePage 动态加载 plugin.BoardComponent)
    ↕ Zustand Store (game-agnostic)
Gateway Layer (上下文拼装 → LLM → 解析 → 验证 → 执行，完整事务)
    ↕ EngineProtocol<TState, TAction>
Engine Layer (纯状态机，零 UI/LLM 依赖)
```

**可切换模块 (14 个，选游戏后自动联动)**:
引擎、PromptBuilder、ResponseParser、BotStrategy、ImpressionConfig、BoardComponent、SeatComponent、HistoryDetailComponent、SetupComponent、牌型定义、DB Schema、默认配置+提示词、UI 标签(scoreLabel/roundLabel)、排名/Footer/角色标识

**自动联动机制**: 用户选游戏 → `getGame(type)` → 返回 GamePlugin → Store/Gateway/Pages 全部从这一个对象读取所有子模块，零手动切换

**代码审计** (34 个耦合点): 12 CRITICAL + 8 HIGH + 8 MEDIUM + 6 LOW，涵盖相位系统、公共牌、盲注、手牌评估、座位数(硬编码6)、CSS主题、Debug工具、排名面板、默认提示词等

**不可切换共享层**: llm-client、player-adapter、Gateway、ema.ts、ThinkingBubble、ImpressionPanel、game-store

**导航保护**: 对局中禁止进配置页/切换游戏，允许进历史页

**5 阶段迁移** (德扑全程可用):
1. 提取协议接口 + base types (2-3天)
2. 搬迁德扑代码到 games/poker/ (3-4天)
3. 实现 Gateway + 德扑适配 Protocol (3-4天)
4. Store + Pages 切换到 Gateway (2-3天)
5. 斗地主骨架验证 (2-3天)

**详细方案**: 见 `.claude-internal/plans/smooth-sauteeing-newt.md`

**预估工作量**: ⭐⭐⭐⭐⭐

---

## 9. 📊 筹码曲线交互优化 ✅

**状态**: 已完成

**问题**: area fill 按玩家顺序叠加绘制，后绘制的填充区域遮挡前面玩家的 circle 节点，SVG 事件模型导致 `onMouseEnter` 只能触发最上层元素，hover tooltip 完全失效

**已完成内容**:
- ✅ **分层渲染架构**：将 area fill / line stroke / data dots / 交互层严格分为 4 层，所有渲染层设 `pointer-events: none`
- ✅ **透明交互叠加层**：顶层 `<rect fill="transparent">` 捕获所有鼠标事件，彻底解决遮挡问题
- ✅ **最近点检测**：`onMouseMove` 中通过 SVG 坐标变换找到最近手数（x 轴）+ 最近玩家（y 轴）
- ✅ **Crosshair 竖线**：虚线贯穿图表辅助对齐 x 轴手数
- ✅ **多玩家 Tooltip**：悬浮时显示该手所有玩家筹码（按金额降序），彩色圆点 + 右对齐金额，自动避免溢出
- ✅ **高亮放大点**：crosshair 所在手数的所有玩家数据点放大高亮

**涉及文件**: `ChipChart.tsx`

---

## 10. 🎲 第二引擎验证 — 斗地主

**目标**: 在 #8 乐高化 Phase 5，实现斗地主引擎验证 GamePlugin 通用性

**范围**: 3人基础斗地主（单张/对子/三带/顺子/炸弹，不含复杂链子）

**验证标准**:
- 新引擎只需实现 `EngineProtocol<DoudizhuState, DoudizhuAction, DoudizhuConfig>`
- 首页可选"德州扑克"或"斗地主"
- 斗地主配置页显示"底分"而非"盲注"（plugin.SetupComponent）
- LLM 收到斗地主专属提示（plugin.PromptBuilder）
- 历史页显示出牌回放而非按街回放（plugin.HistoryDetailComponent）
- 分数曲线标签显示"积分"而非"筹码"（plugin.meta.scoreLabel）
- 印象维度为 攻击性/配合度/记牌能力（plugin.ImpressionConfig）
- 现有德扑功能零回归

**依赖**: #8 Phase 1-4 完成

**预估工作量**: ⭐⭐⭐

---

## 11. 🐛 Prompt 阶段感知 + 思考气泡同步 ✅

**状态**: 已完成（Bugfix）

**问题 A — 思考气泡与牌桌不同步**:
- `llmThoughts[playerId]` 在整手牌期间从不清空，阶段切换（如 turn→river）后旧思考内容仍显示
- 用户看到：牌桌已显示 5 张公共牌（River），但气泡还写着"转牌发了 K♠，听牌..."

**问题 B — LLM 河牌还说"听牌"**:
- System Prompt 只说了下注结构，未解释发牌流程和各阶段语义
- LLM 不知道河牌 = 最后一张公共牌，不存在"听牌"概念

**已完成内容**:
- ✅ `game-store.ts` — `syncState()` 检测 phase 变化时清空 `llmThoughts: {}`，旧思考立即消失
- ✅ `prompt-builder.ts` — System Message 新增发牌流程说明 + "河牌后手牌已定型，不存在听牌"
- ✅ `prompt-builder.ts` — Decision Request 公共牌行追加阶段感知提示（翻牌"还将发2张" / 河牌"不会再发牌"）

**涉及文件**: `game-store.ts`, `prompt-builder.ts`

---

## 12. ⏸️ AI 竞技暂停/恢复 ✅

**状态**: 已完成

**问题**: "停止竞技"按钮直接终止 autoPlay 且无法恢复，用户想暂停观察后继续需要重新点"AI 竞技"从头开始

**已完成内容**:
- ✅ "停止竞技"（红色 stop）→ "暂停竞技"（琥珀色 pause icon）
- ✅ 暂停后显示"继续竞技"（play_arrow icon）而非通用的"AI 竞技"
- ✅ 通过 `autoPlayHandCount > 0 && !autoPlay` 区分"暂停"和"从未开始"，无需新增 store 状态
- ✅ 恢复时调用 `setAutoPlay(true) + startNewHand()` 无缝续接，引擎状态完整保留
- ✅ Player View + Spectator View 统一适配

**涉及文件**: `GamePage.tsx`

---

## 优先级建议（待讨论）

| 优先级 | 任务 | 理由 |
|--------|------|------|
| P0 | ~~6. 思维链修复~~ | ✅ 已完成 |
| P0 | ~~11. Prompt 阶段感知 + 气泡同步~~ | ✅ 已完成（Bugfix） |
| P1 | ~~9. 筹码曲线交互优化~~ | ✅ 已完成 |
| P1 | ~~3. 流式输出优化~~ | ✅ 已完成 |
| P1 | ~~1. UI 优化~~ | ✅ 已完成 |
| P1 | ~~12. AI 竞技暂停/恢复~~ | ✅ 已完成 |
| P2 | 2. 表情系统 | 趣味性提升，依赖 UI 优化后的基础 |
| P2 | ~~5. 对局重连~~ | ✅ 已完成 |
| P2 | ~~7. 印象系统优化~~ | ✅ 已完成 |
| P3 | 8. 系统乐高化 | 最大改动，三层解耦为未来扩展铺路 |
| P3 | 4. Electron 封装 | 锦上添花，等架构稳定后做 |
| P4 | 10. 第二引擎验证 | 依赖 #8 完成，验证 Protocol 通用性 |

---

## 备注

- 每个任务开始前会在 `docs/` 下创建详细设计文档
- 大任务（3、8）可拆为多个 PR
- #8 乐高化 + #10 第二引擎是简历核心亮点，建议连续推进
- 优先级和顺序待确认后开始执行
