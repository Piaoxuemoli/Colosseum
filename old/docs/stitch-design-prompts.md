# Stitch Design Prompts — LLM Poker Arena

> 用于 Stitch 生成 UI 设计稿的提示词集合。Desktop 1440px，MD3 暗色主题。
> 日期: 2026-04-07

---

## 全局设计系统

**在 Stitch 中先创建 Design System，再生成各页面。**

- **Color Mode**: DARK
- **Primary**: `#a1d494` (sage green，扑克毡面色)
- **Secondary**: `#e9c349` (warm gold，筹码/金额高亮)
- **Tertiary**: `#a4c9ff` (soft blue，人类玩家/信息标注)
- **Background**: `#111125` (deep indigo-black)
- **Surface**: `#1a1a2e` (dark navy)
- **Headline Font**: Manrope (bold, geometric)
- **Body Font**: Inter (clean, readable)
- **Roundness**: ROUND_FOUR (2-4px，锐利现代感)
- **Style**: Material Design 3 tokens + glassmorphism panels

---

## Screen 1: 首页 — 游戏选择 (Home / Game Selector)

```
Desktop 1440x900 dark UI. LLM Poker Arena home screen — a game selection hub.

Background: solid #111125 with very subtle radial gradient glow at center (sage green, 3% opacity).

Top: Logo area — "LLM Poker Arena" in Manrope bold 32px, color #e2e0fc. Subtitle below: "让 AI 在牌桌上博弈" in Inter 14px, color #8c9387.

Center: 2 large game selection cards side by side (480px wide each, 280px tall), 32px gap.

Card 1 — "德州扑克" (Texas Hold'em):
- Background: glass panel (rgba(51,51,72,0.6) + backdrop-blur-24px), border 1px #42493e, rounded-lg (4px)
- Top section: large poker table illustration or icon (green felt ellipse with 5 community cards fanned)
- Title: "德州扑克" Manrope bold 24px, #e2e0fc
- Subtitle: "6-max 无限注 · AI 自主对弈" Inter 13px, #8c9387
- Bottom: green primary button "开始配置 →" bg #2d5a27, text #a1d494, rounded-sm
- Hover state: border glows sage green, slight scale-up

Card 2 — "斗地主" (Coming Soon):
- Same glass panel style but 40% opacity, desaturated
- Overlay badge: "即将推出" in #e9c349 on dark pill
- Grayed out, no hover interaction

Bottom: thin footer — "v0.2.0 · Powered by LLM" in 11px #8c9387

Overall feel: clean, spacious, premium dark lobby. Like a high-end game launcher, not a casino. Minimal elements, maximum presence.
```

---

## Screen 2: 配置页 — 对局设置 (Setup Page)

```
Desktop 1440x900 dark UI. Game setup/configuration page for Texas Hold'em poker.

Background: #111125 solid.

Top navbar: h-64px, bg #0c0c1f. Left: back arrow + "对局配置" Manrope bold 18px. Right: "LLM Poker Arena" small logo.

Main content: 3-column grid layout below navbar, 24px gap, max-width 1200px centered, each column a glass-panel card.

=== Column 1: "API 配置" (API Profiles) ===
Glass card (rgba(51,51,72,0.6), blur-24, border #42493e, rounded 4px).
Header: "API 配置" with material icon "key" in #a4c9ff, Manrope semibold 16px.
Content: List of 2-3 API profile items, each a row:
  - Provider icon (OpenAI logo placeholder / Anthropic "A")
  - Name: "GPT-4o" bold, endpoint URL below in 11px #8c9387
  - Right: edit icon button + delete icon button, #8c9387
Bottom of card: "+ 添加配置" text button in #a4c9ff

=== Column 2: "座位配置" (Seat Assignment) ===
Glass card, same style.
Header: "座位配置" with icon "event_seat" in #e9c349.
Content: 6 seat rows, each:
  - Seat number badge: "1" in small circle
  - Seat name input field (dark bg #1e1e32, border #42493e, rounded-sm)
  - Type selector: dropdown or segmented control — "人类 / LLM / Bot / 空" 
    - Human icon: person (blue #a4c9ff)
    - LLM icon: smart_toy (primary #a1d494)
    - Bot icon: target (gold #e9c349)
    - Empty: dashed outline
  - If LLM: API profile selector dropdown
Filled seats show solid left border color matching their type.
Empty seats show dashed border, 40% opacity.

=== Column 3: "游戏参数" (Game Parameters) ===
Glass card, same style.
Header: "游戏参数" with icon "tune" in #a1d494.
Content stacked vertically:
  - "起始筹码" — number input, default 1000, $ prefix
  - "小盲注" — number input, default 5
  - "思考超时" — number input with "秒" suffix, 0 = 无限制 caption
  - "系统提示词" — textarea (4 rows, monospace, dark bg), placeholder showing poker strategy hint
  - Each input: label in 12px #c2c9bb above, input bg #1e1e32, border #42493e, focus border #a1d494

Bottom bar: fixed at bottom, h-72px, bg #0c0c1f, border-top 1px #42493e.
Center: large button "开始游戏" bg gradient from #2d5a27 to #3d7a35, text #bcf0ae Manrope bold 16px, px-48, rounded-sm. Icon "play_arrow" left.
Disabled state if <2 players seated.

Overall: organized, card-based, clear hierarchy. Professional settings panel feel.
```

