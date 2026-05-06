# Phase 1b-2 — Lobby + Profile/Agent 管理 + 创建对局页

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 建设"进入到开局"之前的所有前端页面：大厅（`/`）、API Profile 管理（`/profiles`）、Agent 管理（`/agents`）、创建对局（`/matches/new`）。做到：用户能 **不写 curl**，在浏览器里走完"配 profile → 建 agent → 开新对局 → 跳到观战页" 的完整路径。

**Architecture:**
- 所有列表/详情页尽量用 **Server Component**（直接 `await fetch` 或 `await db.select`）
- 所有交互型组件（表单、按钮、对话框）用 `'use client'` + Zustand
- **API Key 仅存浏览器 localStorage**，绝不随 profile 持久化到后端
- shadcn/ui 按需复制：Button / Input / Select / Dialog / Card / Avatar / Badge / Label / Textarea

**前置条件：** P1b-1 完成（tag `phase-1b-1`，API 已全部可用）。

**参考 spec:** 第 9.1 节（页面地图）、第 9.2 节（观战页结构）、第 9.4 节（Zustand 约定）、决策 #7（Key 策略）。

**不做的事（留给 P1b-3+）：**
- ❌ 观战页（牌桌渲染、SSE 订阅）
- ❌ 赛后 RankingPanel
- ❌ LLM 调用（本 Phase 仍 Bot-only，但开对局时支持"填 key"的占位 UI，实际 Bot 对局不读 key）

---

## 文件结构

```
Colosseum/
├── app/
│   ├── page.tsx                               # Lobby (Server Component)
│   ├── profiles/
│   │   └── page.tsx                           # Profiles 管理
│   ├── agents/
│   │   └── page.tsx                           # Agents 管理
│   └── matches/
│       └── new/page.tsx                       # 创建对局
├── components/
│   ├── ui/                                    # shadcn（按需 copy）
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── select.tsx
│   │   ├── dialog.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   ├── textarea.tsx
│   │   └── avatar.tsx
│   ├── layout/
│   │   └── Sidebar.tsx                        # 左侧导航
│   └── forms/
│       ├── ProfileForm.tsx                    # 创建/编辑 profile
│       ├── AgentForm.tsx                      # 创建/编辑 agent
│       └── MatchSetupForm.tsx                 # 创建对局表单
├── store/
│   └── profile-keys-store.ts                  # localStorage keyring（仅客户端）
├── lib/
│   └── client/                                # client-only utilities
│       ├── api.ts                             # fetch wrappers
│       └── keyring.ts                         # 读写 localStorage key
└── tests/
    └── components/
        ├── ProfileForm.test.tsx
        ├── AgentForm.test.tsx
        └── MatchSetupForm.test.tsx
```

---

## Task 1: 安装 shadcn/ui 组件（按需）

**Context:** shadcn/ui 不是 npm 包，而是 CLI 把组件源码复制到 `components/ui/`。每个组件独立，可直接修改。

- [x] **Step 1: 初始化 shadcn（首次）**

Run:
```bash
npx shadcn@latest init
```

交互问答：
- style: default
- base color: slate
- css variables: yes
- tailwind prefix: 空
- src dir: no（项目根不是 src）
- alias for components: `@/components`
- alias for utils: `@/lib/utils`

Expected: 在 `components/ui/` 下生成基础文件，`lib/utils.ts` 出现 `cn()` helper。

- [x] **Step 2: 按需安装组件**

Run:
```bash
npx shadcn@latest add button input label select dialog card badge textarea avatar
```

Expected: 每个组件对应 `components/ui/<name>.tsx` 出现。

- [x] **Step 3: 验证可 import**

Create `app/_probe/page.tsx`（临时用，验证后删）：

```typescript
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export default function Probe() {
  return (
    <div className="p-8 space-y-4">
      <Button>Click</Button>
      <Badge>New</Badge>
    </div>
  )
}
```

Run `npm run dev`，访问 http://localhost:3000/_probe，应看到 Button 和 Badge。

**删除 probe 文件**：`rm -rf app/_probe`。

- [x] **Step 4: Commit**

