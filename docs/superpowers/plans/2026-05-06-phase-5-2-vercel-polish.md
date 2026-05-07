# Phase 5-2 — Vercel Fallback 部署 + Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 当云服务器不可用（面试现场 demo 风险兜底），能一条命令把同一份代码部署到 Vercel，DB 切 Supabase，Redis 切 Upstash；另外若干 UX polish（空状态 / 错误提示 / 键盘快捷键 / 移动端 responsive 初版）。

**Architecture:**
- 通过环境变量切换：`DATABASE_URL` 指向 Supabase（Postgres）；引入 Upstash Redis REST SDK，封一层 adapter 做 `node:redis` vs Upstash 的切换
- 所有 Route Handler 已是 `export const runtime = 'nodejs'`（Phase 0 默认）
- `vercel.json` 配置部署入口 + env 映射
- UX polish：表单错误 Toast / 空状态图文 / `?` 键显示快捷键
- 响应式：断点 `sm/md/lg`；桌面保持 1200px+ 布局，平板/手机竖排

**前置条件：** Phase 4（Docker）完成；对比测试已建立信心。

**参考 spec:** 第 12.6 节（Vercel fallback）+ 第 14 节 Phase 5。

**不做的事：**
- ❌ 原生 App（始终 Web）
- ❌ 多语言（仅中文）

---

## 文件结构

```
Colosseum/
├── lib/redis/
│   ├── index.ts                      # 已有：getRedis()；Modify: 根据 env 选 adapter
│   ├── node-redis-adapter.ts         # 已有，重命名/整理
│   └── upstash-adapter.ts            # 新增
├── vercel.json
├── .env.vercel.example
├── docs/deploy/
│   └── vercel.md
├── components/
│   ├── Empty.tsx                     # 空状态组件
│   └── Shortcuts.tsx                 # `?` 键盘快捷键面板
├── styles/
│   └── responsive.css                # 断点微调
└── app/
    └── layout.tsx                    # Modify: Shortcuts 全局挂载
```

---

## Task 1: Redis Adapter 抽象

**Files:**
- Modify: `lib/redis/index.ts`
- Create: `lib/redis/upstash-adapter.ts`
- Create: `tests/redis/adapter.test.ts`

**Context:** 抽一个最小接口：`get(k) / set(k, v, ex?) / del(k) / publish(ch, payload) / subscribe(ch, cb)`。本地/Docker 用 `ioredis`；Vercel 用 Upstash REST + SSE。Pub/Sub 在 Upstash 免费版不支持，用数据库轮询兜底（delay 1-2s 可接受于 fallback 场景）。

- [ ] **Step 1: 接口**

```typescript
// lib/redis/index.ts
export interface RedisLike {
  get(k: string): Promise<string | null>
  set(k: string, v: string, opts?: { ex?: number }): Promise<void>
  del(k: string): Promise<void>
  publish(ch: string, payload: string): Promise<void>
  subscribe(ch: string, onMessage: (payload: string) => void): () => void
  acquireLock?(k: string, ttlSec: number): Promise<boolean>
}

let _instance: RedisLike | null = null

export function getRedis(): RedisLike {
  if (_instance) return _instance
  if (process.env.UPSTASH_REDIS_REST_URL) {
    _instance = require('./upstash-adapter').createUpstashAdapter()
  } else {
    _instance = require('./node-redis-adapter').createNodeAdapter()
  }
  return _instance!
}
```

- [ ] **Step 2: upstash-adapter**

```typescript
// lib/redis/upstash-adapter.ts
import { Redis } from '@upstash/redis'
import type { RedisLike } from './index'

export function createUpstashAdapter(): RedisLike {
  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })

  return {
    async get(k) { return (await r.get<string>(k)) ?? null },
    async set(k, v, opts) {
      if (opts?.ex) await r.set(k, v, { ex: opts.ex })
      else await r.set(k, v)
    },
    async del(k) { await r.del(k) },

    // Upstash 不原生支持 pub/sub；使用 list-polling 兜底
    async publish(ch, payload) {
      await r.lpush(`ch:${ch}`, payload)
      await r.expire(`ch:${ch}`, 300)
    },
    subscribe(ch, onMessage) {
      let stopped = false
      ;(async () => {
        while (!stopped) {
          const msg = await r.rpop<string>(`ch:${ch}`)
          if (msg) onMessage(msg)
          else await new Promise(r => setTimeout(r, 800))
        }
      })()
      return () => { stopped = true }
    },

    async acquireLock(k, ttlSec) {
      const res = await r.set(k, '1', { nx: true, ex: ttlSec })
      return res === 'OK'
    },
  }
}
```

