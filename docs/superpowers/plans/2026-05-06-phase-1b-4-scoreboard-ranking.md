# Phase 1b-4 — 计分板 / 筹码图 / 排名面板 / Action Log

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在观战页右侧 Panel 渲染「实时计分板 + 行动日志 / 思考链 Tab + 筹码曲线图」，以及 match 结束时弹出 `RankingPanel`。错误兜底 Badge 显示 `agent_errors` 数量。

**Architecture:**
- 继续使用 `match-view-store`（P1b-3）派生 state；新增 `chipHistory`（每手终局快照）供筹码图消费
- 用 `recharts`（React 图表库，轻量）画折线图
- `ActionLog` / `ThinkingLog` 共用一个可滚动容器，用 Tab 切换
- `RankingPanel` 是 Dialog / Modal，match.status === 'settled' 时自动展示
- 错误 Badge 轮询 `/api/matches/:id/errors`（低频 5s）或监听 SSE 的 `agent_error` kind

**前置条件：** P1b-3 完成（match-view-store + SpectatorView 骨架就绪）。

**参考 spec:** 第 9.3 节（计分板 / 筹码图 / 排名面板）、第 9.5 节（错误兜底）。

**不做的事：**
- ❌ LLM 集成（P1b-5）
- ❌ 分享 / 导出战报（Phase 5）
- ❌ 玩家对比面板（Phase 5）

---

## 文件结构

```
Colosseum/
├── app/
│   └── matches/[matchId]/
│       └── SpectatorView.tsx                   # Modify: 接入 RightPanel
├── components/match/
│   ├── RightPanel.tsx                          # 右侧栏容器（计分板 + Tab）
│   ├── LiveScoreboard.tsx                      # 实时计分板
│   ├── ChipChart.tsx                           # 筹码折线图
│   ├── RankingPanel.tsx                        # 赛后排名 Modal
│   ├── ActionLog.tsx                           # 行动日志
│   ├── ThinkingLog.tsx                         # 思考链
│   └── ErrorBadge.tsx                          # 错误 Badge
├── store/
│   └── match-view-store.ts                     # Modify: 新增 chipHistory / handOver reducer
├── app/api/matches/[id]/
│   └── errors/route.ts                         # GET 最近错误列表（兜底轮询用）
└── db/queries/
    └── errors.ts                               # Modify: listByMatch(matchId, limit)
```

---

## Task 1: match-view-store 补充：chipHistory + errors

**Files:**
- Modify: `store/match-view-store.ts`
- Modify: `tests/store/match-view-store.test.ts`

**Context:** `chipHistory` 是每手结束（`hand_over` / `settlement` 事件）记录所有 agent 当时的筹码快照；`errors` 存本场累计的 agent_error 数量（从 SSE 或轮询得到）。

- [x] **Step 1: 更新 store 类型**

在 `store/match-view-store.ts` 的 `MatchViewState` interface 里追加：

```typescript
export interface ChipSnapshot {
  handNumber: number
  at: number                         // timestamp
  chips: Record<string, number>      // agentId -> chips
}

export interface MatchViewState {
  // ...existing
  chipHistory: ChipSnapshot[]
  errorCount: number
  recordHandSnapshot(handNumber: number, chips: Record<string, number>): void
  incrementError(): void
  setErrorCount(count: number): void
}
```

- [x] **Step 2: 写失败测试**

在 `tests/store/match-view-store.test.ts` 追加：

```typescript
describe('chipHistory', () => {
  it('appends a snapshot on hand_over', () => {
    const store = useMatchViewStore.getState()
    store.reset()
    store.recordHandSnapshot(1, { a: 100, b: 150 })
    store.recordHandSnapshot(2, { a: 90, b: 160 })
    expect(useMatchViewStore.getState().chipHistory).toHaveLength(2)
    expect(useMatchViewStore.getState().chipHistory[1].chips.b).toBe(160)
  })

  it('derives chipHistory from hand_over event', () => {
    const store = useMatchViewStore.getState()
    store.reset()
    store.ingestEvent({
      kind: 'hand_over',
      handNumber: 1,
      chips: { a: 100, b: 150 },
    } as any)
    expect(useMatchViewStore.getState().chipHistory).toHaveLength(1)
  })
})

describe('errorCount', () => {
  it('increments on agent_error event', () => {
    const store = useMatchViewStore.getState()
    store.reset()
    store.ingestEvent({ kind: 'agent_error' } as any)
    store.ingestEvent({ kind: 'agent_error' } as any)
    expect(useMatchViewStore.getState().errorCount).toBe(2)
  })
})
```

