# 对局内 UI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构牌桌 UI，实现圆形头像座位、手牌朝外、桌面内下注筹码、思考气泡三阶段、关键事件强调、右侧边栏 Tab 分页。

**Architecture:** 自底向上：先重构座位组件（PlayerSeat），再调整牌桌布局（PokerTable），然后重构侧边栏（ActionLog + LiveRanking）。UI types 先扩展以支持新字段（lastAction）。每个 Task 都产出可运行的中间状态。

**Tech Stack:** React 19 + TypeScript + TailwindCSS 4 + @floating-ui/react + Zustand

**Spec:** `docs/superpowers/specs/2026-04-02-game-ui-optimization-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/types/ui.ts` | UI 层类型定义 | Modify — 添加 `lastAction` 字段 |
| `src/components/game/PlayerSeat.tsx` | 座位组件（玩家视图 + 观战视图） | **Rewrite** — 圆形头像 + 水平布局 |
| `src/components/game/PokerTable.tsx` | 牌桌容器 + 座位定位 | Modify — 放大 + 调整座位坐标 + 下注筹码移入桌面 |
| `src/components/game/ActionLog.tsx` | 右侧边栏日志/思考链/数据 | **Rewrite** — Tab 分页 |
| `src/components/game/LiveRanking.tsx` | 排名面板 | Modify — 紧凑 pill 样式 |
| `src/pages/GamePage.tsx` | 页面布局 + `enginePlayerToMock` | Modify — 传递 `lastAction` 数据 |

---

### Task 1: 扩展 UI 类型

**Files:**
- Modify: `src/types/ui.ts:15-29`

- [ ] **Step 1: 在 Player 接口添加 lastAction 字段**

在 `src/types/ui.ts` 的 `Player` 接口中添加 `lastAction` 可选字段，用于传递最近执行的动作（显示动作标签闪现）：

```typescript
export interface Player {
  id: string
  name: string
  type: PlayerType
  chips: number
  cards: string[] | null
  position: 'bottom' | 'bottom-right' | 'top-right' | 'top-left' | 'bottom-left' | 'top'
  borderColor: string
  thinking?: string | null
  folded?: boolean
  eliminated?: boolean
  badge?: string | null
  currentBet?: number
  isActive?: boolean
  /** Last action for flash label (e.g. "跟注 $10"), cleared after display */
  lastAction?: { type: string; label: string } | null
}
```

- [ ] **Step 2: 验证构建**

Run: `npx tsc --noEmit`
Expected: PASS (新字段是 optional，不破坏现有代码)

- [ ] **Step 3: Commit**

```bash
git add src/types/ui.ts
git commit -m "feat(types): add lastAction field to Player UI type"
```

---

### Task 2: 重写座位组件 — PlayerSeat.tsx

**Files:**
- Rewrite: `src/components/game/PlayerSeat.tsx`

这是最大的改动。将当前的竖向卡片座位改为圆形头像 + 水平信息布局，支持手牌朝外、状态样式、动作标签闪现。

- [ ] **Step 1: 重写整个 PlayerSeat.tsx**

用以下内容**完全替换** `src/components/game/PlayerSeat.tsx`：