---

## Screen 3: 牌桌主界面 — 玩家视角 (Game Table — Player View)

```
Desktop 1440x900 dark UI. Main poker game table — player perspective (hero at bottom).

Layout structure:
- Left sidebar: w-80px, bg #0c0c1f, icons for navigation (home/settings/history)
- Right sidebar: w-320px, action log panel
- Center: poker table area (remaining width)
- Bottom: action panel bar (when it's hero's turn)

=== Poker Table (Center) ===
Large elliptical poker table, aspect ratio ~2:1, max-width ~900px, centered.
Table surface: radial gradient — center #3d7a35, edges #2d5a27, outer #1a3d18.
Felt texture: very subtle fabric pattern overlay at 3% opacity.
Table edge: multi-layer shadow — inset shadow, then 4px dark green border (#1a3d18), then 3px gold tint ring (rgba(233,195,73,0.12)), then soft drop shadow.
Subtle light hotspot: elliptical white glow at top-center of felt, 3% opacity (table lamp effect).

=== Community Cards (Table Center) ===
5 card slots in a horizontal row at table center, 12px spacing.
3 cards revealed (Flop): Ah, Kd, 7c — each card 72x104px, white bg rounded-lg, rank top-left + suit icon.
  - Hearts/Diamonds: red (#ef4444)
  - Spades/Clubs: dark gray (#374151)
2 remaining slots: subtle dark placeholder outlines.
Below cards: phase badge — "翻牌" with icon "style" on pill bg rgba(45,90,39,0.3), text #a1d494, 12px.

=== Pot Display (Above Community Cards) ===
Text style: "底池: $450" in Manrope bold 18px, #e9c349 (gold). Small paid icon left.
If side pots: smaller text below "边池1: $200" in 12px #c2c9bb.

=== 6 Player Seats (Around Table) ===
Arranged in oval: bottom-center (hero), bottom-left, top-left, top-center, top-right, bottom-right.

Each seat component:
- Avatar: 56x56px circle, border-3px, type-colored border (blue for human, gold for bot, transparent for LLM)
- Below avatar: player name in 12px bold, truncated max-width
- Below name: chip count "$1,250" in Manrope semibold, #e2e0fc (human: #a4c9ff)
- Below chips: 2 hole cards (mini 48x68px each), slightly overlapping
  - Hero (bottom): cards face up, slight upward hover offset, subtle glow
  - Others: cards face down (dark backs with subtle pattern)
- Position badge: small circle (20px) overlapping avatar top-right — "D" (green), "SB" (gold), "BB" (blue)
- If player bet this round: bet chip near table edge — small gradient circle (red/yellow) with "$50" text

Active player (currently thinking):
- Avatar border: sage green #a1d494, pulsing glow animation
- Countdown badge on avatar: "12s" in small circle, bg #2d5a27

Folded player:
- Entire seat at 35% opacity, name has strikethrough, cards hidden

=== Thinking Bubble (Floating) ===
One player (Seat 3, top-left) is currently thinking.
Floating bubble positioned to the left of their seat using smart placement.
Bubble: glass panel (rgba(40,40,61,0.95), blur-24, border #42493e, rounded 8px), max-width 280px.
Header: "🧠 思考链" 11px bold, with pulsing green dot indicator.
Content: 3-4 lines of Chinese thinking text, 12px Inter:
  "对手在翻牌加注，可能有顶对或听牌..."
  Highlighted: "$450" in amber, "67%" in sky blue, player name "Alice" in #a4c9ff.
Small arrow pointing toward the player's avatar.
Expandable: "展开全部 ▼" link at bottom if content is long.

=== Action Panel (Bottom, Hero's Turn) ===
Fixed bar at bottom, h-96px, bg rgba(12,12,31,0.95) with top border 1px #42493e.
Left section: "我的手牌: A♠ K♥" with mini card icons. "当前需付: $100"
Right section: 4 action buttons in a row, 12px gap:
  - "弃牌" — bg #93000a/30, text #ffb4ab, icon "close"
  - "跟注 $100" — bg #005193/30, text #a4c9ff, icon "done", shadow glow blue
  - "加注" — bg gradient #2d5a27→#3d7a35, text #bcf0ae, icon "trending_up", largest button
  - Raise amount: slider or input field between call and raise buttons
All buttons: rounded-sm, Manrope semibold 14px, h-44px, min-w-100px.

=== Right Sidebar: Action Log ===
w-320px, bg #0c0c1f, border-left 1px #42493e.
Top: 3 tab buttons — "日志 | 思考 | 数据", active tab has primary underline.
Log tab active: scrollable list of actions:
  - Phase header: "── 翻牌 ──" centered, muted text
  - Action entries: "[Alice] 加注 → $200" with colored action text (raise=green, fold=red, call=blue)
  - Auto-scrolls to bottom, latest entry highlighted briefly

Overall mood: immersive dark poker room. Green felt table floating in deep space. Glass panels for UI overlays. Gold accents for money. Blue accents for human player. Green for AI activity. Clean, premium, focused on the game.
```

