# Phase 3-4 — 狼人杀 UI：WerewolfBoard + PlayerCard + SpeechBubble + 胜率面板

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `/matches/[id]` 为 gameType='werewolf' 渲染狼人杀专属 UI：6 格玩家卡网格、左上主持人面板、公共事件 timeline、发言气泡、投票可视化、阵营胜率结算面板。

**Architecture:**
- 观战页根据 `match.gameType` 分 poker/werewolf 两套 Board
- 复用 P1b-3 的 `match-view-store`；werewolf 分支补充 `speechLog` / `voteLog` / `beliefAccuracy` 派生
- 复用 P1b-4 的 RightPanel，改 Tab 为 "主持词 / 发言 / 投票"
- 赛后 RankingPanel → `WerewolfResultPanel`：阵营胜负 + 身份揭露 + 胜率统计

**前置条件：** Phase 3-1/2/3 完成。

**参考 spec:** 第 9.3 节（狼人杀 UI）、第 9.4 节（两套 Board）、第 9.7 节（视觉资产）。

**不做的事：**
- ❌ 回放（Phase 5）
- ❌ 移动端适配（延后）

---

## 文件结构

```
Colosseum/
├── games/werewolf/ui/
│   ├── WerewolfBoard.tsx           # 主容器
│   ├── PlayerCard.tsx              # 单个玩家卡（头像 + 状态 + 自称 + beliefBar）
│   ├── ModeratorPanel.tsx          # 左上主持人面板
│   ├── SpeechBubble.tsx            # 发言气泡（配角色 icon）
│   ├── VoteTally.tsx               # 当日投票可视化
│   └── WerewolfResultPanel.tsx     # 赛后揭露 + 胜率
├── app/matches/[matchId]/
│   └── SpectatorView.tsx           # Modify: 按 gameType 分流
├── store/
│   └── match-view-store.ts         # Modify: 补 werewolf 派生
└── tests/games/werewolf/ui/
    ├── PlayerCard.test.tsx
    ├── VoteTally.test.tsx
    └── WerewolfResultPanel.test.tsx
```

---

## Task 1: match-view-store 补狼人杀派生

**Files:**
- Modify: `store/match-view-store.ts`
- Modify: `tests/store/match-view-store.test.ts`