- [x] **Step 3: 运行（应失败）**

Run: `npx vitest run tests/store/match-view-store.test.ts`
Expected: FAIL — `recordHandSnapshot is not a function`。

- [x] **Step 4: 实现**

在 store 的 initial state 和 actions 里加入：

```typescript
chipHistory: [],
errorCount: 0,

recordHandSnapshot(handNumber, chips) {
  set(state => ({
    chipHistory: [
      ...state.chipHistory,
      { handNumber, at: Date.now(), chips: { ...chips } },
    ],
  }))
},

incrementError() {
  set(state => ({ errorCount: state.errorCount + 1 }))
},

setErrorCount(count) {
  set({ errorCount: count })
},
```

然后在 `ingestEvent` 的 switch 里补充：

```typescript
case 'hand_over':
  get().recordHandSnapshot(event.handNumber, event.chips)
  break
case 'agent_error':
  get().incrementError()
  break
```

- [x] **Step 5: 运行（应通过）**

Run: `npx vitest run tests/store/match-view-store.test.ts`
Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add store/match-view-store.ts tests/store/match-view-store.test.ts
git commit -m "feat(p1b-4): chipHistory + errorCount in match-view-store"
```

---

## Task 2: 错误查询 + API

**Files:**
- Modify: `db/queries/errors.ts`
- Create: `app/api/matches/[id]/errors/route.ts`
- Create: `tests/api/errors-list.test.ts`

- [ ] **Step 1: 补 query**

在 `db/queries/errors.ts` 追加：

```typescript
import { desc, eq } from 'drizzle-orm'
import { db } from '../index'
import { agentErrors } from '../schema'

export async function listErrorsByMatch(matchId: string, limit = 20) {
  return db.select()
    .from(agentErrors)
    .where(eq(agentErrors.matchId, matchId))
    .orderBy(desc(agentErrors.createdAt))
    .limit(limit)
}
```

- [ ] **Step 2: 写 API 路由**

在 `app/api/matches/[id]/errors/route.ts`：

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { listErrorsByMatch } from '@/db/queries/errors'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const errors = await listErrorsByMatch(id, 20)
  return NextResponse.json({ matchId: id, count: errors.length, errors })
}
```

- [ ] **Step 3: 测试**

在 `tests/api/errors-list.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { GET } from '@/app/api/matches/[id]/errors/route'
import { db } from '@/db'
import { agentErrors } from '@/db/schema'
import { NextRequest } from 'next/server'

describe('GET /api/matches/:id/errors', () => {
  beforeEach(async () => {
    await db.delete(agentErrors)
    await db.insert(agentErrors).values([
      { matchId: 'm1', agentId: 'a1', kind: 'timeout', message: 'x' },
      { matchId: 'm1', agentId: 'a1', kind: 'parse_fail', message: 'y' },
    ])
  })

  it('returns errors by match', async () => {
    const req = new NextRequest('http://x/api/matches/m1/errors')
    const res = await GET(req, { params: Promise.resolve({ id: 'm1' }) })
    const json = await res.json()
    expect(json.count).toBe(2)
    expect(json.errors[0].matchId).toBe('m1')
  })
})
```

Run: `npx vitest run tests/api/errors-list.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add db/queries/errors.ts app/api/matches/\[id\]/errors/route.ts tests/api/errors-list.test.ts
git commit -m "feat(p1b-4): GET /api/matches/:id/errors"
```

---

## Task 3: ErrorBadge 组件

**Files:**
- Create: `components/match/ErrorBadge.tsx`

**Context:** 显示一个带红点的小徽标，hover 时列最近 5 条 kind+message。使用 `Popover`（shadcn/ui 已装）。