```tsx
import { useState, useEffect } from 'react'
import { useFloating, autoPlacement, offset, shift } from '@floating-ui/react'
import type { Player } from '../../types/ui'
import { useGameStore } from '../../store/game-store'
import { PlayingCard } from './PlayingCard'
import { ThinkingBubble } from './ThinkingBubble'

// ── Helpers ──

function playerIcon(type: string): string {
  switch (type) {
    case 'human': return 'person'
    case 'llm': return 'smart_toy'
    case 'bot': return 'target'
    default: return 'add'
  }
}

function badgeStyle(badge: string): string {
  switch (badge) {
    case 'D': return 'bg-secondary text-on-secondary'
    case 'SB': return 'bg-tertiary-container text-on-tertiary-container'
    case 'BB': return 'bg-primary-container text-on-primary-container'
    default: return 'bg-surface-container-high text-on-surface'
  }
}

/** Player type → persistent border color (only human and bot show always) */
function typeBorderClass(type: string): string {
  switch (type) {
    case 'human': return 'border-tertiary'
    case 'bot': return 'border-secondary'
    default: return 'border-transparent'
  }
}

/** Chip display color by player type */
function chipColorClass(type: string): string {
  switch (type) {
    case 'human': return 'text-tertiary'
    default: return 'text-on-surface'
  }
}

function parseCardStr(cardStr: string): { rank: string; suit: 'heart' | 'diamond' | 'club' | 'spade' } {
  const suit = cardStr.includes('♥') ? 'heart' as const
    : cardStr.includes('♦') ? 'diamond' as const
    : cardStr.includes('♣') ? 'club' as const
    : 'spade' as const
  return { rank: cardStr.replace(/[♥♦♣♠]/g, ''), suit }
}

/** Is this seat on the top half of the table? (info-left, avatar-right is bottom) */
function isTopSeat(position: string): boolean {
  return position === 'top' || position === 'top-left' || position === 'top-right'
}

/** Is this seat on the left side? */
function isLeftSeat(position: string): boolean {
  return position === 'top-left' || position === 'bottom-left'
}

function isRightSeat(position: string): boolean {
  return position === 'top-right' || position === 'bottom-right'
}

// ── Action label colors ──

function actionLabelStyle(actionType: string): string {
  switch (actionType) {
    case 'allIn': return 'bg-gradient-to-r from-red-500 to-orange-600 text-white'
    case 'raise': case 'bet': return 'bg-secondary text-on-secondary'
    case 'call': return 'bg-tertiary/15 text-tertiary'
    case 'check': return 'bg-white/8 text-on-surface-variant'
    case 'fold': return 'bg-error/10 text-error'
    default: return 'bg-surface-container-high text-on-surface-variant'
  }
}

// ── Countdown hook ──

function useThinkingCountdown(): { seconds: number; isUnlimited: boolean } | null {
  const thinkingStartTime = useGameStore(s => s.thinkingStartTime)
  const gameState = useGameStore(s => s.gameState)
  const timeoutMs = gameState?.timingConfig?.thinkingTimeout ?? 30000
  const isUnlimited = timeoutMs === 0
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!thinkingStartTime) return
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [thinkingStartTime])

  if (!thinkingStartTime) return null
  const elapsed = now - thinkingStartTime
  if (isUnlimited) return { seconds: Math.floor(elapsed / 1000), isUnlimited: true }
  const remaining = Math.max(0, timeoutMs - elapsed)
  return { seconds: Math.ceil(remaining / 1000), isUnlimited: false }
}

// ── Bet Chip (inside table felt) ──

interface BetChipProps {
  amount: number
  actionType?: string
}

export function BetChip({ amount, actionType }: BetChipProps) {
  if (amount <= 0) return null
  const isAggressive = actionType === 'raise' || actionType === 'allIn' || actionType === 'bet'
  const chipBg = isAggressive
    ? 'bg-gradient-to-br from-red-400 to-red-600'
    : 'bg-gradient-to-br from-yellow-400 to-yellow-600'
  const textColor = isAggressive ? 'text-red-300' : 'text-secondary'

  return (
    <div className="flex items-center gap-1">
      <div className={`w-4 h-4 rounded-full ${chipBg} border-[1.5px] border-dashed border-white/30 flex items-center justify-center`}>
        <span className="text-[5px] font-black text-white">$</span>
      </div>
      <span className={`text-[11px] font-extrabold ${textColor}`}>${amount}</span>
    </div>
  )
}

// ── Seat positions (absolute, on PokerTable) ──

export const seatPositions: Record<string, string> = {
  bottom: 'absolute -bottom-20 left-1/2 -translate-x-1/2',
  'bottom-right': 'absolute bottom-0 -right-16',
  'top-right': 'absolute -top-14 -right-8',
  'top-left': 'absolute -top-14 -left-8',
  'bottom-left': 'absolute bottom-0 -left-16',
  top: 'absolute -top-24 left-1/2 -translate-x-1/2',
}

/** Bet chip positions INSIDE the table felt, near each player's edge */
export const betChipInsidePositions: Record<string, string> = {
  bottom: 'absolute bottom-[22%] left-1/2 -translate-x-1/2',
  'bottom-right': 'absolute bottom-[30%] right-[18%]',
  'top-right': 'absolute top-[28%] right-[16%]',
  'top-left': 'absolute top-[28%] left-[16%]',
  'bottom-left': 'absolute bottom-[30%] left-[18%]',
  top: 'absolute top-[22%] left-1/2 -translate-x-1/2',
}

// ── Action Flash Label (shows briefly after decision) ──

function ActionFlashLabel({ action }: { action: { type: string; label: string } }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1500)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className={`absolute bottom-[-14px] left-1/2 -translate-x-1/2 whitespace-nowrap
      ${actionLabelStyle(action.type)} rounded-md px-2 py-0.5 text-[9px] font-bold
      border-2 border-background z-20 animate-[actionBubbleIn_0.3s_ease-out]`}>
      {action.label}
    </div>
  )
}

// ── Cards display (outward from table) ──

function SeatCards({ cards, position, folded, isHero }: {
  cards: string[] | null
  position: string
  folded?: boolean
  isHero?: boolean
}) {
  if (!cards || cards.length === 0) return null

  // Cards direction based on seat position (outward)
  const isVertical = position === 'top' || position === 'bottom'
  const cardElements = cards.map((c, i) => {
    const { rank, suit } = parseCardStr(c)
    return <PlayingCard key={i} card={{ rank, suit }} mini glow={isHero && i === 0} />
  })

  return (
    <div className={`flex ${isVertical ? 'flex-row gap-1' : 'flex-col gap-1'} ${folded ? 'opacity-30 grayscale' : ''}`}>
      {cardElements}
    </div>
  )
}

// ── Main Seat Component (unified for player + spectator) ──

interface SeatProps {
  player: Player
  isHero?: boolean
  mode: 'player' | 'spectator'
}

export function Seat({ player, isHero, mode }: SeatProps) {
  const countdown = useThinkingCountdown()

  // Floating UI for thinking bubble
  const preferredSide = isLeftSeat(player.position) || player.position === 'top' ? 'right' : 'left'
  const showBubble = !!player.thinking && !player.folded && !player.eliminated
  const { refs, floatingStyles } = useFloating({
    open: showBubble,
    placement: preferredSide as 'left' | 'right',
    middleware: [
      offset(14),
      autoPlacement({ allowedPlacements: ['left', 'right', 'top', 'bottom'] }),
      shift({ padding: 8 }),
    ],
  })

  if (player.type === 'empty') {
    return (
      <div className={seatPositions[player.position]}>
        <div className="flex flex-col items-center opacity-30">
          <div className="w-12 h-12 rounded-full border-2 border-dashed border-outline-variant flex items-center justify-center">
            <span className="material-symbols-outlined text-outline-variant text-sm">add</span>
          </div>
        </div>
      </div>
    )
  }

  // State flags
  const isFolded = !!player.folded
  const isEliminated = !!player.eliminated
  const isThinking = !!player.thinking && !isFolded && !isEliminated
  const isAllIn = player.chips === 0 && !isFolded && !isEliminated
  const isActive = !!player.isActive && !isFolded && !isEliminated

  // Avatar border: thinking > allIn > type default
  let avatarBorderClass = typeBorderClass(player.type)
  let avatarGlow = ''
  if (isThinking) {
    avatarBorderClass = 'border-primary'
    avatarGlow = 'shadow-[0_0_14px_rgba(161,212,148,0.3)]'
  } else if (isAllIn) {
    avatarBorderClass = 'border-error'
    avatarGlow = 'shadow-[0_0_12px_rgba(255,180,171,0.25)]'
  }

  // Build layout direction
  const topHalf = isTopSeat(player.position)

  // Avatar element
  const avatarEl = (
    <div className="relative flex-shrink-0" ref={refs.setReference}>
      <div className={`w-[52px] h-[52px] rounded-full border-[3px] ${avatarBorderClass} bg-surface-container-high
        flex items-center justify-center ${avatarGlow}
        ${isEliminated ? 'opacity-30 grayscale' : ''}
        ${isFolded ? 'opacity-35 grayscale-[0.6]' : ''}`}>
        <span className="material-symbols-outlined text-[22px] text-on-surface-variant">
          {playerIcon(player.type)}
        </span>
      </div>

      {/* Badge D/SB/BB */}
      {player.badge && (
        <div className={`absolute -top-[5px] ${topHalf ? '-left-[5px]' : '-right-[5px]'}
          w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black
          border-2 border-background ${badgeStyle(player.badge)}`}>
          {player.badge}
        </div>
      )}

      {/* Thinking spinner indicator */}
      {isThinking && (
        <div className="absolute -bottom-[3px] -right-[3px] bg-primary text-on-primary
          rounded-lg h-[18px] px-1 flex items-center gap-0.5 text-[7px] font-bold
          border-2 border-background">
          <span className="material-symbols-outlined text-[10px] animate-spin">sync</span>
          {countdown && (
            <span>{countdown.isUnlimited ? `${countdown.seconds}s` : `${countdown.seconds}s`}</span>
          )}
        </div>
      )}

      {/* Action flash label */}
      {player.lastAction && <ActionFlashLabel action={player.lastAction} />}
    </div>
  )

  // Info element (name + chips)
  const infoEl = (
    <div className={topHalf ? 'text-left' : 'text-right'}>
      <div className={`text-[11px] font-extrabold truncate max-w-[80px]
        ${isEliminated || isFolded ? 'text-outline-variant' : 'text-on-surface'}`}>
        {player.name}
      </div>
      {isEliminated ? (
        <div className="text-[9px] font-bold text-error">已淘汰</div>
      ) : isFolded ? (
        <div className="text-[9px] font-bold text-error">FOLDED</div>
      ) : isAllIn ? (
        <div className="text-[13px] font-black text-error">ALL IN</div>
      ) : (
        <div className={`text-[14px] font-black ${chipColorClass(player.type)}`}>
          ${player.chips.toLocaleString()}
        </div>
      )}
    </div>
  )

  // Cards element (outward direction)
  const cardsEl = (mode === 'spectator' || isHero) ? (
    <SeatCards
      cards={player.cards}
      position={player.position}
      folded={isFolded}
      isHero={isHero}
    />
  ) : null

  // Compose layout: cards outward, then [avatar + info] horizontal
  // Top seats: avatar left, info right. Bottom seats: info left, avatar right.
  const seatRow = topHalf
    ? <div className="flex items-center gap-2">{avatarEl}{infoEl}</div>
    : <div className="flex items-center gap-2">{infoEl}{avatarEl}</div>

  // Cards placement: outward from table
  // top → cards above seat, bottom → cards below seat
  // left → cards to the left, right → cards to the right
  let content: React.ReactNode
  if (player.position === 'top' || player.position === 'top-left' || player.position === 'top-right') {
    // Cards above (outward for top seats)
    content = (
      <div className={`flex flex-col items-center gap-1 ${isLeftSeat(player.position) ? 'items-start' : isRightSeat(player.position) ? 'items-end' : 'items-center'}`}>
        {cardsEl}
        {seatRow}
      </div>
    )
  } else {
    // Cards below (outward for bottom seats)
    content = (
      <div className={`flex flex-col items-center gap-1 ${isLeftSeat(player.position) ? 'items-end' : isRightSeat(player.position) ? 'items-start' : 'items-center'}`}>
        {seatRow}
        {cardsEl}
      </div>
    )
  }

  return (
    <div className={seatPositions[player.position]}>
      <div className="relative">
        {/* Thinking bubble via Floating UI */}
        {showBubble && (
          <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }}>
            <ThinkingBubble content={player.thinking!} variant="player" />
          </div>
        )}
        {content}
      </div>
    </div>
  )
}

// ── Backward-compatible exports ──

export function PlayerSeat({ player, isHero }: { player: Player; isHero?: boolean }) {
  return <Seat player={player} isHero={isHero} mode="player" />
}

export function SpectatorSeat({ player }: { player: Player }) {
  return <Seat player={player} mode="spectator" />
}
```