**Context:** 追加 werewolf 专用 state：`day`、`phase`、`moderatorNarration[]`、`speechLog[]`、`voteLog[]`、`roleAssignments`（只在 gameEnd 后可见）、`alive[]`。reducer 消费 werewolf/* events。

- [ ] **Step 1: 类型扩展**

在 `MatchViewState` 追加：

```typescript
export interface WerewolfDerived {
  day: number
  phase: string | null
  alive: string[]
  deaths: Array<{ agentId: string; day: number; cause: string }>
  speechLog: Array<{ day: number; agentId: string; content: string; claimedRole?: string }>
  voteLog: Array<{ day: number; voter: string; target: string | null }>
  moderatorNarration: Array<{ day: number; phase: string; narration: string }>
  roleAssignments: Record<string, string> | null   // 仅 gameEnd 后填充
  winner: 'werewolves' | 'villagers' | 'tie' | null
}

export interface MatchViewState {
  // ...existing
  werewolf: WerewolfDerived
}
```

- [ ] **Step 2: reducer 分支**

在 `ingestEvent` 的 switch 里追加：

```typescript
case 'werewolf/moderatorNarrate':
  set(s => ({ werewolf: {
    ...s.werewolf,
    moderatorNarration: [...s.werewolf.moderatorNarration, {
      day: event.payload.day, phase: event.payload.upcomingPhase, narration: event.payload.narration,
    }],
    phase: event.payload.upcomingPhase,
  }}))
  break

case 'werewolf/speak':
  set(s => ({ werewolf: {
    ...s.werewolf,
    speechLog: [...s.werewolf.speechLog, { day: event.payload.day, agentId: event.actorAgentId, content: event.payload.action.content, claimedRole: event.payload.action.claimedRole }],
  }}))
  break

case 'werewolf/vote':
  set(s => ({ werewolf: {
    ...s.werewolf,
    voteLog: [...s.werewolf.voteLog, { day: event.payload.day, voter: event.actorAgentId, target: event.payload.action.targetId }],
  }}))
  break

case 'werewolf/execute':
case 'werewolf/dayAnnounce':
  set(s => ({ werewolf: {
    ...s.werewolf,
    deaths: [...s.werewolf.deaths, ...(event.payload.deaths ?? [])],
    alive: (event.payload.aliveIds as string[]) ?? s.werewolf.alive,
  }}))
  break

case 'werewolf/gameEnd':
  set(s => ({
    derived: { ...s.derived, status: 'settled' },
    werewolf: {
      ...s.werewolf,
      roleAssignments: event.payload.actualRoles,
      winner: event.payload.winner,
    },
  }))
  break
```

初始值 `werewolf: { day: 0, phase: null, alive: [], deaths: [], speechLog: [], voteLog: [], moderatorNarration: [], roleAssignments: null, winner: null }`。

- [ ] **Step 3: 写 2 条关键测试**

```typescript
it('records moderator narration', () => {
  const s = useMatchViewStore.getState()
  s.reset()
  s.ingestEvent({ kind: 'werewolf/moderatorNarrate', payload: { day: 1, upcomingPhase: 'night/seerCheck', narration: '预言家行动' }, actorAgentId: 'mod' } as any)
  expect(useMatchViewStore.getState().werewolf.moderatorNarration).toHaveLength(1)
  expect(useMatchViewStore.getState().werewolf.phase).toBe('night/seerCheck')
})

it('reveals roles on gameEnd', () => {
  const s = useMatchViewStore.getState()
  s.reset()
  s.ingestEvent({ kind: 'werewolf/gameEnd', payload: { winner: 'werewolves', actualRoles: { a: 'werewolf' } }, actorAgentId: null } as any)
  const ww = useMatchViewStore.getState().werewolf
  expect(ww.winner).toBe('werewolves')
  expect(ww.roleAssignments?.a).toBe('werewolf')
})
```

Run: `npx vitest run tests/store/match-view-store.test.ts -t "werewolf"`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add store/match-view-store.ts tests/store/match-view-store.test.ts
git commit -m "feat(p3-4): match-view-store werewolf derivations"
```

---

## Task 2: PlayerCard

**Files:**
- Create: `games/werewolf/ui/PlayerCard.tsx`
- Create: `tests/games/werewolf/ui/PlayerCard.test.tsx`

**Context:** 每位玩家一张卡片：
- 头像（首字母圆形）
- 名字
- `alive/dead` 视觉（死者灰黑叠加 + 死因 chip）
- 自称身份（最近 speak 的 claimedRole）
- 揭露身份（仅 gameEnd 后显示，带色）
- 当前是否是 `currentActor`（ring-2 + 脉冲）

- [ ] **Step 1: 组件**

```tsx
// games/werewolf/ui/PlayerCard.tsx
'use client'
import { motion } from 'framer-motion'
import { Skull } from 'lucide-react'

interface Props {
  agentId: string
  name: string
  alive: boolean
  deathCause?: 'werewolfKill' | 'witchPoison' | 'vote' | null
  claimedRole?: string
  revealedRole?: string | null
  isCurrentActor: boolean
}

const ROLE_COLOR: Record<string, string> = {
  werewolf: 'text-red-400 bg-red-500/15 border-red-500/40',
  seer: 'text-amber-300 bg-amber-500/15 border-amber-500/40',
  witch: 'text-violet-300 bg-violet-500/15 border-violet-500/40',
  villager: 'text-neutral-300 bg-neutral-500/10 border-neutral-500/30',
}

const ROLE_ZH: Record<string, string> = {
  werewolf: '狼人', seer: '预言家', witch: '女巫', villager: '平民',
}

export function PlayerCard(p: Props) {
  return (
    <motion.div
      layout
      animate={{ opacity: p.alive ? 1 : 0.5, scale: p.isCurrentActor ? 1.03 : 1 }}
      className={`relative rounded-lg border p-3 ${p.isCurrentActor ? 'border-emerald-400 ring-2 ring-emerald-400/50 animate-pulse' : 'border-neutral-800 bg-neutral-900'}`}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold">
          {p.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="font-semibold">{p.name}</div>
          {p.claimedRole && !p.revealedRole && (
            <div className="text-[10px] text-neutral-400">自称 {ROLE_ZH[p.claimedRole]}</div>
          )}
          {p.revealedRole && (
            <div className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[10px] ${ROLE_COLOR[p.revealedRole]}`}>
              {ROLE_ZH[p.revealedRole]}
            </div>
          )}
        </div>
      </div>
      {!p.alive && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60">
          <Skull className="text-neutral-500" />
          {p.deathCause && <span className="ml-2 text-xs text-neutral-400">{deathLabel(p.deathCause)}</span>}
        </div>
      )}
    </motion.div>
  )
}

function deathLabel(c: string): string {
  return { werewolfKill: '夜刀', witchPoison: '毒杀', vote: '票出' }[c] ?? c
}
```

- [ ] **Step 2: 测试**

```tsx
import { render, screen } from '@testing-library/react'
import { PlayerCard } from '@/games/werewolf/ui/PlayerCard'

describe('PlayerCard', () => {
  it('shows claimed role before gameEnd', () => {
    render(<PlayerCard agentId="a" name="Alice" alive={true} isCurrentActor={false} claimedRole="seer" />)
    expect(screen.getByText(/自称/)).toHaveTextContent('预言家')
  })
  it('reveals role after gameEnd', () => {
    render(<PlayerCard agentId="a" name="A" alive={true} isCurrentActor={false} revealedRole="werewolf" />)
    expect(screen.getByText('狼人')).toBeInTheDocument()
  })
  it('renders death overlay when dead', () => {
    const { container } = render(<PlayerCard agentId="a" name="A" alive={false} deathCause="vote" isCurrentActor={false} />)
    expect(container.textContent).toContain('票出')
  })
})
```

Run: `npx vitest run tests/games/werewolf/ui/PlayerCard.test.tsx`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/ui/PlayerCard.tsx tests/games/werewolf/ui/PlayerCard.test.tsx
git commit -m "feat(p3-4): PlayerCard with alive/reveal states"
```

---

## Task 3: SpeechBubble 时间线

**Files:**
- Create: `games/werewolf/ui/SpeechBubble.tsx`

**Context:** 中间区域的卷轴式发言列表。每条：左边头像 + 名字，右边文本框。有 `claimedRole` 的在头像下挂一个小角色 chip。自动滚到最新。

- [ ] **Step 1: 组件**

```tsx
// games/werewolf/ui/SpeechBubble.tsx
'use client'
import { useEffect, useRef } from 'react'
import { useMatchViewStore } from '@/store/match-view-store'

export function SpeechBubbleList() {
  const speeches = useMatchViewStore(s => s.werewolf.speechLog)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }) }, [speeches.length])

  return (
    <div ref={ref} className="h-full overflow-y-auto space-y-3 px-2">
      {speeches.length === 0 && <div className="text-center text-sm text-neutral-500">暂无发言</div>}
      {speeches.map((s, i) => (
        <div key={i} className="flex gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold">
            {s.agentId.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 p-2">
            <div className="mb-1 flex items-center gap-2 text-[10px] text-neutral-500">
              <span>Day {s.day}</span>
              <span className="font-semibold">{s.agentId}</span>
              {s.claimedRole && <span className="rounded bg-amber-500/15 px-1 text-amber-300">自称 {s.claimedRole}</span>}
            </div>
            <div className="text-sm text-neutral-200">{s.content}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add games/werewolf/ui/SpeechBubble.tsx
git commit -m "feat(p3-4): SpeechBubbleList timeline"
```

---

## Task 4: ModeratorPanel

**Files:**
- Create: `games/werewolf/ui/ModeratorPanel.tsx`

**Context:** 左上角固定组件，显示最近一条 `moderatorNarration`，带仪式感样式（金边 + 衬线字体）。

- [ ] **Step 1: 组件**

```tsx
// games/werewolf/ui/ModeratorPanel.tsx
'use client'
import { useMatchViewStore } from '@/store/match-view-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Gavel } from 'lucide-react'

export function ModeratorPanel() {
  const list = useMatchViewStore(s => s.werewolf.moderatorNarration)
  const latest = list[list.length - 1]

  return (
    <div className="relative rounded-xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-900/20 to-neutral-950 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
        <Gavel size={14} /> 主持人
      </div>
      <div className="min-h-[60px]">
        <AnimatePresence mode="wait">
          {latest ? (
            <motion.div
              key={list.length}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="font-serif text-amber-100 leading-relaxed"
            >
              <div className="text-[10px] text-amber-400/70">Day {latest.day} · {latest.phase}</div>
              <div className="mt-1 italic">"{latest.narration}"</div>
            </motion.div>
          ) : (
            <div className="text-xs text-neutral-500">等待开局…</div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add games/werewolf/ui/ModeratorPanel.tsx
git commit -m "feat(p3-4): ModeratorPanel with narration animation"
```

---

## Task 5: VoteTally + WerewolfBoard 组装

**Files:**
- Create: `games/werewolf/ui/VoteTally.tsx`
- Create: `games/werewolf/ui/WerewolfBoard.tsx`

- [ ] **Step 1: VoteTally**

```tsx
// games/werewolf/ui/VoteTally.tsx
'use client'
import { useMatchViewStore } from '@/store/match-view-store'
import { useMemo } from 'react'

export function VoteTally() {
  const votes = useMatchViewStore(s => s.werewolf.voteLog)
  const day = useMatchViewStore(s => s.werewolf.day)
  const today = useMemo(() => votes.filter(v => v.day === day), [votes, day])

  const tally = new Map<string, number>()
  for (const v of today) if (v.target) tally.set(v.target, (tally.get(v.target) ?? 0) + 1)
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])

  if (today.length === 0) return null

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/70 p-2">
      <div className="mb-1 text-xs font-semibold text-neutral-400">今日投票 (Day {day})</div>
      <ul className="space-y-1">
        {sorted.map(([id, n]) => (
          <li key={id} className="flex items-center gap-2 text-xs">
            <div className="w-16 truncate">{id}</div>
            <div className="flex-1 h-2 rounded bg-neutral-800">
              <div className="h-full rounded bg-red-500" style={{ width: `${Math.min(n * 15, 100)}%` }} />
            </div>
            <div className="w-6 text-right font-mono">{n}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: WerewolfBoard**

```tsx
// games/werewolf/ui/WerewolfBoard.tsx
'use client'
import { useMatchViewStore } from '@/store/match-view-store'
import { PlayerCard } from './PlayerCard'
import { SpeechBubbleList } from './SpeechBubble'
import { ModeratorPanel } from './ModeratorPanel'
import { VoteTally } from './VoteTally'

export function WerewolfBoard() {
  const players = useMatchViewStore(s => s.derived.players)
  const ww = useMatchViewStore(s => s.werewolf)
  const currentActor = useMatchViewStore(s => s.derived.currentActor)

  return (
    <div className="grid h-full grid-cols-[1fr_2fr_1fr] grid-rows-[auto_1fr] gap-3 p-3">
      <div className="col-span-1 row-span-1"><ModeratorPanel /></div>
      <div className="col-span-2 row-span-1 text-sm text-neutral-300">
        Day {ww.day} · {ww.phase ?? '—'}
      </div>

      <div className="col-span-1 row-span-1 space-y-2 overflow-y-auto">
        {players.slice(0, 3).map(p => {
          const claimed = [...ww.speechLog].reverse().find(s => s.agentId === p.agentId)?.claimedRole
          const death = ww.deaths.find(d => d.agentId === p.agentId)
          return (
            <PlayerCard key={p.agentId}
              agentId={p.agentId} name={p.name}
              alive={!death}
              deathCause={(death?.cause as any) ?? null}
              claimedRole={claimed}
              revealedRole={ww.roleAssignments?.[p.agentId] ?? null}
              isCurrentActor={currentActor === p.agentId}
            />
          )
        })}
      </div>

      <div className="col-span-1 row-span-1 overflow-hidden">
        <SpeechBubbleList />
      </div>

      <div className="col-span-1 row-span-1 space-y-2">
        {players.slice(3, 6).map(p => {
          const claimed = [...ww.speechLog].reverse().find(s => s.agentId === p.agentId)?.claimedRole
          const death = ww.deaths.find(d => d.agentId === p.agentId)
          return (
            <PlayerCard key={p.agentId}
              agentId={p.agentId} name={p.name}
              alive={!death}
              deathCause={(death?.cause as any) ?? null}
              claimedRole={claimed}
              revealedRole={ww.roleAssignments?.[p.agentId] ?? null}
              isCurrentActor={currentActor === p.agentId}
            />
          )
        })}
        <VoteTally />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/ui/VoteTally.tsx games/werewolf/ui/WerewolfBoard.tsx
git commit -m "feat(p3-4): WerewolfBoard layout (3 cols grid)"
```

---

## Task 6: SpectatorView 按 gameType 分流

**Files:**
- Modify: `app/matches/[matchId]/SpectatorView.tsx`

- [ ] **Step 1: 分流**

```tsx
// app/matches/[matchId]/SpectatorView.tsx
'use client'
import { useEffect } from 'react'
import { useMatchViewStore } from '@/store/match-view-store'
import { useMatchSse } from '@/lib/client/sse'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { WerewolfBoard } from '@/games/werewolf/ui/WerewolfBoard'
import { RightPanel } from '@/components/match/RightPanel'
import { RankingPanel } from '@/components/match/RankingPanel'
import { WerewolfResultPanel } from '@/games/werewolf/ui/WerewolfResultPanel'

export default function SpectatorView({ match }: { match: any }) {
  useMatchSse(match.id)

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <div className="flex-1">
        {match.gameType === 'poker' ? <PokerBoard /> : <WerewolfBoard />}
      </div>
      <RightPanel matchId={match.id} />
      {match.gameType === 'poker'
        ? <RankingPanel initialChips={match.config.initialChips} />
        : <WerewolfResultPanel />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/matches/\[matchId\]/SpectatorView.tsx
git commit -m "feat(p3-4): SpectatorView dispatches by gameType"
```

---

## Task 7: WerewolfResultPanel

**Files:**
- Create: `games/werewolf/ui/WerewolfResultPanel.tsx`
- Create: `tests/games/werewolf/ui/WerewolfResultPanel.test.tsx`

**Context:** gameEnd 后弹 Dialog，展示：
- 胜利阵营（狼胜 / 村胜 / 平局）
- 所有玩家身份揭露（按座位排序）
- 本局关键数据：总天数、死亡顺序、每位玩家的 beliefAccuracy（准确率条）

- [ ] **Step 1: 组件**

```tsx
// games/werewolf/ui/WerewolfResultPanel.tsx
'use client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useMatchViewStore } from '@/store/match-view-store'
import { useRouter } from 'next/navigation'

const ZH: Record<string, string> = { werewolf: '狼人', seer: '预言家', witch: '女巫', villager: '平民' }

export function WerewolfResultPanel() {
  const status = useMatchViewStore(s => s.derived.status)
  const players = useMatchViewStore(s => s.derived.players)
  const ww = useMatchViewStore(s => s.werewolf)
  const router = useRouter()
  const open = status === 'settled' && ww.winner !== null

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ww.winner === 'werewolves' && '🐺 狼人阵营胜利'}
            {ww.winner === 'villagers' && '🏠 好人阵营胜利'}
            {ww.winner === 'tie' && '⚖️ 平局（40 天上限）'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-neutral-400">身份揭露</div>
          {players.map(p => (
            <div key={p.agentId} className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1">{p.name}</div>
              <div className="text-sm">{ZH[ww.roleAssignments?.[p.agentId] ?? ''] ?? '?'}</div>
              {ww.deaths.find(d => d.agentId === p.agentId) && <span className="text-xs text-neutral-500">出局</span>}
            </div>
          ))}
        </div>
        <div className="text-xs text-neutral-500">
          持续 {ww.day} 天 · 共发言 {ww.speechLog.length} 次
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => router.push('/')}>返回大厅</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 测试**

```tsx
import { render, screen } from '@testing-library/react'
import { WerewolfResultPanel } from '@/games/werewolf/ui/WerewolfResultPanel'
import { useMatchViewStore } from '@/store/match-view-store'

describe('WerewolfResultPanel', () => {
  it('shows werewolf victory title', () => {
    useMatchViewStore.setState({
      derived: { status: 'settled', players: [{ agentId: 'a', name: 'A' }] } as any,
      werewolf: { winner: 'werewolves', roleAssignments: { a: 'werewolf' }, deaths: [], day: 3, speechLog: [] } as any,
    })
    render(<WerewolfResultPanel />)
    expect(screen.getByText(/狼人阵营胜利/)).toBeInTheDocument()
  })
})
```

Run: `npx vitest run tests/games/werewolf/ui/WerewolfResultPanel.test.tsx`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add games/werewolf/ui/WerewolfResultPanel.tsx tests/games/werewolf/ui/WerewolfResultPanel.test.tsx
git commit -m "feat(p3-4): WerewolfResultPanel with reveal"
```

---

## Task 8: 手动 M6 Checklist（狼人杀端到端）

**Files:**
- Create: `docs/demo/phase-3-m6-checklist.md`

- [ ] **Step 1: 内容**

```markdown
# Phase 3 M6 · 狼人杀端到端

## 前置
- [ ] `npm run db:seed` 插入系统 Moderator
- [ ] 在 profile 管理页新建 2+ provider
- [ ] 新建 6 个 agents：2 狼向 / 2 神向 / 2 民向 prompt，gameType=werewolf，kind=player

## 创建
- [ ] `/matches/new`：选 gameType=werewolf、6 agents、moderator=SystemJudge（默认）
- [ ] 上传 6 个 profile 的 api key
- [ ] Start

## 观战
- [ ] ModeratorPanel 左上显示主持词，随阶段动画更新
- [ ] Day 1 发言按顺序出现在 SpeechBubble 列表
- [ ] currentActor 高亮正确流转（夜晚狼 → 狼 → 预 → 巫；白天 6 个活人轮流发言）
- [ ] VoteTally 白天投票阶段实时更新柱状图
- [ ] 死亡玩家 PlayerCard 灰化 + 显示死因

## 结束
- [ ] 胜负判定正确（狼全死→村胜；狼≥村→狼胜）
- [ ] `WerewolfResultPanel` 揭露所有身份
- [ ] roles 回写到每位 agent 的 memory（检查 DB 的 werewolf_episodic 表有 6 行）

## 健壮性
- [ ] 某个玩家 LLM 响应格式错误 → fallback 到 bot 动作 → match 不崩
- [ ] 两个 werewolf match 同时进行不串扰（ErrorBadge / SpeechBubble 分别正确）
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo/phase-3-m6-checklist.md
git commit -m "docs(p3-4): M6 werewolf e2e checklist"
```

---

## Done criteria (Phase 3-4 / M6)

- [ ] match-view-store 有 werewolf 派生 + 2 条测试
- [ ] PlayerCard / ModeratorPanel / SpeechBubble / VoteTally / WerewolfBoard 全部渲染正常
- [ ] SpectatorView 能按 gameType 分流
- [ ] WerewolfResultPanel 在 gameEnd 后弹出
- [ ] M6 手动 checklist 全绿
- [ ] lint / tsc / vitest 全绿

Phase 3 闭环后进入 **Phase 4 · 生产部署**。
