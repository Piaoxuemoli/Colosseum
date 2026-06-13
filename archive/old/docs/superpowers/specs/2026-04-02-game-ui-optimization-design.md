# 对局内 UI 优化设计

## 目标

优化观战模式下的牌桌 UI，解决两个核心问题：**空间利用不合理**和**视觉层级混乱**。

具体痛点：
- 牌桌太小，玩家之间间距不够，气泡没有足够空间
- 上帝视角手牌遮挡筹码
- 每个玩家的下注金额没有在桌面上同步显示
- 关键事件（All-In/大加注）缺乏视觉强调
- 当前行动玩家不够突出（但也不能太刺眼）
- 右侧边栏四个 section 全部平铺，信息拥挤层级不分明

## 设计方案

### 1. 座位组件：圆形头像 + 水平信息布局

**替换当前竖向卡片式座位**（w-24 的 PlayerSeat），改为圆形头像 + 名字/筹码水平排列。

#### 头像方向自适应

- `top` / `top-left` / `top-right` 座位：头像在左，信息在右
- `bottom` / `bottom-left` / `bottom-right` 座位：信息在左，头像在右
- 信息总是朝向牌桌外侧，不被桌面遮挡

#### 头像规格

- 尺寸：52×52px 圆形（`rounded-full`）
- 背景：`bg-surface-container-high`（#28283d）
- 图标：Material Symbols — `person`(human) / `smart_toy`(LLM) / `target`(bot)
- 名字：11px font-bold
- 筹码：14px font-black

#### 边框色表示类型