- [ ] **Step 2: 验证构建**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/game/PlayerSeat.tsx
git commit -m "feat(ui): rewrite PlayerSeat with circular avatars and horizontal layout

- Unified Seat component for player + spectator modes
- Circular 52px avatars with type-based border colors
- Horizontal layout: top seats = avatar-left, bottom seats = avatar-right
- Cards placed outward from table (top=above, bottom=below)
- Thinking indicator on avatar (spinner + countdown)
- Action flash label (1.5s fadeout)
- AllIn/Folded/Eliminated state styling"
```

---

### Task 3: 调整牌桌布局 — PokerTable.tsx

**Files:**
- Modify: `src/components/game/PokerTable.tsx`

- [ ] **Step 1: 更新 PokerTable 放大牌桌 + 导入 BetChip**

替换 `src/components/game/PokerTable.tsx` 的全部内容：

```tsx
import type { Player, CardData } from '../../types/ui'
import type { SidePot } from '../../types/game'
import { CommunityCards } from './CommunityCards'
import { PotDisplay } from './PotDisplay'
import { PlayerSeat, SpectatorSeat, BetChip, betChipInsidePositions } from './PlayerSeat'

interface PokerTableProps {
  players: Player[]
  communityCards: CardData[]
  pot: number
  sidePots?: SidePot[]
  mode: 'player' | 'spectator'
  heroId?: string
  phase?: string
}