- [ ] **Step 3: 安装**

```bash
npm install @upstash/redis
```

- [ ] **Step 4: 冒烟测试**

```typescript
// tests/redis/adapter.test.ts
// 单测 mock fetch 对 Upstash 的 http 请求；验证 get/set/del 走对路径
import { describe, it, expect, vi } from 'vitest'

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn(async () => 'x'),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    lpush: vi.fn(), expire: vi.fn(), rpop: vi.fn(async () => null),
  })),
}))

describe('upstash adapter', () => {
  it('get returns null-safe string', async () => {
    const { createUpstashAdapter } = await import('@/lib/redis/upstash-adapter')
    const a = createUpstashAdapter()
    expect(await a.get('k')).toBe('x')
  })
})
```

Run: `npx vitest run tests/redis/adapter.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add lib/redis package.json package-lock.json tests/redis/adapter.test.ts
git commit -m "feat(p5-2): Upstash redis adapter"
```

---

## Task 2: vercel.json + env 模板

**Files:**
- Create: `vercel.json`
- Create: `.env.vercel.example`
- Create: `docs/deploy/vercel.md`

- [ ] **Step 1: vercel.json**

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "functions": {
    "app/api/**/route.ts": { "maxDuration": 60 }
  }
}
```

- [ ] **Step 2: .env.vercel.example**

```env
DATABASE_URL=postgresql://postgres:<pwd>@db.<proj>.supabase.co:5432/postgres
UPSTASH_REDIS_REST_URL=https://<id>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
BASE_URL=https://<vercel-project>.vercel.app
MATCH_TOKEN_SECRET=<32-byte-random>
SYSTEM_MODERATOR_BASE_URL=https://api.deepseek.com/v1
SYSTEM_MODERATOR_MODEL=deepseek-chat
```

- [ ] **Step 3: docs/deploy/vercel.md**

````markdown
# Vercel Fallback 部署

## 前置
- Supabase 账号（免费）：建 postgres 项目，取 DATABASE_URL（连接串用 "transaction" / "pooler" 端口避免冷启动 TCP 限制）
- Upstash 账号（免费）：建 Redis 数据库，取 REST URL / TOKEN
- Vercel 账号 + GitHub 连接

## 首次
1. `vercel link` 关联本仓库
2. 在 Vercel Dashboard → Project → Settings → Environment Variables，把 `.env.vercel.example` 列出的变量全部填入
3. 本地本次部署：
```bash
vercel --prod
```
4. 首次部署后，在本地用 `DATABASE_URL` 指到 Supabase，跑：
```bash
DATABASE_URL=<supabase-url> npx drizzle-kit migrate
```
5. 默认 moderator seed：
```bash
DATABASE_URL=<supabase-url> npm run db:seed
```

## 日常更新
- push 到 main 分支，Vercel 自动构建 + 部署

## 与云服务器的差异
- Pub/Sub 退化为 list-polling（~800ms 延迟）
- 单函数 maxDuration 60s（够 LLM 一回合思考）
- 多实例无共享内存；match-token 已用 HMAC（Phase 2-2）；key-cache 仍 in-process，**多实例下可能 cache miss** ⇒ 客户端需要重新 upload key（P1b-5 keyring 上传端点幂等）

## 回切
Vercel 只作 fallback，日常仍用云服务器
````

- [ ] **Step 4: Commit**

```bash
git add vercel.json .env.vercel.example docs/deploy/vercel.md
git commit -m "docs(p5-2): Vercel fallback config + guide"
```

---

## Task 3: 空状态组件

**Files:**
- Create: `components/Empty.tsx`

**Context:** Lobby / Agent 管理 / Profile 管理的空表格，替换为图文 + 引导按钮。

- [ ] **Step 1: 组件**

```tsx
// components/Empty.tsx
'use client'
import { ReactNode } from 'react'
import { Button } from './ui/button'
import { Sparkles } from 'lucide-react'