| 玩家类型 | 边框色 | Token |
|---------|--------|-------|
| Human | `border-tertiary` (#a4c9ff 蓝) | 始终显示 |
| LLM | `border-transparent` (默认无色) | 思考中变 primary |
| Bot | `border-secondary` (#e9c349 金) | 始终显示 |

#### 徽章 D/SB/BB

- 位置：头像左上（上方座位）或右上（下方座位）
- 大小：20×20px 圆形
- D = `bg-secondary text-on-secondary`（金色）
- SB = `bg-tertiary-container text-on-tertiary-container`
- BB = `bg-primary-container text-on-primary-container`
- 外圈：`border-2 border-background` 分隔

#### 玩家状态

| 状态 | 视觉 |
|------|------|
| **正在思考** | primary 边框 + `box-shadow: 0 0 14px rgba(161,212,148,0.3)` + 右下角 spinner 指示器(⟳ + 秒数) |
| **Folded** | `opacity-0.35` + `grayscale(0.6)` + 灰色边框 + 红色 "FOLDED" 替代筹码 |
| **All-In** | error 边框 + `box-shadow: 0 0 12px rgba(255,180,171,0.25)` + 红色 "ALL IN" 替代筹码 + 渐变 ALL IN 标签 |
| **Eliminated** | `opacity-0.3` + `grayscale` + 灰色边框 |

### 2. 手牌位置：朝外放置

手牌放在座位的**外侧方向**（远离牌桌），避免遮挡座位信息和桌面内容。

| 座位位置 | 手牌方向 |
|---------|---------|
| `top` | 上方 |
| `bottom` | 下方 |
| `top-left` / `bottom-left` | 左侧 |
| `top-right` / `bottom-right` | 右侧 |

- 手牌尺寸：26×36px（观战模式），28×40px（玩家模式 hero）
- Folded 玩家：观战模式显示灰色牌背（`bg-gray-600 opacity-0.4`），玩家模式不显示
- Hero 第一张牌：`border-primary` + 微弱 glow

### 3. 下注筹码：桌面内侧显示

每个玩家的当前下注额在**牌桌绿毡内侧**显示，靠近对应玩家的桌面边缘。

#### 筹码样式

- 圆形筹码图标：16×16px，`background: linear-gradient(135deg, #e9c349, #b8962e)`，`border: 1.5px dashed rgba(255,255,255,0.3)`
- 金额文字：11px font-weight-800 `text-secondary`
- 位置：absolute 定位，在桌面椭圆内侧，按座位方向放置

#### 加注/All-In 强调

- 普通下注（call/bet/blind）：金色筹码 + 金色数字
- 加注（raise）：红色筹码 + 红色数字 + "加注" 文字标签
- All-In：红色筹码 + 红色数字（桌面筹码也变红）
- Folded 玩家：不显示下注筹码（已收入底池）

### 4. 思考气泡：三阶段流程

#### 阶段一：开始思考

仅头像指示器变化：
- 边框变 primary (#a1d494)
- 添加 glow：`box-shadow: 0 0 14px rgba(161,212,148,0.3)`
- 右下角显示 spinner 指示器：绿色圆形 badge，包含旋转 ⟳ 图标 + 秒数
- 有限时：显示剩余秒数；无限时：显示已用秒数

#### 阶段二：流式内容到达

Floating UI 气泡展开（保持现有 `@floating-ui/react` 方案）：
- 自动选择最佳方向：`autoPlacement({ allowedPlacements: ['left','right','top','bottom'] })`
- 气泡样式：`bg-surface-container-high border border-primary/20 rounded-xl`
- 宽度：`w-56`（224px）
- 顶部：`🧠 思考链 (CoT) · Xs` 绿色标题
- 内容：`text-[10px] italic text-on-surface-variant` 可展开
- 点击气泡可展开/折叠，默认 `line-clamp-3`

#### 阶段三：决策完成

- 气泡消失
- 头像下方短暂显示动作标签（1s 后淡出）
- 标签样式按动作类型着色（见关键事件部分）
- 边框和 glow 恢复

### 5. 关键事件强调

三档视觉层级，静态着色而非动画，微妙但可辨识：

| 事件 | 头像边框 | Glow | 动作标签 |
|------|---------|------|---------|
| **All-In** | `border-error` 红 | 红色 `rgba(255,180,171,0.25)` | 渐变红 `linear-gradient(135deg,#ff6b6b,#ee5a24)` 白字 |
| **大加注（≥3x BB）** | `border-secondary` 金 (短暂) | 金色 `rgba(233,195,73,0.2)` | `bg-secondary text-on-secondary` 金色 |
| **普通动作** | 无变化 | 无 | 半透明背景 + 对应颜色文字，1s 淡出 |

普通动作标签颜色：
- Call：`bg-tertiary/15 text-tertiary`
- Check：`bg-white/8 text-on-surface-variant`
- Fold：`bg-error/10 text-error`
- Bet：`bg-primary/15 text-primary`

### 6. 牌桌布局

#### 牌桌本体

- **等比例放大**：从 `max-w-5xl` 改为 `max-w-7xl`，保持 `aspect-[2/1]` 椭圆形状不变
- 其他样式不变：`rounded-[200px]`、`border-[12px] border-surface-container-high`、`poker-table-gradient`

#### 中央区域三层

1. **顶层**：Phase badge（翻前/翻牌/转牌/河牌），位于桌面上部
2. **中层**：公共牌，水平居中
3. **底层**：底池显示，位于公共牌下方

三层互不重叠，各有明确区域。

#### 座位定位

6 个座位用百分比/绝对定位围绕椭圆分布，因牌桌放大，座位之间间距自然增大，为气泡和手牌留出更多空间。

### 7. 右侧边栏：Tab 分页

将当前四个平铺 section 改为三个 Tab + 固定底部排名。

#### Tab 栏

三个 Tab 等宽排列：
- **📋 日志**：当前手的 action log，按 phase 分组
- **🧠 思考链**：所有 LLM 思考记录，Tab 上 badge 显示总数
- **📊 数据**：概率矩阵 + 胜率统计

激活状态：`text-primary border-b-2 border-primary`
非激活：`text-on-surface-variant/35`

#### 思考链新内容通知

- 新思考到达时：🧠 Tab 上的数字 badge 短暂高亮闪烁（1s）
- 不自动切换 Tab，不打断当前观看
- Badge 样式：`bg-primary/20 text-primary rounded-full text-[7px] px-1`

#### 固定底部排名

不论当前哪个 Tab，底部始终显示紧凑排名面板：
- 固定在侧边栏底部，`border-t` 分隔
- 紧凑 pill 样式：每个玩家一行 `🥇 Name $chips`
- 第一名高亮：`bg-primary/8`
- 显示当前手数

## 不变的部分

- 右侧边栏宽度（`w-80`）不变
- 左侧导航栏（`ml-20`）不变
- ActionPanel（底部操作面板）不变
- MD3 设计 token 和配色方案不变
- ThinkingOverlay（点击展开的全屏思考弹窗）不变
- RankingPanel（对局结束排名弹窗）不变
- 整体页面结构（navbar + main + aside）不变

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/components/game/PlayerSeat.tsx` | **重构** — 圆形头像 + 水平布局 + 手牌朝外 + 状态样式 |
| `src/components/game/PokerTable.tsx` | 放大牌桌（max-w-7xl）+ 调整座位定位百分比 + 下注筹码位置 |
| `src/components/game/ThinkingBubble.tsx` | 调整三阶段流程 + 动作标签闪现 |
| `src/components/game/ActionLog.tsx` | **重构** — Tab 分页（日志/思考链/数据）|
| `src/components/game/LiveRanking.tsx` | 改为固定底部紧凑 pill 样式 |
| `src/pages/GamePage.tsx` | 更新 `enginePlayerToMock` 适配新座位数据结构 |