---

## Screen 4: 牌桌主界面 — 上帝视角 (Game Table — Spectator/God View)

```
Desktop 1440x900 dark UI. Poker table in spectator "God Mode" — all cards visible, analytics overlay.

Same base layout as Player View but with key differences:

=== Table Differences ===
- Table gradient is darker/subtler: center #2d5a27 fading to #111125 (spectator gradient)
- ALL player hole cards are face-up and visible (not just hero)
- No action panel at bottom (spectator can't act)

=== All Cards Visible ===
Each of the 6 seats shows their 2 hole cards face-up:
- Cards rendered in "detailed" mode (72x104px) with rank, suit, corner decorations
- Winning hand: subtle gold border glow on their cards

=== Live Ranking Panel (Left Overlay) ===
Floating glass panel on left side, w-200px:
- Title: "实时排名" Manrope bold 14px
- Ranked list of players by chip count:
  1. "🥇 Bob — $2,450" (gold accent)
  2. "🥈 Alice — $1,800" 
  3. etc.
- Delta indicators: "+$350 ▲" green or "-$200 ▼" red next to each
- Compact, semi-transparent, doesn't obstruct table

=== Thinking Bubbles (Multiple) ===
In God Mode, multiple thinking bubbles can be visible simultaneously.
Show 2 players' thinking bubbles at once — smart positioned to avoid overlap.
Same glass panel style, but slightly more compact in spectator mode.

=== Right Sidebar: Data Tab Active ===
"数据" tab selected, showing:
- Win probability matrix:
  - Each player's name + colored bar showing win % 
  - "Bob 45%" long green bar, "Alice 30%" medium blue bar, etc.
  - Updates in real-time as community cards are revealed
- Below: equity numbers in small text

=== Spectator Badge ===
Top-center floating pill: "👁 上帝视角" with eye icon, bg rgba(233,195,73,0.2), text #e9c349, subtle.

Overall: same premium dark aesthetic, but more analytical. Emphasis on information density — all cards shown, probability bars, ranking overlay. The "mission control" view of the poker game.
```