```bash
git add components/ui/ lib/utils.ts components.json
git commit -m "feat(p1b): install shadcn/ui base components"
```

---

## Task 2: Client-only utilities（api fetch 封装 + keyring）

**Files:**
- Create: `lib/client/api.ts`
- Create: `lib/client/keyring.ts`
- Create: `tests/lib/client/keyring.test.ts`

- [x] **Step 1: 写 api fetch 封装**

Create `lib/client/api.ts`:

```typescript
'use client'

/**
 * Thin wrapper around fetch for typed API calls.
 * All endpoints are same-origin, so no CORS concern.
 */

export type ApiError = { error: string; details?: unknown }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let body: ApiError = { error: res.statusText }
    try {
      body = (await res.json()) as ApiError
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${body.error}`)
  }
  // 204 no content
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
```

- [x] **Step 2: 写 keyring store（localStorage）**

Create `lib/client/keyring.ts`:

```typescript
'use client'

/**
 * API key 仅存浏览器 localStorage（spec 决策 #7）。
 * 永远不随 Profile 发给后端 persist。
 */

const STORAGE_KEY = 'colosseum:profile-keys'

type KeyMap = Record<string, string>   // profileId → apiKey

function readAll(): KeyMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as KeyMap) : {}
  } catch {
    return {}
  }
}

function writeAll(map: KeyMap): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export const keyring = {
  get(profileId: string): string | undefined {
    return readAll()[profileId]
  },
  set(profileId: string, apiKey: string): void {
    const all = readAll()
    all[profileId] = apiKey
    writeAll(all)
  },
  remove(profileId: string): void {
    const all = readAll()
    delete all[profileId]
    writeAll(all)
  },
  all(): KeyMap {
    return readAll()
  },
  has(profileId: string): boolean {
    return !!readAll()[profileId]
  },
}
```

- [x] **Step 3: 写 keyring 测试（jsdom 环境可访问 localStorage）**

Create `tests/lib/client/keyring.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { keyring } from '@/lib/client/keyring'

describe('keyring', () => {
  beforeEach(() => localStorage.clear())

  it('set + get round trip', () => {
    keyring.set('prof_1', 'sk-abc')
    expect(keyring.get('prof_1')).toBe('sk-abc')
    expect(keyring.has('prof_1')).toBe(true)
  })

  it('remove deletes key', () => {
    keyring.set('prof_1', 'sk-abc')
    keyring.remove('prof_1')
    expect(keyring.get('prof_1')).toBeUndefined()
    expect(keyring.has('prof_1')).toBe(false)
  })

  it('all returns full map', () => {
    keyring.set('a', '1')
    keyring.set('b', '2')
    expect(keyring.all()).toEqual({ a: '1', b: '2' })
  })
})
```

- [x] **Step 4: 跑测试 + commit**

Run: `npm test tests/lib/client/keyring.test.ts`
Expected: 3 passed。

```bash
git add lib/client/ tests/lib/client/
git commit -m "feat(p1b): client api wrapper + localStorage keyring"
```

---

## Task 3: 全局 Sidebar + layout

**Files:**
- Modify: `app/layout.tsx`（加 Sidebar）
- Create: `components/layout/Sidebar.tsx`

- [x] **Step 1: 写 Sidebar**

Create `components/layout/Sidebar.tsx`:

```typescript
import Link from 'next/link'

const NAV = [
  { href: '/', label: '大厅' },
  { href: '/matches/new', label: '新对局' },
  { href: '/agents', label: 'Agents' },
  { href: '/profiles', label: 'API Profiles' },
]

export function Sidebar() {
  return (
    <aside className="w-48 h-screen border-r bg-background px-4 py-6 flex flex-col gap-2 sticky top-0">
      <h1 className="text-lg font-bold mb-4">Colosseum</h1>
      <nav className="flex flex-col gap-1">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="px-3 py-2 rounded hover:bg-accent text-sm"
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto text-xs text-muted-foreground">v0.1 · P1b</div>
    </aside>
  )
}
```

- [x] **Step 2: 改 layout.tsx**

替换 `app/layout.tsx` 内容：

```typescript
import './globals.css'
import { Sidebar } from '@/components/layout/Sidebar'

