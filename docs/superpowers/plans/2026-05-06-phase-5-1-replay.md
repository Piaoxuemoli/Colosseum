# Phase 5-1 — 回放播放器 UI（读取 game_events 重建观战视图）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 已结束的 match 支持"回放"。`game_events` 表全量落库（Phase 1 起），Phase 5-1 消费它驱动和观战页同样的 UI：进度条拖拽 / 步进 / 倍速播放。

**Architecture:**
- 新路由 `/matches/[matchId]/replay`：Server 读 match + 事件切片；Client 把事件喂进已有 `match-view-store`
- 新组件 `ReplayControls`（play/pause/step/speed）
- 复用 `PokerBoard` / `WerewolfBoard`（无需重写）
- 复用 `match-view-store` 的 reducer（ingestEvent）——回放和直播使用同一套派生逻辑

**前置条件：** Phase 4 完成；`game_events` 已永久保存。

**参考 spec:** 第 14 节 Phase 5（回放）+ 第 8.4 数据生命周期。

**不做的事：**
- ❌ 回放视频导出（延后）
- ❌ 跨 match 对比

---

## 文件结构

```
Colosseum/
├── app/matches/[matchId]/replay/
│   ├── page.tsx                     # Server：读 match + 事件
│   └── ReplayView.tsx               # 'use client'
├── components/match/
│   └── ReplayControls.tsx           # 控件条
├── store/
│   └── replay-store.ts              # 回放专用（播放状态）
├── db/queries/
│   └── events.ts                    # Modify: listByMatch 分页
└── tests/
    ├── store/replay-store.test.ts
    └── components/ReplayControls.test.tsx
```

---

## Task 1: events query 分页 + 全量读取

**Files:**
- Modify: `db/queries/events.ts`

- [ ] **Step 1: 追加 query**

```typescript
// db/queries/events.ts
import { asc, eq, and, gt } from 'drizzle-orm'
import { db } from '../index'
import { gameEvents } from '../schema'

export async function listAllEventsByMatch(matchId: string) {
  return db.select()
    .from(gameEvents)
    .where(eq(gameEvents.matchId, matchId))
    .orderBy(asc(gameEvents.seq))
}

export async function listEventsAfter(matchId: string, seq: number, limit = 100) {
  return db.select()
    .from(gameEvents)
    .where(and(eq(gameEvents.matchId, matchId), gt(gameEvents.seq, seq)))
    .orderBy(asc(gameEvents.seq))
    .limit(limit)
}
```

- [ ] **Step 2: Commit**

```bash
git add db/queries/events.ts
git commit -m "feat(p5-1): list all events by match for replay"
```

---

## Task 2: replay-store

**Files:**
- Create: `store/replay-store.ts`
- Create: `tests/store/replay-store.test.ts`

**Context:** 播放状态：`events`, `cursor`(已消费的事件 index), `isPlaying`, `speed`(0.5/1/2/4), `tick()` 按 speed 推进 cursor 一个 event。

- [ ] **Step 1: 实现**

```typescript
// store/replay-store.ts
import { create } from 'zustand'
import { useMatchViewStore } from './match-view-store'

interface ReplayState {
  events: any[]
  cursor: number              // 下一个将要消费的 event index
  isPlaying: boolean
  speed: number
  intervalMs: number          // 基础间隔
  load(events: any[]): void
  play(): void
  pause(): void
  stepForward(): void
  stepBackward(): void
  seekTo(index: number): void
  setSpeed(s: number): void
  tickOne(): void             // 消费一个 event 到 match-view-store
  reset(): void
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  events: [],
  cursor: 0,
  isPlaying: false,
  speed: 1,
  intervalMs: 500,

  load(events) {
    const vs = useMatchViewStore.getState()
    vs.reset()
    set({ events, cursor: 0, isPlaying: false })
  },

  play() { set({ isPlaying: true }) },
  pause() { set({ isPlaying: false }) },
  setSpeed(s) { set({ speed: s }) },

  stepForward() {
    get().tickOne()
  },

  stepBackward() {
    const { events, cursor } = get()
    const newCursor = Math.max(0, cursor - 1)
    // 回退：reset view-store 然后回放到 newCursor
    useMatchViewStore.getState().reset()
    const vs = useMatchViewStore.getState()
    for (let i = 0; i < newCursor; i++) vs.ingestEvent(events[i])
    set({ cursor: newCursor })
  },

  seekTo(index) {
    const { events } = get()
    const target = Math.max(0, Math.min(events.length, index))
    useMatchViewStore.getState().reset()
    const vs = useMatchViewStore.getState()
    for (let i = 0; i < target; i++) vs.ingestEvent(events[i])
    set({ cursor: target })
  },

  tickOne() {
    const { events, cursor } = get()
    if (cursor >= events.length) { set({ isPlaying: false }); return }
    useMatchViewStore.getState().ingestEvent(events[cursor])
    set({ cursor: cursor + 1 })
  },

  reset() {
    useMatchViewStore.getState().reset()
    set({ events: [], cursor: 0, isPlaying: false })
  },
}))
```