export function Empty({
  title, description, cta, icon,
}: { title: string; description: string; cta?: { label: string; onClick: () => void }; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 p-10 text-center">
      <div className="mb-3 text-neutral-500">{icon ?? <Sparkles size={32} />}</div>
      <div className="mb-1 text-lg font-semibold">{title}</div>
      <div className="mb-4 max-w-sm text-sm text-neutral-500">{description}</div>
      {cta && <Button onClick={cta.onClick}>{cta.label}</Button>}
    </div>
  )
}
```

- [ ] **Step 2: 接入 3 个页面**

`app/page.tsx`（Lobby）、`app/agents/page.tsx`、`app/profiles/page.tsx` 在数据为空时渲染 `<Empty ... />`。

- [ ] **Step 3: Commit**

```bash
git add components/Empty.tsx app/page.tsx app/agents/page.tsx app/profiles/page.tsx
git commit -m "feat(p5-2): Empty state component + usage"
```

---

## Task 4: 键盘快捷键 + Shortcuts 面板

**Files:**
- Create: `components/Shortcuts.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: 组件**

```tsx
// components/Shortcuts.tsx
'use client'
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { useRouter } from 'next/navigation'

const SHORTCUTS = [
  { keys: '?', desc: '显示这个面板' },
  { keys: 'g h', desc: '去 Lobby' },
  { keys: 'g a', desc: '去 Agents' },
  { keys: 'g p', desc: '去 Profiles' },
  { keys: 'n', desc: '新建对局' },
  { keys: 'Space', desc: '（回放）暂停 / 播放' },
]

export function Shortcuts() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let buf = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === '?') { setOpen(v => !v); return }
      if (e.key === 'n') { router.push('/matches/new'); return }
      if (e.key === 'g') {
        buf = 'g'
        timer && clearTimeout(timer)
        timer = setTimeout(() => (buf = ''), 800)
        return
      }
      if (buf === 'g') {
        if (e.key === 'h') router.push('/')
        else if (e.key === 'a') router.push('/agents')
        else if (e.key === 'p') router.push('/profiles')
        buf = ''
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>键盘快捷键</DialogTitle></DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS.map(s => (
            <li key={s.keys} className="flex items-center justify-between text-sm">
              <span>{s.desc}</span>
              <kbd className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-xs">{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 全局挂载**

`app/layout.tsx`：

```tsx
import { Shortcuts } from '@/components/Shortcuts'
// ...
<body>{children}<Shortcuts /></body>
```

- [ ] **Step 3: Commit**

```bash
git add components/Shortcuts.tsx app/layout.tsx
git commit -m "feat(p5-2): keyboard shortcuts (? / g h / g a / g p / n)"
```

---

## Task 5: 响应式初版

**Files:**
- Modify: `games/poker/ui/PokerBoard.tsx`
- Modify: `games/werewolf/ui/WerewolfBoard.tsx`
- Modify: `components/match/RightPanel.tsx`

**Context:** Tailwind 断点：
- `< md`：右侧 RightPanel 变底部 Sheet（不常驻）
- `< md`：PokerBoard 椭圆改为堆叠 2×3 卡片
- `< md`：WerewolfBoard 3 列改为 1 列上下滚动

简单做法：用 `md:grid-cols-xxx` 条件类。

- [ ] **Step 1: 改 RightPanel 为 Sheet**

```tsx
// components/match/RightPanel.tsx
'use client'
import { useState } from 'react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-react'
// ... existing