export const metadata = {
  title: 'Colosseum',
  description: 'LLM Agent Arena',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-x-auto">{children}</main>
        </div>
      </body>
    </html>
  )
}
```

- [x] **Step 3: 验证 dev 环境**

Run: `npm run dev`，访问 http://localhost:3000，应看到左侧 sidebar 4 个链接。

- [x] **Step 4: Commit**

```bash
git add app/layout.tsx components/layout/Sidebar.tsx
git commit -m "feat(p1b): sidebar + global layout"
```

---

## Task 4: Lobby 页（大厅，展示对局列表）

**Files:**
- Modify: `app/page.tsx`（Server Component，直接查 DB）

- [ ] **Step 1: 写 Lobby**

覆盖 `app/page.tsx`:

```typescript
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { matches } from '@/lib/db/schema.sqlite'
import { desc } from 'drizzle-orm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'running') return 'default'
  if (status === 'completed') return 'secondary'
  if (status === 'errored' || status === 'aborted_by_errors') return 'destructive'
  return 'outline'
}

export default async function Lobby() {
  const rows = await db.select().from(matches).orderBy(desc(matches.startedAt)).limit(20)

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">大厅</h1>
        <Link href="/matches/new">
          <Button size="lg">开始新对局</Button>
        </Link>
      </div>

      <h2 className="text-xl font-semibold mb-4">最近对局</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">暂无对局。点"开始新对局"创建。</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((m) => (
            <Link key={m.id} href={`/matches/${m.id}`}>
              <Card className="hover:border-primary transition-colors">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base font-medium">
                    {m.gameType === 'poker' ? '德州扑克' : '狼人杀'}
                  </CardTitle>
                  <Badge variant={statusBadgeVariant(m.status)}>{m.status}</Badge>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <div>开始：{new Date(m.startedAt).toLocaleString('zh-CN')}</div>
                  {m.completedAt && (
                    <div>结束：{new Date(m.completedAt).toLocaleString('zh-CN')}</div>
                  )}
                  <div className="mt-1 text-xs">ID: {m.id.slice(0, 18)}...</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 跑 dev 验证**

Run: `npm run dev`。如果 DB 有 match，应能看到卡片；点击卡片会 404（观战页在 P1b-3 做）。

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(p1b): lobby page (server component with match list)"
```

---

## Task 5: Profile 管理页

**Files:**
- Create: `app/profiles/page.tsx`（Server Component 列表 + Client 表单）
- Create: `components/forms/ProfileForm.tsx`（Client）

- [ ] **Step 1: 写 ProfileForm（Client）**

Create `components/forms/ProfileForm.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/client/api'
import { keyring } from '@/lib/client/keyring'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type ProviderEntry = {
  id: string; displayName: string; baseUrl: string; models: string[]; kind: string
}

export function ProfileForm({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false)
  const [providers, setProviders] = useState<ProviderEntry[]>([])
  const [providerId, setProviderId] = useState<string>('')
  const [model, setModel] = useState<string>('')
  const [baseUrl, setBaseUrl] = useState<string>('')
  const [displayName, setDisplayName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const r = await api.get<{ providers: ProviderEntry[] }>('/api/providers')
      setProviders(r.providers)
    })()
  }, [])

  useEffect(() => {
    const p = providers.find((x) => x.id === providerId)
    if (p) {
      setBaseUrl(p.baseUrl)
      setModel(p.models[0] ?? '')
    }
  }, [providerId, providers])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const created = await api.post<{ id: string }>('/api/profiles', {
        displayName, providerId, baseUrl, model,
      })
      keyring.set(created.id, apiKey)
      setOpen(false)
      setDisplayName('')
      setApiKey('')
      onCreated?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedProvider = providers.find((p) => p.id === providerId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新增 Profile</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增 API Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>名称</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="我的 GPT-4o" />
          </div>
          <div>
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger><SelectValue placeholder="选择 provider" /></SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProvider && selectedProvider.id !== 'custom' && (
            <div>
              <Label>模型</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selectedProvider.models.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selectedProvider?.id === 'custom' && (
            <>
              <div>
                <Label>Base URL</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div>
                <Label>模型名</Label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
              </div>
            </>
          )}
          <div>
            <Label>API Key（仅存本地 localStorage）</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSubmit} disabled={submitting || !displayName || !providerId || !model}>
            {submitting ? '创建中...' : '创建'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 写 Profiles 页**

Create `app/profiles/page.tsx`（混合：Server 列表 + Client 表单 + Client 删除按钮）：

```typescript
import { db } from '@/lib/db/client'
import { apiProfiles } from '@/lib/db/schema.sqlite'
import { desc } from 'drizzle-orm'
import { ProfileForm } from '@/components/forms/ProfileForm'
import { ProfileRowActions } from '@/components/forms/ProfileRowActions'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function ProfilesPage() {
  const rows = await db.select().from(apiProfiles).orderBy(desc(apiProfiles.createdAt))

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">API Profiles</h1>
        <ProfileForm />
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">暂无 Profile，点"新增"创建。</p>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.displayName}</div>
                  <div className="text-sm text-muted-foreground">
                    {p.providerId} · {p.model}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {p.baseUrl}
                  </div>
                </div>
                <ProfileRowActions profileId={p.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="mt-8 p-4 border rounded bg-muted text-sm text-muted-foreground">
        <strong>说明：</strong>API Key 仅存你浏览器的 localStorage。换浏览器或清缓存需要重新填。
        服务端永远不会看到你的 key，除非你开对局时它随 keyring 传入服务端临时内存。
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 写 ProfileRowActions（Client）**

Create `components/forms/ProfileRowActions.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/client/api'
import { keyring } from '@/lib/client/keyring'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function ProfileRowActions({ profileId }: { profileId: string }) {
  const router = useRouter()
  const [hasKey, setHasKey] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setHasKey(keyring.has(profileId))
  }, [profileId])

  async function del() {
    if (!confirm('确认删除这个 Profile？关联的 Agent 会变成悬空引用。')) return
    setLoading(true)
    try {
      await api.del(`/api/profiles/${profileId}`)
      keyring.remove(profileId)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  function resetKey() {
    const k = prompt('输入新 API Key:')
    if (k && k.trim()) {
      keyring.set(profileId, k.trim())
      setHasKey(true)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={hasKey ? 'default' : 'outline'}>
        {hasKey ? 'Key 已配置' : '缺 Key'}
      </Badge>
      <Button size="sm" variant="outline" onClick={resetKey}>
        修改 Key
      </Button>
      <Button size="sm" variant="destructive" onClick={del} disabled={loading}>
        删除
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: 手工验证**

Run: `npm run dev`，访问 `/profiles`：
- 点"新增 Profile" → 选 openai → 填名称 + key → 提交 → 列表出现新行
- Badge 应该显示"Key 已配置"
- 开发者工具 localStorage 能看到 `colosseum:profile-keys` 条目
- 点"修改 Key"应能更新
- 点"删除"应从列表消失，key 也从 localStorage 清掉

- [ ] **Step 5: Commit**

```bash
git add app/profiles/ components/forms/ProfileForm.tsx components/forms/ProfileRowActions.tsx
git commit -m "feat(p1b): profiles management page (list + create dialog + actions)"
```

---

## Task 6: Agent 管理页

**Files:**
- Create: `app/agents/page.tsx`
- Create: `components/forms/AgentForm.tsx`
- Create: `components/forms/AgentRowActions.tsx`

- [ ] **Step 1: 写 AgentForm**

Create `components/forms/AgentForm.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/client/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type Profile = { id: string; displayName: string; providerId: string; model: string }

const AVATARS = ['🎭', '🎲', '🃏', '♠️', '♥️', '♦️', '♣️', '🤖', '🐺', '🦊']

export function AgentForm({ gameType = 'poker' as 'poker' | 'werewolf' }: { gameType?: 'poker' | 'werewolf' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [displayName, setDisplayName] = useState('')
  const [profileId, setProfileId] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [avatarEmoji, setAvatarEmoji] = useState(AVATARS[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      void (async () => {
        const r = await api.get<{ profiles: Profile[] }>('/api/profiles')
        setProfiles(r.profiles)
      })()
    }
  }, [open])

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/agents', {
        displayName, gameType, profileId, systemPrompt, avatarEmoji,
      })
      setOpen(false)
      setDisplayName('')
      setProfileId('')
      setSystemPrompt('')
      router.refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新增 Agent</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增 {gameType === 'poker' ? '德扑' : '狼人杀'} Agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>名称</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="BluffMaster" />
          </div>
          <div>
            <Label>头像</Label>
            <div className="flex gap-2 flex-wrap">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`text-2xl p-2 rounded border ${avatarEmoji === a ? 'border-primary bg-accent' : 'border-transparent'}`}
                  onClick={() => setAvatarEmoji(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>API Profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName} ({p.model})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>人设 Prompt</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              placeholder="你是一个经验丰富的激进派德州扑克玩家..."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            onClick={submit}
            disabled={submitting || !displayName || !profileId || !systemPrompt}
          >
            {submitting ? '创建中...' : '创建'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: 写 AgentRowActions**

Create `components/forms/AgentRowActions.tsx`:

```typescript
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/client/api'
import { Button } from '@/components/ui/button'

export function AgentRowActions({ agentId }: { agentId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function del() {
    if (!confirm('确认删除？')) return
    setLoading(true)
    try {
      await api.del(`/api/agents/${agentId}`)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="sm" variant="destructive" onClick={del} disabled={loading}>
      删除
    </Button>
  )
}
```

- [ ] **Step 3: 写 Agents 页**

Create `app/agents/page.tsx`:

```typescript
import { db } from '@/lib/db/client'
import { agents, apiProfiles } from '@/lib/db/schema.sqlite'
import { eq } from 'drizzle-orm'
import { AgentForm } from '@/components/forms/AgentForm'
import { AgentRowActions } from '@/components/forms/AgentRowActions'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const rows = await db
    .select({
      id: agents.id,
      displayName: agents.displayName,
      gameType: agents.gameType,
      kind: agents.kind,
      avatarEmoji: agents.avatarEmoji,
      systemPrompt: agents.systemPrompt,
      profileName: apiProfiles.displayName,
      profileModel: apiProfiles.model,
    })
    .from(agents)
    .leftJoin(apiProfiles, eq(agents.profileId, apiProfiles.id))

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Agents</h1>
        <div className="flex gap-2">
          <AgentForm gameType="poker" />
          {/* werewolf 留到 Phase 3 */}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">暂无 Agent。先在 Profiles 页建一个 API Profile，再回来建 Agent。</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">{a.avatarEmoji ?? '🃏'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{a.displayName}</div>
                      <Badge variant="outline">{a.gameType}</Badge>
                      {a.kind !== 'player' && <Badge variant="secondary">{a.kind}</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {a.profileName ?? '(profile 缺失)'} · {a.profileModel ?? '-'}
                    </div>
                    <p className="text-xs mt-2 text-muted-foreground line-clamp-3">
                      {a.systemPrompt}
                    </p>
                  </div>
                  <AgentRowActions agentId={a.id} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 手工验证**

Run: `npm run dev`，访问 `/agents`：
- 列表能展示前面 API 测试创建的 agent
- 点"新增 Agent" → 表单打开 → 选 profile → 填 prompt → 创建 → 列表刷新
- 删除按钮能工作

- [ ] **Step 5: Commit**

```bash
git add app/agents/ components/forms/AgentForm.tsx components/forms/AgentRowActions.tsx
git commit -m "feat(p1b): agents management page (list + create + delete)"
```

---

## Task 7: 创建对局页 `/matches/new`

**Files:**
- Create: `app/matches/new/page.tsx`（Server component 外壳）
- Create: `components/forms/MatchSetupForm.tsx`（Client 主体）

**Context:** 这页是最复杂的前端。需要：
1. 选游戏类型（Phase 1b 仅 poker）
2. 从 agents 里挑 6 个（拖拽或按钮加入）
3. 配参数（盲注、超时、action interval）
4. 显示每个 agent 所属 profile 是否有 key；缺 key 的弹框要求补填
5. 提交时组装 keyring + engineConfig + 开对局

- [ ] **Step 1: 写 MatchSetupForm**

Create `components/forms/MatchSetupForm.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/client/api'
import { keyring } from '@/lib/client/keyring'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type Agent = {
  id: string; displayName: string; avatarEmoji: string | null;
  gameType: 'poker' | 'werewolf'; profileId: string;
}
type Profile = { id: string; displayName: string; model: string }

export function MatchSetupForm() {
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selected, setSelected] = useState<string[]>([])   // agentIds 按座位顺序
  const [smallBlind, setSmallBlind] = useState(2)
  const [bigBlind, setBigBlind] = useState(4)
  const [startingChips, setStartingChips] = useState(200)
  const [agentTimeoutMs, setAgentTimeoutMs] = useState(60000)
  const [minActionIntervalMs, setMinActionIntervalMs] = useState(1000)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [a, p] = await Promise.all([
        api.get<{ agents: Agent[] }>('/api/agents?gameType=poker'),
        api.get<{ profiles: Profile[] }>('/api/profiles'),
      ])
      setAgents(a.agents.filter((x) => x.gameType === 'poker'))
      setProfiles(p.profiles)
    })()
  }, [])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 6) return prev
      return [...prev, id]
    })
  }

  const selectedAgents = selected
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is Agent => !!a)
  const profileIds = Array.from(new Set(selectedAgents.map((a) => a.profileId)))
  const missingKeys = profileIds.filter((pid) => !keyring.has(pid))

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      // missingKeys 提示用户补
      if (missingKeys.length > 0) {
        for (const pid of missingKeys) {
          const prof = profiles.find((p) => p.id === pid)
          const k = prompt(`为 Profile "${prof?.displayName ?? pid}" 填入 API Key:`)
          if (!k || !k.trim()) {
            throw new Error(`缺少 ${prof?.displayName ?? pid} 的 key`)
          }
          keyring.set(pid, k.trim())
        }
      }

      const keyringPayload: Record<string, string> = {}
      for (const pid of profileIds) {
        const k = keyring.get(pid)
        if (k) keyringPayload[pid] = k
      }

      const result = await api.post<{ matchId: string; streamUrl: string }>('/api/matches', {
        gameType: 'poker',
        agentIds: selected,
        engineConfig: { smallBlind, bigBlind, startingChips, maxBetsPerStreet: 4 },
        config: { agentTimeoutMs, minActionIntervalMs },
        keyring: keyringPayload,
      })
      router.push(`/matches/${result.matchId}`)
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Step 1: 选 agents */}
      <section>
        <h2 className="text-xl font-semibold mb-3">① 选 6 位选手 ({selected.length}/6)</h2>
        {agents.length < 6 && (
          <p className="text-sm text-destructive mb-2">
            至少需要 6 个德扑 Agent；当前只有 {agents.length} 个。请先去 /agents 页创建。
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {agents.map((a) => {
            const isSelected = selected.includes(a.id)
            const order = isSelected ? selected.indexOf(a.id) + 1 : 0
            return (
              <Card
                key={a.id}
                className={`cursor-pointer transition-colors ${isSelected ? 'border-primary bg-accent' : ''}`}
                onClick={() => toggleSelect(a.id)}
              >
                <CardContent className="p-3 flex items-center gap-2">
                  <div className="text-2xl">{a.avatarEmoji ?? '🃏'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.displayName}</div>
                  </div>
                  {isSelected && <Badge>#{order}</Badge>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Step 2: 参数 */}
      <section>
        <h2 className="text-xl font-semibold mb-3">② 对局参数</h2>
        <div className="grid grid-cols-2 gap-4 max-w-lg">
          <div>
            <Label>小盲</Label>
            <Input type="number" value={smallBlind} onChange={(e) => setSmallBlind(+e.target.value)} />
          </div>
          <div>
            <Label>大盲</Label>
            <Input type="number" value={bigBlind} onChange={(e) => setBigBlind(+e.target.value)} />
          </div>
          <div>
            <Label>初始筹码</Label>
            <Input type="number" value={startingChips} onChange={(e) => setStartingChips(+e.target.value)} />
          </div>
          <div>
            <Label>Agent 超时 (ms, 0=不限)</Label>
            <Input type="number" value={agentTimeoutMs} onChange={(e) => setAgentTimeoutMs(+e.target.value)} />
          </div>
          <div>
            <Label>每步最小间隔 (ms)</Label>
            <Input type="number" value={minActionIntervalMs} onChange={(e) => setMinActionIntervalMs(+e.target.value)} />
          </div>
        </div>
      </section>

      {/* Step 3: Keys 检查 */}
      <section>
        <h2 className="text-xl font-semibold mb-3">③ API Key 检查</h2>
        {profileIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">先选 Agent 才能看到需要哪些 key。</p>
        ) : (
          <div className="space-y-2">
            {profileIds.map((pid) => {
              const p = profiles.find((x) => x.id === pid)
              const has = keyring.has(pid)
              return (
                <div key={pid} className="flex items-center gap-2 text-sm">
                  <Badge variant={has ? 'default' : 'destructive'}>
                    {has ? 'OK' : '缺 key'}
                  </Badge>
                  <span>{p?.displayName ?? pid}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        size="lg"
        onClick={submit}
        disabled={submitting || selected.length !== 6}
      >
        {submitting ? '创建中...' : '开始对局'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: 写页面**

Create `app/matches/new/page.tsx`:

```typescript
import { MatchSetupForm } from '@/components/forms/MatchSetupForm'

export const dynamic = 'force-dynamic'

export default function NewMatchPage() {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">开始新对局</h1>
      <MatchSetupForm />
    </div>
  )
}
```

- [ ] **Step 3: 手工验证**

Run: `npm run dev`，访问 `/matches/new`：
- 看到 6 个 agent 卡片
- 点选 6 个 → Badge 从 #1 到 #6
- 下方参数可以改
- Key 检查列表显示各 profile 状态
- 点"开始对局" → 应跳到 `/matches/<id>`（404 正常，观战页在 P1b-3）

**如果 Agents 数 < 6**：回到 `/agents` 页多建几个，因为本页要求必须选够 6 个。

- [ ] **Step 4: Commit**

```bash
git add app/matches/new/ components/forms/MatchSetupForm.tsx
git commit -m "feat(p1b): match setup page (select 6 agents + config + key check)"
```

---

## Task 8: Phase 1b-2 收尾 + tag

**Files:** 无新增

- [ ] **Step 1: 全量回归**

Run:
```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: 全绿。

- [ ] **Step 2: 手工走完整体验**

1. 访问 `/profiles` 新建一个 profile
2. 访问 `/agents` 新建 6 个 poker agent
3. 访问 `/matches/new` 选中 6 个 + 参数 + 开局
4. 跳转到 `/matches/<id>`（目前是 404 或空页，正常）
5. 访问 `/` 大厅能看到新建的 match 卡片
6. `localStorage` 里有 `colosseum:profile-keys` 条目

- [ ] **Step 3: Commit + tag**

```bash
git commit --allow-empty -m "chore(p1b): phase 1b-2 complete (lobby + crud + new match)"
git tag -a phase-1b-2 -m "Phase 1b-2: management pages + new match wizard"
```

---

## Phase 1b-2 Done 定义

1. ✅ `/` 大厅页展示对局列表，点卡片跳转
2. ✅ `/profiles` CRUD 工作，key 正确存 localStorage
3. ✅ `/agents` CRUD 工作，和 profile 关联正确
4. ✅ `/matches/new` 能选 6 个 agent + 参数 + keyring 全填 → 成功创建 match（DB + Redis 落库）
5. ✅ `npm test` + `npx tsc --noEmit` + `npm run build` 全绿
6. ✅ Git tag `phase-1b-2`

**下一份：** `2026-05-06-phase-1b-3-spectator.md` —— 观战页主页面 + SSE 订阅 + 牌桌渲染器 + 座位/手牌/公共牌动画。