- [ ] **Step 2: 测试**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useReplayStore } from '@/store/replay-store'
import { useMatchViewStore } from '@/store/match-view-store'

describe('replay-store', () => {
  beforeEach(() => {
    useReplayStore.getState().reset()
  })

  it('load + stepForward feeds match-view-store', () => {
    useReplayStore.getState().load([
      { kind: 'hand_over', handNumber: 1, chips: { a: 100 } } as any,
      { kind: 'hand_over', handNumber: 2, chips: { a: 150 } } as any,
    ])
    useReplayStore.getState().stepForward()
    expect(useReplayStore.getState().cursor).toBe(1)
    expect(useMatchViewStore.getState().chipHistory).toHaveLength(1)
  })

  it('seekTo replays from scratch', () => {
    useReplayStore.getState().load([
      { kind: 'hand_over', handNumber: 1, chips: { a: 100 } } as any,
      { kind: 'hand_over', handNumber: 2, chips: { a: 150 } } as any,
      { kind: 'hand_over', handNumber: 3, chips: { a: 200 } } as any,
    ])
    useReplayStore.getState().seekTo(2)
    expect(useReplayStore.getState().cursor).toBe(2)
    expect(useMatchViewStore.getState().chipHistory).toHaveLength(2)
  })

  it('stepBackward removes last event by replay', () => {
    useReplayStore.getState().load([
      { kind: 'hand_over', handNumber: 1, chips: { a: 100 } } as any,
      { kind: 'hand_over', handNumber: 2, chips: { a: 150 } } as any,
    ])
    useReplayStore.getState().stepForward()
    useReplayStore.getState().stepForward()
    expect(useMatchViewStore.getState().chipHistory).toHaveLength(2)
    useReplayStore.getState().stepBackward()
    expect(useMatchViewStore.getState().chipHistory).toHaveLength(1)
  })
})
```

Run: `npx vitest run tests/store/replay-store.test.ts`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add store/replay-store.ts tests/store/replay-store.test.ts
git commit -m "feat(p5-1): replay-store (play/step/seek)"
```

---

## Task 3: ReplayControls 组件

**Files:**
- Create: `components/match/ReplayControls.tsx`

**Context:** 底部悬浮条：◀◀ ◀ ⏸/▶ ▶ ▶▶ + 进度条 + 速度下拉。

- [ ] **Step 1: 组件**

```tsx
// components/match/ReplayControls.tsx
'use client'
import { useEffect } from 'react'
import { useReplayStore } from '@/store/replay-store'
import { Button } from '@/components/ui/button'
import { Play, Pause, SkipBack, SkipForward, Rewind, FastForward } from 'lucide-react'

const SPEEDS = [0.5, 1, 2, 4]

export function ReplayControls() {
  const { cursor, events, isPlaying, speed, intervalMs, play, pause, stepForward, stepBackward, seekTo, setSpeed, tickOne } = useReplayStore()

  useEffect(() => {
    if (!isPlaying) return
    const t = setInterval(() => tickOne(), intervalMs / speed)
    return () => clearInterval(t)
  }, [isPlaying, speed, intervalMs, tickOne])

  const total = events.length
  const pct = total === 0 ? 0 : (cursor / total) * 100

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-neutral-800 bg-neutral-950/90 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => seekTo(0)} title="回到开头">
          <Rewind size={16} />
        </Button>
        <Button size="icon" variant="ghost" onClick={stepBackward} title="上一步">
          <SkipBack size={16} />
        </Button>
        <Button size="icon" variant="default" onClick={() => (isPlaying ? pause() : play())}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </Button>
        <Button size="icon" variant="ghost" onClick={stepForward} title="下一步">
          <SkipForward size={16} />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => seekTo(total)} title="跳到末尾">
          <FastForward size={16} />
        </Button>

        <div className="flex-1">
          <div className="relative h-2 rounded bg-neutral-800">
            <div className="absolute inset-y-0 left-0 rounded bg-emerald-500" style={{ width: `${pct}%` }} />
            <input
              type="range"
              min={0} max={total} value={cursor}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <div className="mt-1 text-[10px] text-neutral-500 text-center">
            {cursor} / {total}
          </div>
        </div>

        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
        >
          {SPEEDS.map(s => <option key={s} value={s}>{s}x</option>)}
        </select>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 简单渲染测试**

```tsx
// tests/components/ReplayControls.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ReplayControls } from '@/components/match/ReplayControls'
import { useReplayStore } from '@/store/replay-store'