const phaseColors: Record<string, string> = {
  '翻前': 'bg-surface-container-high text-on-surface-variant',
  '翻牌': 'bg-primary-container/30 text-primary',
  '转牌': 'bg-tertiary-container/30 text-tertiary',
  '河牌': 'bg-secondary-container/30 text-secondary',
  '摊牌': 'bg-error/20 text-error',
}

export function PokerTable({ players, communityCards, pot, sidePots, mode, heroId, phase }: PokerTableProps) {
  const isSpectator = mode === 'spectator'

  return (
    <div className="relative w-full max-w-7xl aspect-[2/1] flex items-center justify-center">
      {/* The felt table */}
      <div
        className={`absolute inset-0 ${
          isSpectator
            ? 'poker-table-gradient-spectator rounded-[200px] border border-outline-variant/10'
            : 'poker-table-gradient rounded-[200px] border-[12px] border-surface-container-high'
        } shadow-2xl flex items-center justify-center`}
      >
        {/* Phase indicator */}
        {phase && (
          <div className={`absolute top-6 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${phaseColors[phase] || 'bg-surface-container-high text-on-surface-variant'}`}>
            {phase}
          </div>
        )}

        {/* Pot display */}
        <div className={isSpectator
          ? 'absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-full'
          : 'absolute top-1/4'
        }>
          <PotDisplay amount={pot} sidePots={sidePots} variant={isSpectator ? 'glass' : 'text'} />
        </div>

        {/* Community cards */}
        <CommunityCards cards={communityCards} detailed={isSpectator} />

        {/* Bet chips INSIDE the table felt */}
        {players.map((player) => {
          if (!player.currentBet || player.currentBet <= 0 || player.folded || player.type === 'empty') return null
          const posClass = betChipInsidePositions[player.position]
          if (!posClass) return null
          return (
            <div key={`bet-${player.id}`} className={posClass}>
              <BetChip amount={player.currentBet} actionType={player.lastAction?.type} />
            </div>
          )
        })}
      </div>

      {/* Player seats */}
      {players.map((player) =>
        isSpectator ? (
          <SpectatorSeat key={player.id} player={player} />
        ) : (
          <PlayerSeat
            key={player.id}
            player={player}
            isHero={player.id === heroId}
          />
        ),
      )}
    </div>
  )
}
```

关键改动：
- `max-w-5xl` → `max-w-7xl`（等比例放大）
- 导入 `BetChip` 和 `betChipInsidePositions` 从 PlayerSeat
- 在桌面绿毡内渲染每个玩家的下注筹码

- [ ] **Step 2: 验证构建**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/game/PokerTable.tsx
git commit -m "feat(ui): enlarge table to max-w-7xl, move bet chips inside felt"
```