- [ ] **Step 1: 组件**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { useMatchViewStore } from '@/store/match-view-store'
import { AlertTriangle } from 'lucide-react'

interface ErrorItem { kind: string; message: string; createdAt: string }

export function ErrorBadge({ matchId }: { matchId: string }) {
  const errorCount = useMatchViewStore(s => s.errorCount)
  const setErrorCount = useMatchViewStore(s => s.setErrorCount)
  const [items, setItems] = useState<ErrorItem[]>([])

  async function refresh() {
    const res = await fetch(`/api/matches/${matchId}/errors`)
    if (!res.ok) return
    const json = await res.json()
    setItems(json.errors)
    setErrorCount(json.count)
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [matchId])

  if (errorCount === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-500/10">
          <AlertTriangle size={14} />
          <Badge variant="destructive">{errorCount}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="mb-2 text-xs font-semibold text-neutral-300">Agent 错误（最近 5 条）</div>
        <ul className="space-y-1 text-xs">
          {items.slice(0, 5).map((e, i) => (
            <li key={i} className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1">
              <div className="font-mono text-red-300">{e.kind}</div>
              <div className="text-neutral-400">{e.message}</div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/match/ErrorBadge.tsx
git commit -m "feat(p1b-4): ErrorBadge with 5s polling"
```

---

## Task 4: LiveScoreboard

**Files:**
- Create: `components/match/LiveScoreboard.tsx`
- Create: `tests/components/LiveScoreboard.test.tsx`

**Context:** 右侧栏顶部的实时计分板。按当前筹码降序显示所有 agents，显示每位的：头像（首字母圆形）+ 名字 + 当前筹码 + 本手变化（`+20` 绿色 / `-15` 红色）。第 1 名旁边加个 👑。

- [ ] **Step 1: 组件**

```tsx
'use client'
import { useMatchViewStore } from '@/store/match-view-store'
import { Crown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export function LiveScoreboard() {
  const players = useMatchViewStore(s => s.derived.players)
  const chipHistory = useMatchViewStore(s => s.chipHistory)
  const last = chipHistory[chipHistory.length - 2]?.chips ?? {}

  const sorted = [...players].sort((a, b) => b.chips - a.chips)

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="mb-2 text-xs font-semibold text-neutral-400">实时排名</div>
      <ul className="space-y-1">
        <AnimatePresence>
          {sorted.map((p, idx) => {
            const delta = last[p.agentId] !== undefined ? p.chips - last[p.agentId] : 0
            return (
              <motion.li
                key={p.agentId}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/50"
              >
                <div className="w-4 text-xs text-neutral-500">{idx + 1}</div>
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-[10px] font-bold">
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 truncate text-sm">{p.name}</div>
                {idx === 0 && <Crown size={12} className="text-yellow-400" />}
                <div className="font-mono text-sm">{p.chips}</div>
                {delta !== 0 && (
                  <div className={`font-mono text-xs ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {delta > 0 ? '+' : ''}{delta}
                  </div>
                )}
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: 写渲染测试**

```tsx
import { render, screen } from '@testing-library/react'
import { LiveScoreboard } from '@/components/match/LiveScoreboard'
import { useMatchViewStore } from '@/store/match-view-store'

describe('LiveScoreboard', () => {
  it('sorts players by chips desc', () => {
    useMatchViewStore.setState({
      derived: {
        players: [
          { agentId: 'a', name: 'Alice', chips: 80, seat: 0 } as any,
          { agentId: 'b', name: 'Bob', chips: 140, seat: 1 } as any,
        ],
      } as any,
      chipHistory: [],
    })
    render(<LiveScoreboard />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Bob')
    expect(items[1]).toHaveTextContent('Alice')
  })
})
```

Run: `npx vitest run tests/components/LiveScoreboard.test.tsx`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add components/match/LiveScoreboard.tsx tests/components/LiveScoreboard.test.tsx
git commit -m "feat(p1b-4): LiveScoreboard with live diff + crown"
```

---

## Task 5: ChipChart（筹码折线图）

**Files:**
- Create: `components/match/ChipChart.tsx`
- Modify: `package.json`（加 `recharts`）

**Context:** 用 Recharts 折线图画每位 agent 的筹码曲线。X 轴=手牌编号，Y 轴=筹码。数据源是 `chipHistory`。

- [ ] **Step 1: 安装 recharts**

```bash
npm install recharts
```

- [ ] **Step 2: 组件**

```tsx
'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useMatchViewStore } from '@/store/match-view-store'
import { useMemo } from 'react'

const COLORS = ['#10b981', '#3b82f6', '#eab308', '#ef4444', '#a855f7', '#06b6d4']

export function ChipChart() {
  const chipHistory = useMatchViewStore(s => s.chipHistory)
  const players = useMatchViewStore(s => s.derived.players)

  const data = useMemo(() => {
    // 把 chipHistory 转成 [{ hand: 1, a: 100, b: 150 }, ...]
    return chipHistory.map(snap => ({
      hand: snap.handNumber,
      ...snap.chips,
    }))
  }, [chipHistory])

  if (data.length === 0) {
    return (
      <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3 text-center text-xs text-neutral-500">
        还没有已完成的手牌
      </div>
    )
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="mb-2 text-xs font-semibold text-neutral-400">筹码曲线</div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
          <XAxis dataKey="hand" stroke="#737373" fontSize={10} />
          <YAxis stroke="#737373" fontSize={10} />
          <Tooltip contentStyle={{ background: '#0a0a0a', border: '1px solid #262626', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {players.map((p, i) => (
            <Line
              key={p.agentId}
              type="monotone"
              dataKey={p.agentId}
              name={p.name}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/match/ChipChart.tsx package.json package-lock.json
git commit -m "feat(p1b-4): ChipChart with recharts"
```

---

## Task 6: ActionLog + ThinkingLog（Tabs）

**Files:**
- Create: `components/match/ActionLog.tsx`
- Create: `components/match/ThinkingLog.tsx`

**Context:** 两个滚动列表，分别显示 `event.kind === 'action_taken'` 和 `event.kind === 'agent_thinking'`。共用同一容器通过 `Tabs`（shadcn/ui）切换。

- [ ] **Step 1: ActionLog**

```tsx
'use client'
import { useMatchViewStore } from '@/store/match-view-store'
import { useEffect, useRef } from 'react'

function describe(event: any): string {
  if (event.kind !== 'action_taken') return ''
  const a = event.action
  if (a.type === 'fold') return `${event.agentName} fold`
  if (a.type === 'check') return `${event.agentName} check`
  if (a.type === 'call') return `${event.agentName} call ${a.amount ?? ''}`
  if (a.type === 'bet') return `${event.agentName} bet ${a.amount}`
  if (a.type === 'raise') return `${event.agentName} raise to ${a.amount}`
  if (a.type === 'all_in') return `${event.agentName} all-in ${a.amount}`
  return `${event.agentName} ${a.type}`
}

export function ActionLog() {
  const events = useMatchViewStore(s => s.events)
  const ref = useRef<HTMLDivElement>(null)
  const actions = events.filter(e => e.kind === 'action_taken')

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [actions.length])

  return (
    <div ref={ref} className="h-56 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900/50 p-2 text-xs font-mono">
      {actions.length === 0 ? (
        <div className="text-neutral-500">等待行动…</div>
      ) : (
        <ul className="space-y-1">
          {actions.map((e: any, i) => (
            <li key={i} className="text-neutral-300">
              <span className="text-neutral-500">#{e.handNumber}</span>{' '}
              {describe(e)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: ThinkingLog**

```tsx
'use client'
import { useMatchViewStore } from '@/store/match-view-store'
import { useEffect, useRef } from 'react'

export function ThinkingLog() {
  const events = useMatchViewStore(s => s.events)
  const ref = useRef<HTMLDivElement>(null)
  const thinks = events.filter(e => e.kind === 'agent_thinking')

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [thinks.length])

  return (
    <div ref={ref} className="h-56 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-900/50 p-2 text-xs">
      {thinks.length === 0 ? (
        <div className="text-neutral-500">等待思考…</div>
      ) : (
        <ul className="space-y-2">
          {thinks.map((e: any, i) => (
            <li key={i} className="border-l-2 border-emerald-500 pl-2">
              <div className="text-[10px] text-neutral-500">{e.agentName} · 手 #{e.handNumber}</div>
              <div className="whitespace-pre-wrap text-neutral-300">{e.text}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/match/ActionLog.tsx components/match/ThinkingLog.tsx
git commit -m "feat(p1b-4): ActionLog + ThinkingLog"
```

---

## Task 7: RightPanel 容器 + Tabs

**Files:**
- Create: `components/match/RightPanel.tsx`
- Modify: `app/matches/[matchId]/SpectatorView.tsx`（接入）

**Context:** 右侧 `w-80` 容器，从上到下：ErrorBadge 行 → LiveScoreboard → Tabs(Actions / Thinking) → ChipChart。

- [ ] **Step 1: RightPanel**

```tsx
'use client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LiveScoreboard } from './LiveScoreboard'
import { ActionLog } from './ActionLog'
import { ThinkingLog } from './ThinkingLog'
import { ChipChart } from './ChipChart'
import { ErrorBadge } from './ErrorBadge'

export function RightPanel({ matchId }: { matchId: string }) {
  return (
    <aside className="flex w-80 flex-col gap-3 border-l border-neutral-800 bg-neutral-950 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">对局信息</div>
        <ErrorBadge matchId={matchId} />
      </div>
      <LiveScoreboard />
      <Tabs defaultValue="actions">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="actions">行动</TabsTrigger>
          <TabsTrigger value="thinking">思考</TabsTrigger>
        </TabsList>
        <TabsContent value="actions" className="mt-2">
          <ActionLog />
        </TabsContent>
        <TabsContent value="thinking" className="mt-2">
          <ThinkingLog />
        </TabsContent>
      </Tabs>
      <ChipChart />
    </aside>
  )
}
```

- [ ] **Step 2: 接入 SpectatorView**

在 `app/matches/[matchId]/SpectatorView.tsx` 的根容器修改为左右布局：

```tsx
// ...existing imports
import { RightPanel } from '@/components/match/RightPanel'

// 在 return 里：
return (
  <div className="flex min-h-screen bg-neutral-950 text-neutral-100">
    <div className="flex-1 p-4">
      <PokerBoard />
    </div>
    <RightPanel matchId={matchId} />
  </div>
)
```

- [ ] **Step 3: 确认 shadcn/ui 有 tabs**

```bash
npx shadcn@latest add tabs popover badge
```

（P1b-2 已装了 badge，这里补 tabs/popover。）

- [ ] **Step 4: Commit**

```bash
git add components/match/RightPanel.tsx app/matches/\[matchId\]/SpectatorView.tsx components/ui/
git commit -m "feat(p1b-4): RightPanel integrates scoreboard/logs/chart"
```

---

## Task 8: RankingPanel（赛后弹窗）

**Files:**
- Create: `components/match/RankingPanel.tsx`
- Modify: `app/matches/[matchId]/SpectatorView.tsx`

**Context:** 当 store 的 `derived.status === 'settled'` 时自动弹出 Dialog，展示最终排名、每位的盈亏、总手数、可返回大厅。

- [ ] **Step 1: 组件**

```tsx
'use client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useMatchViewStore } from '@/store/match-view-store'
import { useRouter } from 'next/navigation'
import { Trophy } from 'lucide-react'

const MEDAL = ['🥇', '🥈', '🥉']

export function RankingPanel({ initialChips }: { initialChips: number }) {
  const status = useMatchViewStore(s => s.derived.status)
  const players = useMatchViewStore(s => s.derived.players)
  const router = useRouter()
  const open = status === 'settled'

  const sorted = [...players].sort((a, b) => b.chips - a.chips)

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="text-yellow-400" /> 对局结束
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {sorted.map((p, idx) => {
            const delta = p.chips - initialChips
            return (
              <div key={p.agentId} className="flex items-center gap-3 rounded border border-neutral-800 px-3 py-2">
                <div className="text-2xl">{MEDAL[idx] ?? `#${idx + 1}`}</div>
                <div className="flex-1">
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-neutral-400">最终筹码 {p.chips}</div>
                </div>
                <div className={`font-mono ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {delta >= 0 ? '+' : ''}{delta}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push('/')}>返回大厅</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 接入 SpectatorView**

```tsx
import { RankingPanel } from '@/components/match/RankingPanel'

// 在 return 内插入（initialChips 从 match 初始数据来）
<RankingPanel initialChips={match.config.initialChips} />
```

- [ ] **Step 3: 安装 shadcn dialog**

```bash
npx shadcn@latest add dialog
```

- [ ] **Step 4: 手动验证**

- 启动 dev：`npm run dev`
- 创建一个 6 座位 match，跑到结束
- Expected: 结束瞬间弹 `RankingPanel`，显示 3 种奖牌 emoji + 盈亏着色

- [ ] **Step 5: Commit**

```bash
git add components/match/RankingPanel.tsx app/matches/\[matchId\]/SpectatorView.tsx components/ui/dialog.tsx
git commit -m "feat(p1b-4): RankingPanel on match settlement"
```

---

## Task 9: ingestEvent 补齐 settled 状态

**Files:**
- Modify: `store/match-view-store.ts`
- Modify: `tests/store/match-view-store.test.ts`

**Context:** 目前 store 的 `derived.status` 可能没有在 `match_end` / `settlement` 事件里更新为 `'settled'`。补上。

- [ ] **Step 1: 写失败测试**

```typescript
it('sets status to settled on match_end event', () => {
  const store = useMatchViewStore.getState()
  store.reset()
  store.ingestEvent({ kind: 'match_end' } as any)
  expect(useMatchViewStore.getState().derived.status).toBe('settled')
})
```

Run: `npx vitest run tests/store/match-view-store.test.ts -t "match_end"`
Expected: FAIL。

- [ ] **Step 2: 实现**

在 `ingestEvent` 里追加：

```typescript
case 'match_end':
case 'settlement':
  set(state => ({
    derived: { ...state.derived, status: 'settled' },
  }))
  break
```

Run: `npx vitest run tests/store/match-view-store.test.ts -t "match_end"`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add store/match-view-store.ts tests/store/match-view-store.test.ts
git commit -m "feat(p1b-4): mark match settled on match_end event"
```

---

## Task 10: 手动端到端验证 P1b-4

- [ ] **Step 1: 启动栈**

```bash
npm run db:push
docker compose up -d redis
npm run dev
```

- [ ] **Step 2: 创建并观战 match**

1. 访问 `/matches/new`
2. 选 6 个 bot profile/agent，start match
3. 跳转到 `/matches/:id`

- [ ] **Step 3: 核对清单**

- [ ] 右侧 `LiveScoreboard` 按筹码实时排序，第 1 名有 👑
- [ ] 切换 Tabs → `ActionLog` 滚动追加行动
- [ ] 切换到 Thinking → 能看到每手开始的 thinking 文本（bot 不生成真思考时允许为空列表）
- [ ] 每手结束后 `ChipChart` 多一个数据点
- [ ] 手动触发一个 agent_error（例如把某个 agent profile 的 base URL 设为无效地址），`ErrorBadge` 出现红色数字
- [ ] match 自动结束后弹出 `RankingPanel`，显示排名 + 盈亏

- [ ] **Step 4: 记录**

截图或日志保留，提交 commit。

```bash
git add -A
git commit -m "chore(p1b-4): manual e2e verification passed" --allow-empty
```

---

## Done criteria (Phase 1b-4)

- [ ] `LiveScoreboard` 实时显示排名和每手筹码变化
- [ ] `ChipChart` 折线图展示每位 agent 的筹码历史
- [ ] `ActionLog` / `ThinkingLog` Tab 可切换
- [ ] `ErrorBadge` 能显示错误计数并 Popover 展示最近错误
- [ ] `RankingPanel` 在 match 结束时自动弹出
- [ ] `match-view-store` 包含 `chipHistory` / `errorCount` / `status` 派生
- [ ] `npm run lint` / `npx vitest run` 全绿
- [ ] 手动创建 6-bot match 完整跑完，所有组件正常显示

完成后进入 **Phase 1b-5**：6 个真实 LLM agents 全流程演示。