describe('ReplayControls', () => {
  it('renders with 0/0', () => {
    useReplayStore.getState().reset()
    render(<ReplayControls />)
    expect(screen.getByText('0 / 0')).toBeInTheDocument()
  })

  it('play toggles to pause', () => {
    useReplayStore.getState().reset()
    useReplayStore.getState().load([{ kind: 'x' } as any])
    render(<ReplayControls />)
    const btn = screen.getAllByRole('button')[2]   // 中间播放按钮
    fireEvent.click(btn)
    expect(useReplayStore.getState().isPlaying).toBe(true)
  })
})
```

Run: `npx vitest run tests/components/ReplayControls.test.tsx`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add components/match/ReplayControls.tsx tests/components/ReplayControls.test.tsx
git commit -m "feat(p5-1): ReplayControls bar"
```

---

## Task 4: Replay page + ReplayView

**Files:**
- Create: `app/matches/[matchId]/replay/page.tsx`
- Create: `app/matches/[matchId]/replay/ReplayView.tsx`

**Context:** Server 读 match 元数据 + 全部事件；Client load 到 replay-store；根据 gameType 渲染 PokerBoard / WerewolfBoard。

- [ ] **Step 1: page.tsx**

```tsx
// app/matches/[matchId]/replay/page.tsx
import { notFound } from 'next/navigation'
import { getMatch } from '@/db/queries/matches'
import { listAllEventsByMatch } from '@/db/queries/events'
import ReplayView from './ReplayView'

export default async function ReplayPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params
  const match = await getMatch(matchId)
  if (!match) notFound()
  const events = await listAllEventsByMatch(matchId)
  return <ReplayView match={match} events={events} />
}
```

- [ ] **Step 2: ReplayView.tsx**

```tsx
// app/matches/[matchId]/replay/ReplayView.tsx
'use client'
import { useEffect } from 'react'
import { useReplayStore } from '@/store/replay-store'
import { PokerBoard } from '@/games/poker/ui/PokerBoard'
import { WerewolfBoard } from '@/games/werewolf/ui/WerewolfBoard'
import { ReplayControls } from '@/components/match/ReplayControls'
import { RightPanel } from '@/components/match/RightPanel'
import Link from 'next/link'

export default function ReplayView({ match, events }: { match: any; events: any[] }) {
  const load = useReplayStore(s => s.load)
  useEffect(() => { load(events) }, [load, events])

  return (
    <div className="flex min-h-screen pb-20 bg-neutral-950 text-neutral-100">
      <div className="flex-1">
        <div className="flex items-center gap-3 border-b border-neutral-800 p-2 text-sm">
          <Link href={`/matches/${match.id}`} className="text-emerald-400 hover:underline">← 返回观战页</Link>
          <span className="text-neutral-500">回放模式 · 共 {events.length} 个事件</span>
        </div>
        {match.gameType === 'poker' ? <PokerBoard /> : <WerewolfBoard />}
      </div>
      <RightPanel matchId={match.id} />
      <ReplayControls />
    </div>
  )
}
```

- [ ] **Step 3: 入口按钮**

在 `/matches/[matchId]/SpectatorView.tsx` 结束后的 `RankingPanel` / `WerewolfResultPanel` 内加 "查看回放" 按钮：

```tsx
<Button variant="secondary" onClick={() => router.push(`/matches/${match.id}/replay`)}>
  查看回放
</Button>
```

在 Lobby / 历史列表里，已结束 match 每行也加 "回放" 链接。

- [ ] **Step 4: 手动验证**

```bash
npm run dev
# 打开一个已 settled 的 match 的 replay 页面
# 点 ▶ 自动播放；拖动进度条；切换 0.5x / 2x / 4x 速度
```

- [ ] **Step 5: Commit**

```bash
git add app/matches/\[matchId\]/replay app/matches/\[matchId\]/SpectatorView.tsx
git commit -m "feat(p5-1): /matches/:id/replay page"
```

---

## Done criteria (Phase 5-1)

- [ ] replay-store 支持 play/pause/step/seek/speed
- [ ] ReplayControls 底部条可用
- [ ] `/matches/:id/replay` 能正确重放 poker / werewolf match
- [ ] 从 Spectator / Lobby 都能跳进 replay
- [ ] lint / tsc / vitest 全绿