---

## Screen 5: 历史回顾页 (History Page)

```
Desktop 1440x900 dark UI. Game history review page — browsing past poker sessions and hand details.

Background: #111125 solid.
Top navbar: same as setup page — back arrow + "对局历史" + logo.

=== Left Panel: Session List (w-320px) ===
Glass panel sidebar, bg rgba(26,26,46,0.8).
Header: "历史对局" Manrope bold 16px, with icon "history" in #a4c9ff.
Filter/search bar: input field at top, bg #1e1e32, placeholder "搜索对局..."

List of session cards, each ~80px tall:
- Date: "2026-04-07 15:30" in 11px #8c9387
- Players: "Alice, Bob, GPT-4o, Claude" in 12px #e2e0fc
- Hands played: "共 24 手" badge
- Result summary: "+$450" green or "-$200" red
- Active session: left border 3px #a1d494
Scrollable, selected session highlighted with bg #1e1e32.

=== Right Panel: Hand Detail (remaining width) ===
Main content area showing selected hand's replay.

Top section: Hand info bar
- "Hand #15 · 翻牌" phase badge, blind info "盲注 5/10"
- Tab row: "翻前 | 翻牌 | 转牌 | 河牌 | 摊牌" — each tab clickable, active has primary underline

Middle section: Action timeline for selected phase
- Vertical timeline with connected dots:
  - "Alice (SB) 跟注 $10" — blue dot
  - "Bob (BB) 加注 → $30" — green dot with amount highlighted gold
  - "GPT-4o 弃牌" — red dot, name in strikethrough
  - Each entry: player avatar (24px) + name + action + amount
  - Expandable thinking chain for LLM players: click to reveal their reasoning

Bottom section: Board state
- Community cards shown for selected phase
- Player hands revealed (if showdown reached)
- Pot amount at that point

=== Chip Chart (Below or Toggleable) ===
Full-width SVG line chart showing chip progression across all hands in the session.
- X-axis: hand number (1, 2, 3...)
- Y-axis: chip amount ($)
- One colored line per player (using their type colors)
- Area fill under lines at 15% opacity
- Crosshair on hover: vertical dashed line + multi-player tooltip
  - Tooltip: glass panel listing all players' chips at that hand, sorted descending
  - Colored dots matching player lines
- Currently hovered hand's data points enlarged (6px → 10px circles)
- Legend at top: player names with colored circles

Colors: Each player gets a distinct color from the palette — primary green, secondary gold, tertiary blue, error coral, plus purple and teal for remaining seats.

Overall: clean data-driven review interface. Left = browse sessions, Right = deep dive into hand-by-hand replay. Analytical but still visually polished.
```

---

## Screen 6: 排名弹窗 (Ranking Panel — End of Game)

```
Desktop 1440x900 dark UI. End-of-game ranking modal overlay on top of the poker table.

Background: poker table visible but darkened with overlay rgba(17,17,37,0.85).

=== Modal Panel (Center) ===
Centered card, w-520px, glass panel style (rgba(51,51,72,0.8), blur-32, border #42493e, rounded-lg).

Header: "对局结束" Manrope bold 24px, #e2e0fc. Subtitle: "共 32 手 · 用时 45 分钟" in 13px #8c9387.

=== Ranking List ===
Vertical list, each player row h-64px, 8px gap:

1st place row:
- Large "🥇" emoji or gold trophy icon
- Avatar 48px with gold border, pulsing subtle glow
- Name: "GPT-4o" Manrope bold 18px
- Chips: "$2,850" in gold #e9c349, large
- Delta: "+$1,850" in green #a1d494 with up arrow
- Background: subtle gold gradient tint (rgba(233,195,73,0.05))

2nd place row:
- "🥈" silver
- Avatar 40px
- Name + chips + delta ("+$450" green)

3rd place row:
- "🥉" bronze
- Normal styling, delta might be red ("-$300" #ffb4ab with down arrow)

4th-6th: smaller rows, no medal, red deltas for losers

=== Separator Line ===
Thin 1px #42493e divider.

=== Stats Summary ===
Small grid below rankings:
- "最大底池: $1,200" | "最多全下: Bob (3次)" | "最长思考: Claude (45s)"
In 12px #c2c9bb, icon + text pairs.

=== Action Buttons (Bottom) ===
Two buttons centered:
- "再来一局" — primary button, bg gradient green, text #bcf0ae, icon "replay"
- "返回首页" — ghost button, border #42493e, text #c2c9bb, icon "home"
12px gap between buttons.

Overall: celebration moment but tasteful. Not over-the-top confetti — clean, data-focused result summary with clear visual hierarchy for rankings. The gold/green/red color system tells the win/loss story at a glance.
```