---

### Task 4: 重构右侧边栏 — ActionLog Tab 分页

**Files:**
- Rewrite: `src/components/game/ActionLog.tsx`

- [ ] **Step 1: 重写 ActionLog.tsx 为 Tab 分页**

替换 `src/components/game/ActionLog.tsx` 的全部内容：

```tsx
import { useState, useEffect, useRef } from 'react'
import type { ActionLogEntry, PhaseHeader, ProbabilityEntry } from '../../types/ui'
import { LiveRanking } from './LiveRanking'

// ── Thinking chain entry (re-exported for compatibility) ──

export interface ThinkingChainEntry {
  playerId: string
  playerName: string
  content: string
}

// ── Helpers ──

function textColorClass(token: string): string {
  const map: Record<string, string> = {
    secondary: 'text-secondary', tertiary: 'text-tertiary',
    'on-tertiary-container': 'text-on-tertiary-container',
    'on-surface-variant': 'text-on-surface-variant',
    primary: 'text-primary', error: 'text-error',
  }
  return map[token] ?? 'text-on-surface-variant'
}

function dotColorClass(token: string): string {
  const map: Record<string, string> = {
    secondary: 'bg-secondary', tertiary: 'bg-tertiary',
    'on-tertiary-container': 'bg-on-tertiary-container', error: 'bg-error',
  }
  return map[token] ?? 'bg-on-surface-variant'
}

function phaseBgClass(token: string): string {
  const map: Record<string, string> = {
    'surface-container': 'bg-surface-container',
    'primary-container/20': 'bg-primary-container/20',
  }
  return map[token] ?? 'bg-surface-container'
}

function isPhaseHeader(entry: unknown): entry is PhaseHeader {
  return typeof entry === 'object' && entry !== null && 'phase' in entry && !('action' in entry)
}

type TabId = 'log' | 'thinking' | 'data'

// ── Tab Button ──

function TabButton({ id, active, label, icon, badge, highlight, onClick }: {
  id: TabId; active: boolean; label: string; icon: string
  badge?: number; highlight?: boolean; onClick: (id: TabId) => void
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex-1 flex items-center justify-center gap-1 py-2.5
        text-[9px] font-bold tracking-wide transition-colors
        ${active
          ? 'text-primary border-b-2 border-primary'
          : 'text-on-surface-variant/35 hover:text-on-surface-variant/60'}`}
    >
      <span className="material-symbols-outlined text-xs">{icon}</span>
      {label}
      {badge != null && badge > 0 && (
        <span className={`text-[7px] px-1.5 py-0.5 rounded-full font-bold
          ${highlight ? 'bg-primary text-on-primary animate-pulse' : 'bg-primary/20 text-primary'}`}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ── Log Tab Content ──

function LogTab({ entries }: { entries: (ActionLogEntry | PhaseHeader)[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
      {entries.map((entry, i) => {
        if (isPhaseHeader(entry)) {
          return (
            <div key={i}>
              {i > 0 && <div className="h-px bg-outline-variant/10 my-3" />}
              <div className={`text-[8px] font-label font-bold ${textColorClass(entry.phaseColor)}
                uppercase tracking-widest ${phaseBgClass(entry.phaseBg)} px-2 py-0.5 rounded inline-block`}>
                {entry.phase}
              </div>
            </div>
          )
        }
        const logEntry = entry as ActionLogEntry
        return (
          <div key={i} className={`flex items-start gap-2 text-xs
            ${logEntry.highlight ? 'p-1.5 bg-primary/5 rounded border-l-2 border-primary' : ''}`}
            style={{ opacity: logEntry.opacity ?? 1 }}>
            <div className={`w-[5px] h-[5px] mt-1 rounded-full flex-shrink-0 ${dotColorClass(logEntry.playerColor)}`} />
            <p className="text-on-surface-variant">
              <span className={`${textColorClass(logEntry.playerColor)} font-bold`}>{logEntry.playerName}</span>
              {' '}{logEntry.action}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Thinking Tab Content ──

function ThinkingTab({ thinkingChain, onThinkingClick }: {
  thinkingChain: ThinkingChainEntry[]
  onThinkingClick?: (entry: ThinkingChainEntry) => void
}) {
  const [collapsedIndices, setCollapsedIndices] = useState<Set<number>>(new Set())

  const toggleCollapse = (index: number) => {
    setCollapsedIndices(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index); else next.add(index)
      return next
    })
  }

  if (thinkingChain.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface-variant/30 text-xs">
        暂无思考记录
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
      {thinkingChain.map((entry, i) => {
        const isCollapsed = collapsedIndices.has(i)
        return (
          <div
            key={i}
            className="bg-surface-container-lowest p-3 rounded-lg border-l-2 border-primary cursor-pointer hover:bg-surface-container transition-colors"
            onClick={() => onThinkingClick?.(entry)}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-primary/60 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">psychology</span>
                #{i + 1} {entry.playerName}
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); toggleCollapse(i) }}
                className="p-0.5 hover:bg-surface-container-high rounded transition-colors"
              >
                <span className="material-symbols-outlined text-[10px] text-on-surface-variant">
                  {isCollapsed ? 'expand_more' : 'expand_less'}
                </span>
              </button>
            </div>
            {!isCollapsed && (
              <p className="text-[11px] leading-relaxed text-on-surface-variant italic line-clamp-4">
                {entry.content}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Data Tab Content ──

function DataTab({ probabilityMatrix }: {
  probabilityMatrix?: ProbabilityEntry[]
}) {
  if (!probabilityMatrix || probabilityMatrix.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface-variant/30 text-xs">
        等待数据...
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 min-h-0">
      <div className="text-[9px] font-bold uppercase tracking-widest text-on-surface/40 mb-3 flex items-center gap-1">
        <span className="material-symbols-outlined text-xs">bar_chart</span>
        Probability Matrix
      </div>
      <div className="space-y-2">
        {probabilityMatrix.map((entry) => (
          <div key={entry.name}>
            <div className="flex justify-between text-[10px]">
              <span>{entry.name} (Win%)</span>
              <span className={textColorClass(entry.color)}>{entry.winPercent}%</span>
            </div>
            <div className="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
              <div
                className={`h-full ${entry.color === 'primary' ? 'bg-primary' : 'bg-tertiary'}`}
                style={{ width: `${entry.winPercent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Player View Action Log (with tabs) ──

interface PlayerActionLogProps {
  entries: (ActionLogEntry | PhaseHeader)[]
  thinkingChain?: ThinkingChainEntry[]
  onThinkingClick?: (entry: ThinkingChainEntry) => void
}

export function PlayerActionLog({ entries, thinkingChain, onThinkingClick }: PlayerActionLogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('log')
  const [thinkingHighlight, setThinkingHighlight] = useState(false)
  const prevThinkingCount = useRef(thinkingChain?.length ?? 0)

  // Flash thinking badge when new entry arrives
  useEffect(() => {
    const count = thinkingChain?.length ?? 0
    if (count > prevThinkingCount.current && activeTab !== 'thinking') {
      setThinkingHighlight(true)
      const timer = setTimeout(() => setThinkingHighlight(false), 1000)
      prevThinkingCount.current = count
      return () => clearTimeout(timer)
    }
    prevThinkingCount.current = count
  }, [thinkingChain?.length, activeTab])

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-outline-variant/10">
        <TabButton id="log" active={activeTab === 'log'} label="日志" icon="history" onClick={setActiveTab} />
        <TabButton id="thinking" active={activeTab === 'thinking'} label="思考链" icon="psychology"
          badge={thinkingChain?.length} highlight={thinkingHighlight} onClick={setActiveTab} />
      </div>

      {/* Tab content */}
      {activeTab === 'log' && <LogTab entries={entries} />}
      {activeTab === 'thinking' && (
        <ThinkingTab thinkingChain={thinkingChain ?? []} onThinkingClick={onThinkingClick} />
      )}
    </div>
  )
}

// ── Spectator Action Log (with tabs + ranking) ──

interface SpectatorActionLogProps {
  entries: (ActionLogEntry | PhaseHeader)[]
  probabilityMatrix?: ProbabilityEntry[]
  thinkingChain?: ThinkingChainEntry[]
  onThinkingClick?: (entry: ThinkingChainEntry) => void
  rankingPlayers?: { id: string; name: string; type: string; chips: number }[]
  prevHandRanks?: Record<string, number>
  firstPlaceStreak?: number
  firstPlacePlayerId?: string | null
}

export function SpectatorActionLog({
  entries, probabilityMatrix, thinkingChain, onThinkingClick,
  rankingPlayers, prevHandRanks, firstPlaceStreak, firstPlacePlayerId,
}: SpectatorActionLogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('log')
  const [thinkingHighlight, setThinkingHighlight] = useState(false)
  const prevThinkingCount = useRef(thinkingChain?.length ?? 0)

  useEffect(() => {
    const count = thinkingChain?.length ?? 0
    if (count > prevThinkingCount.current && activeTab !== 'thinking') {
      setThinkingHighlight(true)
      const timer = setTimeout(() => setThinkingHighlight(false), 1000)
      prevThinkingCount.current = count
      return () => clearTimeout(timer)
    }
    prevThinkingCount.current = count
  }, [thinkingChain?.length, activeTab])

  return (
    <aside className="w-80 bg-surface-container-low border-l border-outline-variant/10 flex flex-col z-30">
      {/* Tab bar */}
      <div className="flex border-b border-outline-variant/10">
        <TabButton id="log" active={activeTab === 'log'} label="日志" icon="history" onClick={setActiveTab} />
        <TabButton id="thinking" active={activeTab === 'thinking'} label="思考链" icon="psychology"
          badge={thinkingChain?.length} highlight={thinkingHighlight} onClick={setActiveTab} />
        <TabButton id="data" active={activeTab === 'data'} label="数据" icon="bar_chart" onClick={setActiveTab} />
      </div>

      {/* Tab content */}
      {activeTab === 'log' && <LogTab entries={entries} />}
      {activeTab === 'thinking' && (
        <ThinkingTab thinkingChain={thinkingChain ?? []} onThinkingClick={onThinkingClick} />
      )}
      {activeTab === 'data' && <DataTab probabilityMatrix={probabilityMatrix} />}

      {/* Fixed bottom: live ranking (always visible) */}
      {rankingPlayers && rankingPlayers.length > 0 && (
        <LiveRanking
          players={rankingPlayers}
          prevRanks={prevHandRanks || {}}
          firstPlaceStreak={firstPlaceStreak || 0}
          firstPlacePlayerId={firstPlacePlayerId || null}
        />
      )}
    </aside>
  )
}
```

- [ ] **Step 2: 验证构建**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/game/ActionLog.tsx
git commit -m "feat(ui): rewrite ActionLog with tab layout (log/thinking/data)

- Three tabs: 日志, 思考链, 数据
- Thinking badge with flash highlight on new entries
- Each tab takes full available height
- LiveRanking stays fixed at bottom regardless of active tab"
```

---

### Task 5: 紧凑排名面板 — LiveRanking.tsx

**Files:**
- Modify: `src/components/game/LiveRanking.tsx`

- [ ] **Step 1: 改为紧凑 pill 样式**

替换 `src/components/game/LiveRanking.tsx` 全部内容：

```tsx
interface LiveRankingProps {
  players: { id: string; name: string; type: string; chips: number }[]
  prevRanks: Record<string, number>
  firstPlaceStreak: number
  firstPlacePlayerId: string | null
  handNumber?: number
}

function textColorForType(type: string): string {
  switch (type) {
    case 'llm': return 'text-tertiary'
    case 'human': return 'text-primary'
    case 'bot': return 'text-secondary'
    default: return 'text-on-surface-variant'
  }
}

function rankBadge(rank: number): string {
  switch (rank) {
    case 1: return '🥇'
    case 2: return '🥈'
    case 3: return '🥉'
    default: return `#${rank}`
  }
}

export function LiveRanking({ players, prevRanks, firstPlaceStreak, firstPlacePlayerId, handNumber }: LiveRankingProps) {
  const sorted = [...players]
    .filter(p => p.chips > 0 || prevRanks[p.id])
    .sort((a, b) => b.chips - a.chips)

  return (
    <div className="border-t border-outline-variant/10 px-3 py-2.5 bg-surface-container-lowest">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[8px] font-bold uppercase tracking-widest text-on-surface/25">Leaderboard</span>
        {handNumber && <span className="text-[8px] text-on-surface/25">第 {handNumber} 手</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((player, i) => {
          const currentRank = i + 1
          const isFirst = currentRank === 1
          const showStreak = isFirst && firstPlaceStreak >= 2 && player.id === firstPlacePlayerId

          return (
            <div
              key={player.id}
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[8px]
                ${isFirst ? 'bg-primary/8' : ''}`}
            >
              <span className="font-bold">{rankBadge(currentRank)}</span>
              <span className={`font-extrabold truncate max-w-[60px] ${textColorForType(player.type)}`}>
                {player.name}
              </span>
              <span className="font-black text-on-surface">${player.chips.toLocaleString()}</span>
              {showStreak && <span className="text-orange-400 font-bold">🔥{firstPlaceStreak}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证构建**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/game/LiveRanking.tsx
git commit -m "feat(ui): compact pill-style LiveRanking for sidebar bottom"
```

---

### Task 6: 更新 GamePage — 传递 lastAction 数据

**Files:**
- Modify: `src/pages/GamePage.tsx`

- [ ] **Step 1: 查找并更新 enginePlayerToMock 函数**

在 `src/pages/GamePage.tsx` 中找到 `enginePlayerToMock` 函数（约 line 65-110），添加 `lastAction` 字段。需要从 game-store 的 `lastBotAction` 状态读取。

在 `enginePlayerToMock` 返回对象中添加：

```typescript
// Inside the return object of enginePlayerToMock, add:
lastAction: lastBotAction && lastBotAction.playerId === player.id
  ? { type: lastBotAction.action.type, label: formatActionLabel(lastBotAction.action) }
  : null,
```

同时在文件顶部（GamePage 组件内或附近）添加 helper：

```typescript
function formatActionLabel(action: { type: string; amount?: number }): string {
  switch (action.type) {
    case 'fold': return '弃牌'
    case 'check': return '过牌'
    case 'call': return `跟注 $${action.amount || 0}`
    case 'bet': return `下注 $${action.amount || 0}`
    case 'raise': return `加注 $${action.amount || 0}`
    case 'allIn': return `ALL IN $${action.amount || 0}`
    default: return action.type
  }
}
```

并确保从 store 获取 `lastBotAction`：

```typescript
const lastBotAction = useGameStore(s => s.lastBotAction)
```

- [ ] **Step 2: 验证构建**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 在浏览器中手动测试**

Run: `npm run dev`

验证：
1. 牌桌放大到 max-w-7xl，保持椭圆形状
2. 座位为圆形头像 + 水平布局
3. 手牌朝外（top 在上，bottom 在下）
4. 桌面内显示下注筹码
5. 思考中头像有绿色边框 + spinner
6. 右侧边栏有 Tab 切换（日志/思考链/数据）
7. 排名面板固定在底部

- [ ] **Step 4: Commit**

```bash
git add src/pages/GamePage.tsx
git commit -m "feat(ui): pass lastAction to player seats for action flash labels"
```

---

## Self-Review

**Spec coverage:**
- ✅ 座位组件：圆形头像 + 水平布局 + 方向自适应 → Task 2
- ✅ 手牌朝外 → Task 2 (SeatCards)
- ✅ 下注筹码桌面内 → Task 3 (betChipInsidePositions)
- ✅ 思考气泡三阶段 → Task 2 (spinner indicator + ThinkingBubble + ActionFlashLabel)
- ✅ 关键事件强调 → Task 2 (actionLabelStyle + avatarBorder for allIn)
- ✅ 牌桌等比放大 → Task 3 (max-w-7xl)
- ✅ Tab 分页 → Task 4
- ✅ 排名面板固定底部 → Task 5
- ✅ lastAction 数据传递 → Task 1 + Task 6

**Placeholder scan:** 无 TBD/TODO，所有步骤有完整代码。

**Type consistency:** `lastAction: { type: string; label: string }` 在 ui.ts (Task 1)、PlayerSeat (Task 2)、GamePage (Task 6) 中一致。`BetChip` 和 `betChipInsidePositions` 在 PlayerSeat 导出、PokerTable 导入一致。`ThinkingChainEntry` 在 ActionLog.tsx 导出保持不变。