export function RightPanel({ matchId }: { matchId: string }) {
  return (
    <>
      {/* 桌面 */}
      <aside className="hidden md:flex w-80 flex-col gap-3 border-l border-neutral-800 bg-neutral-950 p-3">
        {/* 原有内容 */}
      </aside>
      {/* 移动端 */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="md:hidden fixed bottom-4 right-4 z-50 rounded-full">
            <Menu size={18} />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80">
          {/* 同一套内容 */}
        </SheetContent>
      </Sheet>
    </>
  )
}
```

安装 sheet：
```bash
npx shadcn@latest add sheet
```

- [ ] **Step 2: PokerBoard 两套布局**

把原椭圆桌 + 6 座位绝对定位包到 `hidden md:block` 里；`md:hidden` 下用 flex 纵向列表形式显示 6 个 `PlayerSeat`（传一个 `compact` prop）。

- [ ] **Step 3: WerewolfBoard**

三列网格加 `md:grid-cols-[1fr_2fr_1fr]`，默认 `grid-cols-1`。

- [ ] **Step 4: 手动在 Chrome DevTools toggle mobile 验证**

- [ ] **Step 5: Commit**

```bash
git add components/match/RightPanel.tsx games/poker/ui/PokerBoard.tsx games/werewolf/ui/WerewolfBoard.tsx components/ui/sheet.tsx
git commit -m "feat(p5-2): responsive initial pass (md breakpoint)"
```

---

## Task 6: 错误 Toast + 全局 ErrorBoundary

**Files:**
- Modify: `app/layout.tsx`
- Create: `components/ErrorBoundary.tsx`

**Context:** shadcn `toast` 已加装。确保 API 调用失败时统一走 Toast；组件级异常用 ErrorBoundary 捕获兜底。

- [ ] **Step 1: ErrorBoundary**

```tsx
// components/ErrorBoundary.tsx
'use client'
import { Component, ReactNode } from 'react'

interface S { hasError: boolean; err: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, S> {
  state: S = { hasError: false, err: null }
  static getDerivedStateFromError(err: Error): S { return { hasError: true, err } }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
          <div className="max-w-md rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-center">
            <div className="mb-2 text-lg font-semibold text-red-300">出错了</div>
            <div className="mb-4 text-sm text-neutral-400">{this.state.err?.message ?? 'unknown'}</div>
            <button className="rounded bg-red-500 px-3 py-1 text-sm" onClick={() => window.location.reload()}>重新加载</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: 在 layout 包裹**

```tsx
<body>
  <ErrorBoundary>
    {children}
    <Shortcuts />
    <Toaster />
  </ErrorBoundary>
</body>
```

- [ ] **Step 3: 把 `lib/client/api.ts` 内的 fetch helper 上 Toast**

```typescript
// lib/client/api.ts (节选)
import { toast } from 'sonner'

export async function apiFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    toast.error(`请求失败：${res.status} ${text.slice(0, 80)}`)
    throw new Error(`${res.status}`)
  }
  return res
}
```

- [ ] **Step 4: Commit**

```bash
git add components/ErrorBoundary.tsx app/layout.tsx lib/client/api.ts
git commit -m "feat(p5-2): ErrorBoundary + unified toast on API failure"
```

---

## Task 7: Vercel 烟测 checklist

**Files:**
- Create: `docs/demo/phase-5-m8-checklist.md`

- [ ] **Step 1: 内容**

```markdown
# Phase 5 M8 · Vercel Fallback + Polish

## Vercel
- [ ] `vercel --prod` 部署成功
- [ ] Supabase migrate 跑通（npx drizzle-kit migrate）
- [ ] 默认 moderator seed 完成
- [ ] `https://<vercel>.app/api/_health` 200
- [ ] 创建 poker match 能跑 ≥1 手（可接受 2-3s 事件延迟）
- [ ] 创建 werewolf match 能跑至 gameEnd

## UX Polish
- [ ] 空 Lobby / Profile / Agents 页面显示 Empty 组件
- [ ] 按 `?` 弹快捷键面板
- [ ] `g h` / `g a` / `g p` / `n` 快捷跳转
- [ ] 手机宽度（375px）打开观战页，能折叠/展开 RightPanel
- [ ] 让某个 API 故意 500，Toast 弹出红色错误
- [ ] 让某个组件 throw，ErrorBoundary 兜底

## 回放（P5-1 回归）
- [ ] 已 settled match 点 "查看回放" → 能完整播放
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo/phase-5-m8-checklist.md
git commit -m "docs(p5-2): M8 Vercel + polish checklist"
```

---

## Done criteria (Phase 5-2 / M8)

- [ ] Redis adapter 支持 node-redis + Upstash 切换
- [ ] `vercel.json` + `.env.vercel.example` + `docs/deploy/vercel.md`
- [ ] Vercel 部署冒烟通过
- [ ] Empty / Shortcuts / ErrorBoundary / 响应式全部落地
- [ ] M8 checklist 全绿
- [ ] lint / tsc / vitest 全绿

Colosseum 项目进入 **完整可演示 + 双线部署 + 基础 UX polish** 状态。