---

## Screen 7: 印象面板 (Impression Panel — Slide-in Drawer)

```
Desktop dark UI. Slide-in drawer panel from right side, overlaying the game table.

=== Drawer Panel ===
w-360px, slides in from right. bg #0c0c1f, border-left 1px #42493e.
Entry animation: slide-in-left 0.2s ease-out.

Header: "🧠 对手印象" Manrope bold 16px, #e2e0fc. Close "✕" button top-right.
Subtitle: "GPT-4o 视角" in 12px #8c9387 (which LLM's impressions we're viewing).

=== Impression Cards (One per opponent) ===
Each card: glass panel, rounded 4px, mb-12px, p-16px.

Player header row:
- Avatar 32px + name "Alice" bold 14px + type badge "人类" in tiny pill

4-Dimension Score Badges (horizontal row):
- L=7.2 — blue badge (#a4c9ff bg at 15%), label "入池" below in 9px
- A=8.0 — red badge (#ffb4ab bg at 15%), label "攻击" 
- S=3.1 — amber badge (#e9c349 bg at 15%), label "抗弃" 
- H=6.5 — green badge (#a1d494 bg at 15%), label "诚实"
Each badge: rounded-full, 40x40px, score number centered, Manrope bold 14px.
Score changed this hand: badge has subtle glow ring + "↑0.3" delta in 9px

Observation count: "12手观察" in 10px #8c9387, right-aligned.

Notes section: 
"善用位置优势，翻牌后攻击性上升，河牌常放弃" in 12px #c2c9bb, italic.
If notes changed this hand: highlighted with left border 2px #a1d494.

=== Bottom ===
"印象数据存储于 IndexedDB，跨对局持久化" in 10px #8c9387, informational.

Overall: compact but information-rich. The 4 colored dimension badges are the visual centerpiece — at a glance you see each opponent's play style profile. Clean data cards, not cluttered.
```

---

## 补充说明

### 设计系统 Stitch 创建参数
```
Display Name: "LLM Poker Arena"
Color Mode: DARK
Custom Color (seed): #a1d494
Color Variant: TONAL_SPOT
Override Secondary: #e9c349
Override Tertiary: #a4c9ff
Headline Font: MANROPE
Body Font: INTER
Label Font: INTER
Roundness: ROUND_FOUR
```

### 页面生成顺序建议
1. 先创建 Design System
2. Screen 3 (牌桌玩家视角) — 最核心最复杂
3. Screen 4 (牌桌上帝视角) — 基于 Screen 3 变体
4. Screen 1 (首页) — 简单但定调
5. Screen 2 (配置页) — 表单密集
6. Screen 5 (历史页) — 数据展示
7. Screen 6 (排名弹窗) — 叠加层
8. Screen 7 (印象面板) — 侧滑抽屉

### 关键视觉元素一致性
- 所有 glass panel: `rgba(51,51,72,0.6) + backdrop-blur(24px) + border 1px #42493e`
- 所有 input field: `bg #1e1e32, border #42493e, focus:border #a1d494`
- 所有 primary button: `bg gradient #2d5a27→#3d7a35, text #bcf0ae`
- 金额数字始终用 gold `#e9c349`
- 概率/百分比用 sky blue `#a4c9ff`
- 错误/弃牌用 coral `#ffb4ab`
