# Phase 0 — 骨架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零搭建 Colosseum 项目骨架，产出两个可验证里程碑：(M1) 一个 Route Handler 调通真实 LLM API 并流式返回；(M2) 一个 toy A2A agent 暴露 Agent Card + message:stream 端点，由 A2A Client 调用返回响应。

**Architecture:** Next.js 15 App Router + TypeScript 严格模式。用 Drizzle ORM（开发 SQLite，生产 Postgres）。用 Vercel AI SDK v5 统一 LLM 调用。用 `@a2a-js/sdk` 实现 A2A Server/Client。用 Docker Compose 起 Postgres + Redis（Next.js 本机跑 `npm run dev`，不入容器）。所有模块走 TDD：先写失败的测试，再写最小实现。

**Tech Stack:**
- Next.js 15 (App Router, node runtime)
- TypeScript 5.9+ 严格模式
- Drizzle ORM + `drizzle-kit` + `better-sqlite3`（dev） + `postgres`（prod driver）
- `ai` (Vercel AI SDK v5) + `@ai-sdk/openai-compatible` + `@ai-sdk/anthropic`
- `@a2a-js/sdk`（官方 A2A Node SDK）
- `ioredis`（Redis client）
- `vitest` + `jsdom` + `@testing-library/react`
- Tailwind 4 + shadcn/ui（按需 copy）
- Zod（schema 校验）

**参考 spec:** `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md` 第 0-4、8、13 节。

**工作目录：** Colosseum 仓库根（不在 `old/` 里）。

---

## 文件结构（Phase 0 结束时的目录）

```
Colosseum/
├── .env.example                         # 环境变量模板
├── .gitignore                           # 已存在
├── eslint.config.mjs                    # ESLint flat config（含 import 分层规则）
├── next.config.ts                       # Next.js 配置
├── next-env.d.ts                        # Next.js 自动生成
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── drizzle.config.ts                    # Drizzle CLI 配置
├── docker-compose.yml                   # 开发用：仅 Postgres + Redis
│
├── app/
│   ├── layout.tsx
│   ├── page.tsx                         # Hello World 占位首页
│   ├── globals.css                      # Tailwind 基础
│   └── api/
│       ├── health/route.ts              # GET /api/health → {ok, db, redis}
│       ├── llm/ping/route.ts            # POST /api/llm/ping → 调通 LLM（里程碑 M1）
│       └── agents/
│           └── [agentId]/
│               ├── .well-known/agent-card.json/route.ts
│               └── message/stream/route.ts      # 注意：文件名用 stream（冒号规避 Windows 限制）
│
├── lib/
│   ├── env.ts                           # 环境变量类型化读取
│   ├── db/
│   │   ├── client.ts                    # drizzle 实例（按 DB_DRIVER 切换）
│   │   ├── schema.sqlite.ts             # Phase 0 只实现 SQLite schema（仅 api_profiles 占位）
│   │   └── migrations/                  # drizzle-kit 生成
│   ├── redis/
│   │   └── client.ts                    # ioredis 单例
│   ├── llm/
│   │   ├── catalog.ts                   # 静态 provider catalog
│   │   └── provider-factory.ts          # createModel(profile, apiKey)
│   ├── a2a-core/
│   │   ├── types.ts                     # A2A 共用类型
│   │   ├── server-helpers.ts            # createA2AStreamResponse (toy 版)
│   │   └── client.ts                    # 封装 A2AClient（toy 版）
│   └── telemetry/
│       └── logger.ts                    # 结构化 JSON 日志
│
├── __tests__/                           # 项目根 tests（整合/E2E 级别放这里）
│   └── .gitkeep
│
├── docs/                                # 已存在
├── old/                                  # 已存在
└── ops/                                  # Phase 0 只放 dev docker-compose，不做生产
    └── dev/                              # 将来生产用 ops/deploy/
        └── README.md                    # 开发环境说明
```

**File Responsibility Notes：**
- **lib/env.ts**：唯一的环境变量入口。所有其他文件 `import { env } from '@/lib/env'`，禁止直接用 `process.env.*`（除 env.ts 内部）。
- **lib/db/client.ts**：按 `env.DB_DRIVER` 决定 import `schema.sqlite.ts` 还是 `schema.pg.ts`。Phase 0 只实现 SQLite。
- **lib/a2a-core/server-helpers.ts**：封装 `createA2AStreamResponse`——包装 SSE 协议细节。Phase 0 是 toy 版，Phase 2 会正规化。
- **app/api/agents/[agentId]/message/stream/route.ts**：spec 里写的是 `message:stream`（冒号），但**Next.js 路由里冒号有特殊语义（动态段前缀）**。Phase 0 采用 `message/stream`（斜杠），spec 里的 URL 例子需要对应修正——**这一点在本 plan 的 Task 17 会特别说明**。

---

## Task 0: 初始化 npm 项目 + 工具链

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.nvmrc`
- Create: `.env.example`

- [x] **Step 1: 在仓库根目录初始化 package.json**

当前目录确认：`C:/Users/qoobeewang/Desktop/Colosseum`（root 已有 `.gitignore`/`docs/`/`old/`）。

Run:
```bash
cd "/c/Users/qoobeewang/Desktop/Colosseum"
npm init -y
```

Expected: 生成一个默认 `package.json`。

- [x] **Step 2: 替换为项目实际的 package.json**

写入以下内容（完整替换）：

```json
{
  "name": "colosseum",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "bootstrap": "node scripts/dev-bootstrap.mjs",
    "sync": "node scripts/dev-sync.mjs",
    "doctor": "node scripts/dev-doctor.mjs",
    "commit:step": "node scripts/git-step-commit.mjs",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down",
    "infra:logs": "docker compose logs -f",
    "check": "npm run lint && npm run typecheck && npm test && npm run build"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

- [x] **Step 3: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "old", "dist", ".next"]
}
```

**注意：`exclude` 里必须包含 `old`，否则 TypeScript 会把归档的老代码也编译报错。**

- [x] **Step 4: 写 .nvmrc**

```
22
```

- [x] **Step 5: 写 .env.example**

```bash
# === Node environment ===
NODE_ENV=development

# === Base URL（self-fetch tick loop 要用） ===
BASE_URL=http://localhost:3000

# === Database ===
# "sqlite" for dev, "pg" for prod
DB_DRIVER=sqlite
SQLITE_PATH=./dev.db
DATABASE_URL=postgres://arena:dev@localhost:5432/arena

# === Redis ===
REDIS_URL=redis://localhost:6379

# === Test secret for LLM calls（开发者自己填） ===
# Format: OPENAI_COMPATIBLE_BASE_URL / _API_KEY / _MODEL
# 这是 Phase 0 "ping" endpoint 用的，Phase 1 之后 key 走 localStorage/keyring
TEST_LLM_BASE_URL=https://api.deepseek.com/v1
TEST_LLM_API_KEY=sk-replace-me
TEST_LLM_MODEL=deepseek-chat
```

- [x] **Step 6: 验证 TypeScript 可以编译空项目**

Run:
```bash
npx tsc --version
```

Expected: 打印版本号（TypeScript 还没装，该命令会 fail）。这个 step **不要期望通过**，它只是确认 npm 可用。

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .nvmrc .env.example
git commit -m "chore(p0): init npm package + tsconfig + env template"
```

---

## Task 1: 安装核心依赖

**Files:**
- Modify: `package.json` (via npm install)

- [x] **Step 1: 安装 Next.js + React + TypeScript**

Run:
```bash
npm install next@^15 react@^19 react-dom@^19
npm install -D typescript@^5.9 @types/node @types/react @types/react-dom
```

Expected: 无错误退出。

- [x] **Step 2: 安装 Tailwind 4 + PostCSS**

Run:
```bash
npm install -D tailwindcss@^4 @tailwindcss/postcss postcss
```

Expected: 无错误。

- [x] **Step 3: 安装 Drizzle + 两种 DB 驱动**

Run:
```bash
npm install drizzle-orm
npm install -D drizzle-kit
npm install better-sqlite3
npm install -D @types/better-sqlite3
npm install postgres
```

Expected: 无错误。`postgres` 是 postgres.js 驱动（Drizzle 推荐）。

- [x] **Step 4: 安装 Redis client + Vercel AI SDK + A2A SDK**

Run:
```bash
npm install ioredis
npm install ai@^5 @ai-sdk/openai-compatible @ai-sdk/anthropic
npm install @a2a-js/sdk
npm install zod
```

Expected: 无错误。如 `@a2a-js/sdk` 找不到（NPM 上包名或有变），stop 执行，向用户求助——**不要自己造轮子**。

- [x] **Step 5: 安装测试工具**

Run:
```bash
npm install -D vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom @vitejs/plugin-react
```

Expected: 无错误。

- [x] **Step 6: 安装 ESLint（Next.js 标配）**

Run:
```bash
npm install -D eslint eslint-config-next @eslint/js typescript-eslint
```

Expected: 无错误。

- [x] **Step 7: 验证依赖都装上**

Run:
```bash
cat package.json | grep -E '(next|react|drizzle|ai|a2a|vitest)' | head -20
```

Expected: 至少看到 next、react、drizzle-orm、ai、@a2a-js/sdk、vitest。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(p0): install core deps (next 15 + drizzle + ai sdk + a2a sdk)"
```

---

## Task 2: 配置 Next.js + Tailwind + ESLint

**Files:**
- Create: `next.config.ts`
- Create: `next-env.d.ts`（Next.js 自动生成）
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `app/globals.css`
- Create: `eslint.config.mjs`

- [x] **Step 1: 创建 next.config.ts**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // 没开 typedRoutes（@a2a-js/sdk 可能对 typed routes 不友好）
  },
}

export default nextConfig
```

- [x] **Step 2: 创建 postcss.config.mjs**

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

- [x] **Step 3: 创建 tailwind.config.ts**

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './games/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

export default config
```

- [x] **Step 4: 创建 app/globals.css**

```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}

body {
  color: var(--foreground);
  background: var(--background);
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [x] **Step 5: 创建 eslint.config.mjs**

```javascript
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['old/**', 'node_modules/**', '.next/**', 'dist/**', 'build/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
]
```

**关键：`ignores` 含 `old/**`，否则 ESLint 会扫老代码报一堆错。`next lint` 已废弃，项目使用 `eslint .`。**

- [x] **Step 6: 建 app/ 占位文件**

Create `app/layout.tsx`:

```typescript
import './globals.css'

export const metadata = {
  title: 'Colosseum',
  description: 'LLM Agent Arena',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
```

Create `app/page.tsx`:

```typescript
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">Colosseum</h1>
      <p className="mt-4 text-gray-600">LLM Agent Arena — Phase 0 骨架</p>
    </main>
  )
}
```

- [x] **Step 7: 跑 dev 服务器验证**

Run:
```bash
npm run dev
```

Expected: 输出类似 `▲ Next.js 15.x.x` 并 listen 在 `http://localhost:3000`。
在浏览器打开 http://localhost:3000 应能看到 "Colosseum" 标题。

**确认后 Ctrl+C 停掉 dev server。**

- [x] **Step 8: 跑 lint 验证**

Run:
```bash
npm run lint
```

Expected: 无错误，或仅 Next.js 标准警告。

- [ ] **Step 9: Commit**

```bash
git add next.config.ts next-env.d.ts tailwind.config.ts postcss.config.mjs app/ eslint.config.mjs
git commit -m "feat(p0): next.js app router + tailwind 4 + eslint + hello world home"
```

---

## Task 3: Vitest 配置 + 第一个冒烟测试

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/smoke.test.ts`

- [x] **Step 1: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['old/**', 'node_modules/**', '.next/**'],
  },
})
```

- [x] **Step 2: 创建 tests/setup.ts**

```typescript
import '@testing-library/jest-dom/vitest'
```

- [x] **Step 3: 写 smoke test（先失败）**

Create `tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('1 + 1 = 2', () => {
    expect(1 + 1).toBe(2)
  })

  it('environment is jsdom', () => {
    expect(typeof window).toBe('object')
  })
})
```

- [x] **Step 4: 运行并确认通过**

Run:
```bash
npm test
```

Expected: 2 passed。

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/
git commit -m "test(p0): vitest config + smoke test (jsdom env)"
```

---

## Task 4: 环境变量类型化读取（lib/env.ts）

**Files:**
- Create: `lib/env.ts`
- Create: `tests/lib/env.test.ts`

- [x] **Step 1: 写失败的测试**

Create `tests/lib/env.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('lib/env', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('loads valid env', async () => {
    // 用 await import 确保每次拿到新的 env
    const { loadEnv } = await import('@/lib/env')
    const env = loadEnv()
    expect(env.BASE_URL).toBe('http://localhost:3000')
    expect(env.DB_DRIVER).toBe('sqlite')
  })

  it('throws on invalid DB_DRIVER', async () => {
    process.env.DB_DRIVER = 'bogus' as string
    const { loadEnv } = await import('@/lib/env')
    expect(() => loadEnv()).toThrow(/DB_DRIVER/)
  })
})
```

- [x] **Step 2: 运行测试验证失败**

Run:
```bash
npm test tests/lib/env.test.ts
```

Expected: 失败，提示 `Cannot find module '@/lib/env'` 或类似。

- [x] **Step 3: 写 lib/env.ts 最小实现**

```typescript
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.string().url(),
  DB_DRIVER: z.enum(['sqlite', 'pg']),
  SQLITE_PATH: z.string().default('./dev.db'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().url(),
  TEST_LLM_BASE_URL: z.string().url().optional(),
  TEST_LLM_API_KEY: z.string().optional(),
  TEST_LLM_MODEL: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

/**
 * 解析环境变量。测试中可重复调用；生产中通常只调一次并缓存。
 * 任何其他模块都必须通过 env 访问环境变量，禁止 process.env.XXX 直接读。
 */
export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors
    const msg = Object.entries(fieldErrors)
      .map(([k, v]) => `  ${k}: ${v?.join(', ')}`)
      .join('\n')
    throw new Error(`Invalid env:\n${msg}`)
  }
  return parsed.data
}

// 生产环境单例（测试里避免缓存，用 loadEnv() 直接取）
let cached: Env | null = null
export const env: Env = (() => {
  if (cached) return cached
  cached = loadEnv()
  return cached
})()
```

**注意：** `env` 作为模块级常量会在 `import` 时执行，这在测试 import 阶段可能报错。测试用 `loadEnv()` 函数；应用运行时用 `env` 常量。

- [x] **Step 4: 运行测试验证通过**

Run:
```bash
npm test tests/lib/env.test.ts
```

Expected: 2 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/env.ts tests/lib/env.test.ts
git commit -m "feat(p0): lib/env with zod-validated env loader"
```

---

## Task 5: Docker Compose（Postgres + Redis，开发用）

**Files:**
- Create: `docker-compose.yml`
- Create: `ops/dev/README.md`

- [x] **Step 1: 写 docker-compose.yml**

**此文件只起 Postgres + Redis；Next.js 在宿主机 `npm run dev` 运行以保证热更新。**

```yaml
# docker-compose.yml (开发用；生产见 ops/deploy/docker-compose.yml 后续 Phase 4)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: arena
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: arena
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "arena"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata: {}
  redisdata: {}
```

- [x] **Step 2: 写 ops/dev/README.md**

```markdown
# 开发环境

## 启动基础设施

Postgres + Redis 以容器方式启动；Next.js 本机 `npm run dev`：

```bash
npm run infra:up       # 起 postgres + redis 容器
npm run dev            # 另开一个终端，起 Next.js
```

## 停止 / 日志

```bash
npm run infra:logs
npm run infra:down
```

## 数据迁移

```bash
npm run db:generate    # 生成 SQL migration
npm run db:migrate     # 应用到当前 DB
npm run db:studio      # 打开 Drizzle Studio（可视化）
```
```

- [ ] **Step 3: 启动基础设施验证**

Run:
```bash
npm run infra:up
docker compose ps
```

Expected: postgres 和 redis 都 `healthy`。

- [ ] **Step 4: 验证 Postgres 可连**

Run:
```bash
docker compose exec postgres psql -U arena -d arena -c "SELECT version();"
```

Expected: 输出 PostgreSQL 版本信息。

- [ ] **Step 5: 验证 Redis 可连**

Run:
```bash
docker compose exec redis redis-cli ping
```

Expected: `PONG`。

- [ ] **Step 6: 停止容器（保留数据）**

Run:
```bash
npm run infra:down
```

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml ops/
git commit -m "feat(p0): docker compose for dev postgres + redis"
```

---

## Task 6: Drizzle schema + client（SQLite dev）

**Files:**
- Create: `drizzle.config.ts`
- Create: `lib/db/schema.sqlite.ts`
- Create: `lib/db/client.ts`
- Create: `tests/lib/db/client.test.ts`

- [x] **Step 1: 写失败的测试**

Create `tests/lib/db/client.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { unlinkSync, existsSync } from 'node:fs'

describe('lib/db/client (sqlite)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    if (existsSync('./tests/tmp-test.db')) unlinkSync('./tests/tmp-test.db')
  })

  it('exposes a drizzle instance', async () => {
    const { db } = await import('@/lib/db/client')
    expect(db).toBeDefined()
    expect(typeof db.select).toBe('function')
  })

  it('imports sqlite schema when DB_DRIVER=sqlite', async () => {
    const { apiProfiles } = await import('@/lib/db/schema.sqlite')
    expect(apiProfiles).toBeDefined()
  })
})
```

- [x] **Step 2: 运行测试验证失败**

Run:
```bash
npm test tests/lib/db/client.test.ts
```

Expected: 失败，提示 `Cannot find module`。

- [x] **Step 3: 写 SQLite schema（Phase 0 最小子集）**

Create `lib/db/schema.sqlite.ts`:

```typescript
// Phase 0 仅实现 api_profiles 占位，用于验证连接。
// Phase 1 会按照 spec 第 8.1/8.2 节补齐所有表。
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const apiProfiles = sqliteTable('api_profiles', {
  id: text('id').primaryKey(),                        // UUID 应用层生成
  displayName: text('display_name').notNull(),
  providerId: text('provider_id').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  temperature: integer('temperature').notNull().default(70),
  maxTokens: integer('max_tokens'),
  contextWindowTokens: integer('context_window_tokens'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(strftime('%s','now'))`),
})
```

- [x] **Step 4: 写 DB client**

Create `lib/db/client.ts`:

```typescript
import { loadEnv } from '@/lib/env'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import * as sqliteSchema from './schema.sqlite'

const env = loadEnv()

/**
 * 单例 Drizzle 数据库实例。Phase 0 仅支持 SQLite；Phase 4 补 Postgres 分支。
 */
export const db = (() => {
  if (env.DB_DRIVER === 'sqlite') {
    const sqlite = new Database(env.SQLITE_PATH)
    sqlite.pragma('journal_mode = WAL')
    return drizzleSqlite(sqlite, { schema: sqliteSchema })
  }
  throw new Error(`DB_DRIVER=${env.DB_DRIVER} not implemented in Phase 0`)
})()

export type DB = typeof db
```

- [x] **Step 5: 写 drizzle.config.ts**

```typescript
import type { Config } from 'drizzle-kit'
import { loadEnv } from './lib/env'

const env = loadEnv()

export default {
  schema: env.DB_DRIVER === 'sqlite'
    ? './lib/db/schema.sqlite.ts'
    : './lib/db/schema.pg.ts',
  out: './lib/db/migrations',
  dialect: env.DB_DRIVER === 'sqlite' ? 'sqlite' : 'postgresql',
  dbCredentials: env.DB_DRIVER === 'sqlite'
    ? { url: env.SQLITE_PATH }
    : { url: env.DATABASE_URL ?? '' },
} satisfies Config
```

- [x] **Step 6: 生成 + 应用首个 migration**

Run:
```bash
cp .env.example .env
npm run db:generate
npm run db:migrate
```

Expected:
- `db:generate` 在 `lib/db/migrations/` 下生成 `0000_*.sql`
- `db:migrate` 无错误，打印 `migrations applied` 之类

**注意**：如果 `.env` 已存在不覆盖，则用 `cat .env.example >> .env` 或手动确保上述 env 变量已设置。

- [x] **Step 7: 跑 db client 测试**

Run:
```bash
npm test tests/lib/db/client.test.ts
```

Expected: 2 passed。

- [x] **Step 8: 写一个 integration test 验真的能 insert/select**

在 `tests/lib/db/client.test.ts` 末尾追加（`describe` 同一个块内）：

```typescript
  it('can insert and select an api profile', async () => {
    const { db } = await import('@/lib/db/client')
    const { apiProfiles } = await import('@/lib/db/schema.sqlite')
    const { randomUUID } = await import('node:crypto')

    const id = randomUUID()
    await db.insert(apiProfiles).values({
      id,
      displayName: 'Test Profile',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })

    const rows = await db.select().from(apiProfiles)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.find((r) => r.id === id)?.displayName).toBe('Test Profile')
  })
```

Run:
```bash
npm test tests/lib/db/client.test.ts
```

Expected: 3 passed。

- [x] **Step 9: 将 tmp-test.db 加入 .gitignore**

编辑仓库根 `.gitignore`（已存在），追加到末尾：

```
# === Phase 0 dev artifacts ===
*.db
*.db-journal
*.db-wal
*.db-shm
.next/
```

- [ ] **Step 10: Commit**

```bash
git add drizzle.config.ts lib/db/ tests/lib/db/ .gitignore
git commit -m "feat(p0): drizzle + sqlite schema + integration-tested db client"
```

---

## Task 7: Redis client

**Files:**
- Create: `lib/redis/client.ts`
- Create: `tests/lib/redis/client.test.ts`

- [x] **Step 1: 先确认 infra 在跑**

Run:
```bash
docker compose ps
```

Expected: `redis` 为 `healthy`。如未起，先 `npm run infra:up`。

- [x] **Step 2: 写失败的测试**

Create `tests/lib/redis/client.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Redis as RedisClient } from 'ioredis'

describe('lib/redis/client', () => {
  let redis: RedisClient

  beforeAll(async () => {
    process.env.REDIS_URL = 'redis://localhost:6379'
    const mod = await import('@/lib/redis/client')
    redis = mod.redis
    await redis.flushdb()
  })

  afterAll(async () => {
    await redis.quit()
  })

  it('can set and get a string', async () => {
    await redis.set('test:hello', 'world')
    const value = await redis.get('test:hello')
    expect(value).toBe('world')
  })

  it('can work with hashes', async () => {
    await redis.hset('test:h', 'k1', 'v1')
    const v = await redis.hget('test:h', 'k1')
    expect(v).toBe('v1')
  })
})
```

- [x] **Step 3: 写 Redis client**

Create `lib/redis/client.ts`:

```typescript
import Redis from 'ioredis'
import { loadEnv } from '@/lib/env'

const env = loadEnv()

/**
 * ioredis 单例。所有 L3 业务层读写 Redis 走这个实例。
 *
 * 键空间约定（spec 第 8.3 节）：
 *   match:<id>:state / :token / :keyring / :memory:<agentId>:working
 *   channel:match:<id>   （pub/sub）
 *   lock:match:<id>      （NX EX 60）
 */
export const redis: Redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
})

export type { Redis } from 'ioredis'
```

- [x] **Step 4: 跑测试验证通过**

Run:
```bash
npm test tests/lib/redis/client.test.ts
```

Expected: 2 passed。**如果 Redis 没起会失败——先 `npm run infra:up`。**

- [x] **Step 5: Commit**

```bash
git add lib/redis/ tests/lib/redis/
git commit -m "feat(p0): ioredis singleton client"
```

---

## Task 8: 结构化日志（lib/telemetry/logger.ts）

**Files:**
- Create: `lib/telemetry/logger.ts`
- Create: `tests/lib/telemetry/logger.test.ts`

- [x] **Step 1: 写失败的测试**

Create `tests/lib/telemetry/logger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { log } from '@/lib/telemetry/logger'

describe('lib/telemetry/logger', () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    spy.mockRestore()
  })

  it('emits a JSON line to stdout with level=info', () => {
    log.info('hello', { matchId: 'm1' })
    expect(spy).toHaveBeenCalledOnce()
    const arg = spy.mock.calls[0][0] as string
    const parsed = JSON.parse(arg)
    expect(parsed.level).toBe('info')
    expect(parsed.msg).toBe('hello')
    expect(parsed.matchId).toBe('m1')
    expect(typeof parsed.ts).toBe('string')
  })

  it('emits level=error on .error', () => {
    log.error('boom', { errorCode: 'xyz' })
    const arg = spy.mock.calls[0][0] as string
    expect(JSON.parse(arg).level).toBe('error')
  })
})
```

- [x] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/lib/telemetry/logger.test.ts
```

Expected: 失败。

- [x] **Step 3: 写实现**

Create `lib/telemetry/logger.ts`:

```typescript
/**
 * 结构化 JSON 日志。所有业务事件写入 stdout，由 Docker 日志驱动收集。
 * 关键节点必打 log：tick 开始/结束、agent 决策、agent_error、match lifecycle。
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...extra,
  })
  console.log(line)
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
}
```

- [x] **Step 4: 跑测试验证通过**

Run:
```bash
npm test tests/lib/telemetry/logger.test.ts
```

Expected: 2 passed。

- [x] **Step 5: Commit**

```bash
git add lib/telemetry/ tests/lib/telemetry/
git commit -m "feat(p0): structured JSON logger"
```

---

## Task 9: LLM provider catalog

**Files:**
- Create: `lib/llm/catalog.ts`
- Create: `tests/lib/llm/catalog.test.ts`

- [x] **Step 1: 写失败的测试**

Create `tests/lib/llm/catalog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { PROVIDER_CATALOG, findProvider } from '@/lib/llm/catalog'

describe('lib/llm/catalog', () => {
  it('contains at least openai, deepseek, anthropic entries', () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id)
    expect(ids).toContain('openai')
    expect(ids).toContain('deepseek')
    expect(ids).toContain('anthropic')
  })

  it('findProvider returns undefined for unknown id', () => {
    expect(findProvider('bogus')).toBeUndefined()
  })

  it('each entry has a non-empty model list (unless custom)', () => {
    for (const p of PROVIDER_CATALOG) {
      if (p.id === 'custom') continue
      expect(p.models.length).toBeGreaterThan(0)
    }
  })
})
```

- [x] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/lib/llm/catalog.test.ts
```

Expected: 失败。

- [x] **Step 3: 写实现**

Create `lib/llm/catalog.ts`:

```typescript
/**
 * 服务端静态 provider catalog（spec 决策 #7）。
 * 前端从 /api/providers 取这个列表，生成 APIProfile 表单的下拉选项。
 * apiKey 不存这里 — 用户填完只留在浏览器 localStorage。
 */
export type ProviderEntry = {
  id: string
  displayName: string
  baseUrl: string
  models: string[]
  kind: 'openai-compatible' | 'anthropic' | 'custom'
  contextWindowTokens?: number
}

export const PROVIDER_CATALOG: ProviderEntry[] = [
  {
    id: 'openai',
    displayName: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'qwen',
    displayName: '通义千问 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    kind: 'openai-compatible',
    contextWindowTokens: 128_000,
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4', 'claude-opus-4'],
    kind: 'anthropic',
    contextWindowTokens: 200_000,
  },
  {
    id: 'custom',
    displayName: '自定义（用户输入 URL）',
    baseUrl: '',
    models: [],
    kind: 'openai-compatible',
  },
]

export function findProvider(id: string): ProviderEntry | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id)
}
```

- [x] **Step 4: 跑测试**

Run:
```bash
npm test tests/lib/llm/catalog.test.ts
```

Expected: 3 passed。

- [x] **Step 5: Commit**

```bash
git add lib/llm/catalog.ts tests/lib/llm/catalog.test.ts
git commit -m "feat(p0): static llm provider catalog"
```

---

## Task 10: LLM provider factory

**Files:**
- Create: `lib/llm/provider-factory.ts`
- Create: `tests/lib/llm/provider-factory.test.ts`

**Context**: 把 `{ providerKind, baseUrl, model, apiKey }` 转成一个 Vercel AI SDK 的 LanguageModel 实例。这层吸收 openai-compatible vs anthropic 的 SDK 差异。

- [x] **Step 1: 写失败的测试**

Create `tests/lib/llm/provider-factory.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('lib/llm/provider-factory', () => {
  it('createModel returns a language model for openai-compatible', async () => {
    const { createModel } = await import('@/lib/llm/provider-factory')
    const model = createModel({
      kind: 'openai-compatible',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-fake-for-type-check',
    })
    // Vercel AI SDK LanguageModel 有 modelId 属性
    expect(typeof (model as unknown as { modelId: string }).modelId).toBe('string')
  })

  it('createModel returns an anthropic model', async () => {
    const { createModel } = await import('@/lib/llm/provider-factory')
    const model = createModel({
      kind: 'anthropic',
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4',
      apiKey: 'sk-ant-fake',
    })
    expect(typeof (model as unknown as { modelId: string }).modelId).toBe('string')
  })

  it('throws on unknown kind', async () => {
    const { createModel } = await import('@/lib/llm/provider-factory')
    expect(() =>
      createModel({
        kind: 'bogus' as 'openai-compatible',
        providerId: 'x',
        baseUrl: 'http://x',
        model: 'm',
        apiKey: 'k',
      }),
    ).toThrow(/unsupported/i)
  })
})
```

- [x] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/lib/llm/provider-factory.test.ts
```

Expected: 失败。

- [x] **Step 3: 写实现**

Create `lib/llm/provider-factory.ts`:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

export type CreateModelInput = {
  kind: 'openai-compatible' | 'anthropic' | 'custom'
  providerId: string
  baseUrl: string
  model: string
  apiKey: string
}

/**
 * 统一 LLM 工厂。输入一组 provider 配置 + 用户 apiKey，返回可被
 * Vercel AI SDK streamText/generateText 使用的 LanguageModel 实例。
 *
 * 职责：
 *  - 吸收各 SDK 的 import 差异
 *  - 不做任何业务逻辑（例如 game-specific prompt 不在这里）
 *  - 不缓存——每次调用重建，防止 apiKey 混用
 */
export function createModel(input: CreateModelInput): LanguageModel {
  const { kind, baseUrl, model, apiKey, providerId } = input

  if (kind === 'openai-compatible' || kind === 'custom') {
    const provider = createOpenAICompatible({
      name: providerId,
      baseURL: baseUrl,
      apiKey,
    })
    return provider(model)
  }

  if (kind === 'anthropic') {
    const provider = createAnthropic({
      baseURL: baseUrl,
      apiKey,
    })
    return provider(model)
  }

  throw new Error(`unsupported provider kind: ${kind as string}`)
}
```

- [x] **Step 4: 运行测试验证通过**

Run:
```bash
npm test tests/lib/llm/provider-factory.test.ts
```

Expected: 3 passed。

- [x] **Step 5: Commit**

```bash
git add lib/llm/provider-factory.ts tests/lib/llm/provider-factory.test.ts
git commit -m "feat(p0): llm provider factory (openai-compatible + anthropic)"
```

---

## Task 11: 健康检查 Route Handler（GET /api/health）

**Files:**
- Create: `app/api/health/route.ts`
- Create: `tests/api/health.test.ts`

**Context**: 一个端到端最小样例：Route Handler → db.select → redis.ping → 返回 JSON。用来验证 Next.js 路由 + Node runtime + infra 连通。

- [x] **Step 1: 写失败的测试**

Create `tests/api/health.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'

describe('GET /api/health', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('returns ok=true when db + redis both reachable', async () => {
    const { GET } = await import('@/app/api/health/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      db: 'ok' | 'error'
      redis: 'ok' | 'error'
    }
    expect(body.ok).toBe(true)
    expect(body.db).toBe('ok')
    expect(body.redis).toBe('ok')
  })
})
```

- [x] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/api/health.test.ts
```

Expected: 失败（Route Handler 不存在）。

- [x] **Step 3: 写实现**

Create `app/api/health/route.ts`:

```typescript
import { db } from '@/lib/db/client'
import { redis } from '@/lib/redis/client'
import { apiProfiles } from '@/lib/db/schema.sqlite'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let dbStatus: 'ok' | 'error' = 'error'
  let redisStatus: 'ok' | 'error' = 'error'

  try {
    // 任何一条 query 都行，这里做个计数
    await db.select().from(apiProfiles).limit(1)
    dbStatus = 'ok'
  } catch (err) {
    log.error('health: db check failed', { err: String(err) })
  }

  try {
    const pong = await redis.ping()
    if (pong === 'PONG') redisStatus = 'ok'
  } catch (err) {
    log.error('health: redis check failed', { err: String(err) })
  }

  const ok = dbStatus === 'ok' && redisStatus === 'ok'
  return Response.json({ ok, db: dbStatus, redis: redisStatus }, { status: ok ? 200 : 503 })
}
```

- [x] **Step 4: 跑测试验证通过**

Run:
```bash
npm test tests/api/health.test.ts
```

Expected: 1 passed。**需要 Postgres 和 Redis 容器在跑。**如果 Redis 没起会报错——先 `npm run infra:up`。

- [x] **Step 5: 手工验证 Route Handler 在 dev server 里也工作**

Run (新开终端，保持 infra 起着):
```bash
npm run dev
```

另一个终端:
```bash
curl http://localhost:3000/api/health
```

Expected: `{"ok":true,"db":"ok","redis":"ok"}`

Ctrl+C 停 dev server。

- [x] **Step 6: Commit**

```bash
git add app/api/health/ tests/api/
git commit -m "feat(p0): GET /api/health with db + redis checks"
```

---

## Task 12: 里程碑 M1 — POST /api/llm/ping 调通 LLM 流式

**Files:**
- Create: `app/api/llm/ping/route.ts`
- Create: `tests/api/llm-ping.test.ts`（非单测，手动 integration）

**Context**: Phase 0 第一个关键里程碑：Route Handler 用 Vercel AI SDK `streamText` 调真实 LLM，SSE 流式输出回客户端。这验证 env → provider-factory → Vercel SDK → 外部 LLM API 整条链路。

**关于测试**：这个 endpoint 依赖外部 LLM API，不能在 Vitest 里单测（费用、网络、key 管理）。我们用**手动 curl 验证** + 一个 mock LLM 的单测。

- [x] **Step 1: 写一个 mock LLM 的测试（不打真网络）**

Create `tests/api/llm-ping.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest'

describe('POST /api/llm/ping (mocked)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.TEST_LLM_BASE_URL = 'https://fake.local'
    process.env.TEST_LLM_API_KEY = 'sk-fake'
    process.env.TEST_LLM_MODEL = 'fake-model'
  })

  it('returns SSE stream concatenating to expected text', async () => {
    // Mock createModel to return something compatible
    vi.doMock('@/lib/llm/provider-factory', () => ({
      createModel: () => ({
        // Vercel AI SDK uses MockLanguageModelV2 from ai/test
        // but for now we shortcut: return a model whose doStream emits 2 deltas
        // We'll instead mock streamText directly
      }),
    }))
    vi.doMock('ai', async () => {
      const actual = (await vi.importActual('ai')) as Record<string, unknown>
      return {
        ...actual,
        streamText: () => ({
          textStream: (async function* () {
            yield 'Hello '
            yield 'world'
          })(),
          text: Promise.resolve('Hello world'),
        }),
      }
    })

    const { POST } = await import('@/app/api/llm/ping/route')
    const req = new Request('http://localhost/api/llm/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Say hello' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let fullOutput = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      fullOutput += decoder.decode(value)
    }
    expect(fullOutput).toContain('Hello')
    expect(fullOutput).toContain('world')
  })
})
```

- [x] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/api/llm-ping.test.ts
```

Expected: 失败。

- [x] **Step 3: 写实现**

Create `app/api/llm/ping/route.ts`:

```typescript
import { streamText } from 'ai'
import { createModel } from '@/lib/llm/provider-factory'
import { loadEnv } from '@/lib/env'
import { log } from '@/lib/telemetry/logger'
import { z } from 'zod'

export const runtime = 'nodejs'

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
})

/**
 * Phase 0 里程碑 M1：用服务端环境变量里的 TEST_LLM_* 调一次真实 LLM
 * 并以 SSE 流式返回增量文本，证明 Vercel AI SDK 整条链路走通。
 *
 * 响应格式（自定义 SSE，非 A2A）：
 *   data: {"kind":"delta","text":"部分内容"}\n\n
 *   data: {"kind":"done","fullText":"..."}\n\n
 *
 * 生产版本不会用这个 endpoint — 真实 agent 走 A2A 协议（Task 16-17）。
 */
export async function POST(req: Request): Promise<Response> {
  const env = loadEnv()
  if (!env.TEST_LLM_BASE_URL || !env.TEST_LLM_API_KEY || !env.TEST_LLM_MODEL) {
    return Response.json(
      { error: 'TEST_LLM_* env not configured' },
      { status: 503 },
    )
  }

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const model = createModel({
    kind: 'openai-compatible',
    providerId: 'test-llm',
    baseUrl: env.TEST_LLM_BASE_URL,
    model: env.TEST_LLM_MODEL,
    apiKey: env.TEST_LLM_API_KEY,
  })

  const result = streamText({
    model,
    messages: [{ role: 'user', content: parsed.data.prompt }],
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let full = ''
        for await (const delta of result.textStream) {
          full += delta
          const payload = JSON.stringify({ kind: 'delta', text: delta })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        }
        const payload = JSON.stringify({ kind: 'done', fullText: full })
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
      } catch (err) {
        log.error('llm/ping stream failed', { err: String(err) })
        const payload = JSON.stringify({ kind: 'error', message: String(err) })
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    },
  })
}
```

- [x] **Step 4: 跑 mock 测试**

Run:
```bash
npm test tests/api/llm-ping.test.ts
```

Expected: 1 passed。

- [x] **Step 5: 手工端到端验证（里程碑 M1）**

**前置**：把一个真实 LLM key 填进 `.env` 的 `TEST_LLM_*` 变量。推荐 DeepSeek（便宜）。

Run:
```bash
npm run dev
```

另一终端：
```bash
curl -N -X POST http://localhost:3000/api/llm/ping \
  -H "content-type: application/json" \
  -d '{"prompt":"用一句话介绍 A2A 协议"}'
```

Expected: 若干条 `data: {"kind":"delta","text":"..."}` 持续流出，最后一条是 `data: {"kind":"done","fullText":"..."}`。

**这是里程碑 M1 完成的硬证据。**

Ctrl+C 停 dev server。

- [x] **Step 6: Commit**

```bash
git add app/api/llm/ping/ tests/api/llm-ping.test.ts
git commit -m "feat(p0): M1 — POST /api/llm/ping streams real LLM via Vercel AI SDK"
```

---

## Task 13: A2A core 类型 + server-helpers（toy 版）

**Files:**
- Create: `lib/a2a-core/types.ts`
- Create: `lib/a2a-core/server-helpers.ts`
- Create: `tests/lib/a2a-core/server-helpers.test.ts`

**Context**: 给 Task 16/17 的 A2A endpoint 预备工具。**Phase 0 只做 toy 版本**——输出 A2A SSE 格式的响应，Phase 2 会正规化到 A2A v0.3 spec。

**核心 A2A 概念回顾**（spec 第 4.4 节）：
- 响应类型：`status-update` / `artifact-update`
- `artifact-update` 的 parts 可以是 `{kind: 'text', text: ...}` 或 `{kind: 'data', data: ...}`
- delta=true 表示是增量更新，false 表示完整替换

- [x] **Step 1: 写失败的测试**

Create `tests/lib/a2a-core/server-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createA2AStreamResponse } from '@/lib/a2a-core/server-helpers'

describe('createA2AStreamResponse', () => {
  it('emits status + artifact events in correct order', async () => {
    const res = createA2AStreamResponse({
      taskId: 'task_test_1',
      async *execute(emit) {
        emit.statusUpdate('working')
        emit.artifactUpdate({ parts: [{ kind: 'text', text: 'hello ' }], delta: true })
        emit.artifactUpdate({ parts: [{ kind: 'text', text: 'world' }], delta: true })
        emit.artifactUpdate({ parts: [{ kind: 'data', data: { action: 'fold' } }], delta: false })
        emit.statusUpdate('completed')
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let raw = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value)
    }

    // parse all data lines
    const events = raw
      .split('\n\n')
      .map((block) => block.split('\n').find((l) => l.startsWith('data: '))?.slice(6))
      .filter((x): x is string => !!x)
      .map((s) => JSON.parse(s) as { kind: string; [k: string]: unknown })

    expect(events[0]).toMatchObject({ kind: 'status-update', state: 'working', taskId: 'task_test_1' })
    expect(events[1]).toMatchObject({ kind: 'artifact-update', delta: true })
    expect(events[events.length - 1]).toMatchObject({ kind: 'status-update', state: 'completed' })
    // at least one artifact-update with kind=data
    expect(events.some((e) => (e as { artifact?: { parts?: { kind: string }[] } }).artifact?.parts?.[0]?.kind === 'data')).toBe(true)
  })
})
```

- [x] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/lib/a2a-core/server-helpers.test.ts
```

Expected: 失败。

- [x] **Step 3: 写 types.ts**

Create `lib/a2a-core/types.ts`:

```typescript
/**
 * Phase 0 toy A2A 类型（spec 第 4 节简化版）。
 * Phase 2 会对齐 @a2a-js/sdk 的正式类型或 A2A v0.3 spec。
 */

export type TaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled' | 'rejected'

export type TextPart = { kind: 'text'; text: string }
export type DataPart = { kind: 'data'; data: Record<string, unknown> }
export type Part = TextPart | DataPart

export type ArtifactUpdateInput = {
  parts: Part[]
  delta?: boolean
  artifactId?: string
}

export type StatusUpdateEvent = {
  kind: 'status-update'
  taskId: string
  state: TaskState
  message?: string
}

export type ArtifactUpdateEvent = {
  kind: 'artifact-update'
  taskId: string
  artifact: {
    artifactId: string
    parts: Part[]
  }
  delta: boolean
}

export type A2AStreamEvent = StatusUpdateEvent | ArtifactUpdateEvent

export type A2AEmitter = {
  statusUpdate: (state: TaskState, message?: string) => void
  artifactUpdate: (input: ArtifactUpdateInput) => void
}
```

- [x] **Step 4: 写 server-helpers.ts**

Create `lib/a2a-core/server-helpers.ts`:

```typescript
import type { A2AEmitter, A2AStreamEvent, ArtifactUpdateInput, TaskState } from './types'

export type CreateA2AStreamOptions = {
  taskId: string
  execute: (emit: A2AEmitter) => AsyncGenerator<void, void, unknown> | Promise<void>
}

/**
 * Phase 0 toy：输出 A2A 风格的 SSE 响应。
 * 生产版本（Phase 2）会换成 @a2a-js/sdk 的 A2AExpressApp / AgentExecutor。
 *
 * 该 helper 接受一个 execute 回调，回调里可以用 emit 发送：
 *   - emit.statusUpdate('working')
 *   - emit.artifactUpdate({ parts: [{ kind: 'text', text: '...' }], delta: true })
 */
export function createA2AStreamResponse(opts: CreateA2AStreamOptions): Response {
  const { taskId, execute } = opts
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let artifactCounter = 0

      const write = (event: A2AStreamEvent) => {
        const line = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(line))
      }

      const emit: A2AEmitter = {
        statusUpdate(state: TaskState, message?: string) {
          write({ kind: 'status-update', taskId, state, message })
        },
        artifactUpdate(input: ArtifactUpdateInput) {
          const artifactId = input.artifactId ?? `artifact_${artifactCounter++}`
          write({
            kind: 'artifact-update',
            taskId,
            artifact: { artifactId, parts: input.parts },
            delta: input.delta ?? false,
          })
        },
      }

      try {
        emit.statusUpdate('submitted')
        const result = execute(emit)
        if (result && typeof (result as AsyncGenerator).next === 'function') {
          // 用户返回了 generator，把它耗尽
          for await (const _ of result as AsyncGenerator) {
            /* no-op; emit 在 generator 内部被调用 */
          }
        } else {
          await (result as Promise<void>)
        }
      } catch (err) {
        emit.statusUpdate('failed', String(err))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    },
  })
}
```

- [x] **Step 5: 跑测试验证通过**

Run:
```bash
npm test tests/lib/a2a-core/server-helpers.test.ts
```

Expected: 1 passed。

- [x] **Step 6: Commit**

```bash
git add lib/a2a-core/types.ts lib/a2a-core/server-helpers.ts tests/lib/a2a-core/
git commit -m "feat(p0): toy A2A server-helpers (createA2AStreamResponse)"
```

---

## Task 14: A2A client（toy 版）

**Files:**
- Create: `lib/a2a-core/client.ts`
- Create: `tests/lib/a2a-core/client.test.ts`

**Context**: 一个最小的 A2A HTTP 客户端：POST 到 agent endpoint，读 SSE 流，把文本增量通过 `onThinking` 回调出去，拿到最终 data artifact 作为 decision 返回。

- [x] **Step 1: 写失败的测试**

Create `tests/lib/a2a-core/client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { requestAgentDecisionToy } from '@/lib/a2a-core/client'

describe('requestAgentDecisionToy', () => {
  it('streams text via onThinking and returns data artifact', async () => {
    // Mock fetch to return a controlled SSE stream
    const sseBody = [
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'submitted' })}\n\n`,
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'working' })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't1',
        artifact: { artifactId: 'a0', parts: [{ kind: 'text', text: 'thinking ' }] },
        delta: true,
      })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't1',
        artifact: { artifactId: 'a0', parts: [{ kind: 'text', text: 'more...' }] },
        delta: true,
      })}\n\n`,
      `data: ${JSON.stringify({
        kind: 'artifact-update',
        taskId: 't1',
        artifact: { artifactId: 'a1', parts: [{ kind: 'data', data: { action: 'fold' } }] },
        delta: false,
      })}\n\n`,
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'completed' })}\n\n`,
    ].join('')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const thoughts: string[] = []
    const result = await requestAgentDecisionToy({
      url: 'http://localhost/api/agents/x/message/stream',
      taskId: 't1',
      message: { role: 'user', parts: [{ kind: 'data', data: { kind: 'test' } }] },
      matchToken: 'tok',
      onThinking: (d) => thoughts.push(d),
    })

    expect(thoughts.join('')).toBe('thinking more...')
    expect(result).toEqual({ action: 'fold' })
    expect(mockFetch).toHaveBeenCalledOnce()
    const call = mockFetch.mock.calls[0]
    const init = call[1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Match-Token']).toBe('tok')
  })

  it('throws when no data artifact returned', async () => {
    const sseBody =
      `data: ${JSON.stringify({ kind: 'status-update', taskId: 't1', state: 'completed' })}\n\n`
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    )

    await expect(
      requestAgentDecisionToy({
        url: 'http://x',
        taskId: 't',
        message: { role: 'user', parts: [] },
        matchToken: 't',
      }),
    ).rejects.toThrow(/no data artifact/i)
  })
})
```

- [x] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/lib/a2a-core/client.test.ts
```

Expected: 失败。

- [x] **Step 3: 写实现**

Create `lib/a2a-core/client.ts`:

```typescript
import type { Part } from './types'

export type RequestAgentInput = {
  url: string
  taskId: string
  message: {
    role: 'user' | 'system'
    parts: Part[]
  }
  matchToken: string
  onThinking?: (delta: string) => void
  timeoutMs?: number
}

/**
 * Phase 0 toy A2A client。不依赖 @a2a-js/sdk；直接 POST + 解析 SSE。
 * Phase 2 会替换为 @a2a-js/sdk 的 A2AClient.messageStream()。
 *
 * 契约：
 *  - 发出 POST 到 agent 的 message:stream endpoint
 *  - 读 SSE；对每个 text artifact 增量调 onThinking()
 *  - 遇到第一个 data artifact 就记下来作为 decision
 *  - 流结束后，返回 decision；没有 data artifact 则抛错
 *
 * 超时：timeoutMs > 0 时用 AbortController；=0 表示不限时。
 */
export async function requestAgentDecisionToy<T = Record<string, unknown>>(
  input: RequestAgentInput,
): Promise<T> {
  const { url, taskId, message, matchToken, onThinking, timeoutMs = 60000 } = input

  const abort = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => abort.abort(), timeoutMs) : null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Match-Token': matchToken,
      },
      body: JSON.stringify({
        message: {
          messageId: `msg_${taskId}`,
          taskId,
          ...message,
        },
      }),
      signal: abort.signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`agent endpoint returned ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let decision: T | null = null

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      // SSE 事件按 \n\n 分隔
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
        if (!dataLine) continue
        const payload = JSON.parse(dataLine.slice(6)) as {
          kind: string
          artifact?: { parts?: Part[] }
        }
        if (payload.kind === 'artifact-update') {
          const parts = payload.artifact?.parts ?? []
          for (const p of parts) {
            if (p.kind === 'text' && onThinking) onThinking(p.text)
            if (p.kind === 'data' && !decision) decision = p.data as T
          }
        }
      }
    }

    if (!decision) throw new Error('no data artifact returned')
    return decision
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

- [x] **Step 4: 跑测试验证通过**

Run:
```bash
npm test tests/lib/a2a-core/client.test.ts
```

Expected: 2 passed。

- [x] **Step 5: Commit**

```bash
git add lib/a2a-core/client.ts tests/lib/a2a-core/client.test.ts
git commit -m "feat(p0): toy A2A client (fetch + SSE decode)"
```

---

## Task 15: Toy Agent Card endpoint

**Files:**
- Create: `app/api/agents/[agentId]/.well-known/agent-card.json/route.ts`
- Create: `tests/api/agent-card.test.ts`

**Context**: 里程碑 M2 的前置 —— 任何 A2A Agent 必须能发布 Agent Card 描述自己。Phase 0 用硬编码的 toy agent 回一份静态 card。Phase 1 会对接真实 `agents` 表。

**Windows 文件名注意**：路径里 `.well-known/agent-card.json` 是合法的（点开头的目录在 Windows 可行）。如 PowerShell 创建失败，改用 `bash` / `mkdir -p`。

- [ ] **Step 1: 写失败的测试**

Create `tests/api/agent-card.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('GET /api/agents/:id/.well-known/agent-card.json', () => {
  it('returns a valid A2A agent card for toy agent', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/.well-known/agent-card.json/route')
    const res = await GET(new Request('http://localhost/x'), { params: Promise.resolve({ agentId: 'toy-poker' }) })
    expect(res.status).toBe(200)
    const card = (await res.json()) as {
      protocolVersion: string
      name: string
      url: string
      skills: { id: string }[]
    }
    expect(card.protocolVersion).toMatch(/^0\.3/)
    expect(card.name).toBe('toy-poker')
    expect(card.url).toContain('/api/agents/toy-poker')
    expect(card.skills.length).toBeGreaterThan(0)
  })

  it('returns 404 for unknown agent id', async () => {
    const { GET } = await import('@/app/api/agents/[agentId]/.well-known/agent-card.json/route')
    const res = await GET(new Request('http://localhost/x'), { params: Promise.resolve({ agentId: 'unknown-xyz' }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/api/agent-card.test.ts
```

Expected: 失败。

- [ ] **Step 3: 建目录 + 写实现**

Run:
```bash
mkdir -p "app/api/agents/[agentId]/.well-known/agent-card.json"
```

Create `app/api/agents/[agentId]/.well-known/agent-card.json/route.ts`:

```typescript
import { loadEnv } from '@/lib/env'

export const runtime = 'nodejs'

/**
 * Phase 0 toy：返回硬编码的 'toy-poker' 和 'toy-echo' 两个 agent card。
 * Phase 1 会改成查 `agents` 表动态生成。
 */
const TOY_AGENTS: Record<string, () => Record<string, unknown>> = {
  'toy-poker': () => ({
    protocolVersion: '0.3.0',
    name: 'toy-poker',
    description: 'Phase 0 toy agent that always returns {"action":"fold"} for testing the full A2A pipeline.',
    version: '0.0.1',
    url: `${loadEnv().BASE_URL}/api/agents/toy-poker`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: 'poker-decision',
        name: 'Toy Poker Decision',
        description: 'Always folds',
        tags: ['poker', 'toy'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    securitySchemes: {
      apiKey: {
        apiKeySecurityScheme: { location: 'header', name: 'X-Match-Token' },
      },
    },
  }),
  'toy-echo': () => ({
    protocolVersion: '0.3.0',
    name: 'toy-echo',
    description: 'Echoes the prompt back as thinking, returns {"echoed": prompt} as action.',
    version: '0.0.1',
    url: `${loadEnv().BASE_URL}/api/agents/toy-echo`,
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    skills: [
      {
        id: 'echo',
        name: 'Echo',
        description: 'Echo the input back',
        tags: ['toy'],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
    ],
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
  }),
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params
  const builder = TOY_AGENTS[agentId]
  if (!builder) {
    return Response.json({ error: `unknown agent: ${agentId}` }, { status: 404 })
  }
  return Response.json(builder())
}
```

- [ ] **Step 4: 跑测试验证通过**

Run:
```bash
npm test tests/api/agent-card.test.ts
```

Expected: 2 passed。

- [ ] **Step 5: 手工验证**

Run:
```bash
npm run dev
```

另一终端：
```bash
curl http://localhost:3000/api/agents/toy-poker/.well-known/agent-card.json
```

Expected: 看到 A2A Agent Card JSON。

Ctrl+C 停 dev。

- [ ] **Step 6: Commit**

```bash
git add app/api/agents/ tests/api/agent-card.test.ts
git commit -m "feat(p0): toy agent card endpoint (toy-poker, toy-echo)"
```

---

## Task 16: Toy Agent message/stream endpoint

**Files:**
- Create: `app/api/agents/[agentId]/message/stream/route.ts`
- Create: `tests/api/agent-message-stream.test.ts`

**Context**: 里程碑 M2 核心端点。`toy-poker` 不调 LLM，只流一段假思考然后返回 `{action:"fold"}`；`toy-echo` 调真 LLM 流式返回思考并把结果包成 data artifact。

**Windows 路径说明**（plan 头 File Responsibility Notes 提到）：spec 用 `message:stream`（冒号），但 Next.js 路由里 `:` 有特殊含义。本 plan 实际用 `message/stream`（斜杠）。Phase 2 正规化时可用 `@a2a-js/sdk` 的 A2AExpressApp 直接挂载，届时 URL 会是 SDK 决定的。

- [ ] **Step 1: 写失败的测试**

Create `tests/api/agent-message-stream.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'

describe('POST /api/agents/:id/message/stream', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  async function callAgent(agentId: string, body: unknown): Promise<Response> {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const req = new Request(`http://localhost/api/agents/${agentId}/message/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Match-Token': 'toy-token',
      },
      body: JSON.stringify(body),
    })
    return POST(req, { params: Promise.resolve({ agentId }) })
  }

  it('toy-poker streams a fold decision', async () => {
    const res = await callAgent('toy-poker', {
      message: { messageId: 'm1', taskId: 't1', role: 'user', parts: [{ kind: 'data', data: {} }] },
    })
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let raw = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value)
    }
    // must contain a data artifact with action=fold
    expect(raw).toContain('"action":"fold"')
    // must contain a status=completed
    expect(raw).toContain('"state":"completed"')
  })

  it('returns 404 for unknown agent', async () => {
    const res = await callAgent('unknown-xxx', {
      message: { messageId: 'm', taskId: 't', role: 'user', parts: [] },
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when body invalid', async () => {
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    const req = new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req, { params: Promise.resolve({ agentId: 'toy-poker' }) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run:
```bash
npm test tests/api/agent-message-stream.test.ts
```

Expected: 失败。

- [ ] **Step 3: 建目录 + 写实现**

Run:
```bash
mkdir -p "app/api/agents/[agentId]/message/stream"
```

Create `app/api/agents/[agentId]/message/stream/route.ts`:

```typescript
import { z } from 'zod'
import { streamText } from 'ai'
import { createA2AStreamResponse } from '@/lib/a2a-core/server-helpers'
import { createModel } from '@/lib/llm/provider-factory'
import { loadEnv } from '@/lib/env'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'

const messageSchema = z.object({
  message: z.object({
    messageId: z.string(),
    taskId: z.string(),
    role: z.enum(['user', 'system']),
    parts: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('text'), text: z.string() }),
        z.object({ kind: z.literal('data'), data: z.record(z.string(), z.unknown()) }),
      ]),
    ),
  }),
})

type ToyHandler = (input: {
  body: z.infer<typeof messageSchema>
  env: ReturnType<typeof loadEnv>
}) => Promise<Response>

const toyAgents: Record<string, ToyHandler> = {
  'toy-poker': async ({ body }) => {
    const taskId = body.message.taskId
    return createA2AStreamResponse({
      taskId,
      async execute(emit) {
        emit.statusUpdate('working')
        // 假思考：分 3 段推出
        for (const chunk of ['正在评估牌面...', ' 对手似乎很紧...', ' 决定弃牌。']) {
          emit.artifactUpdate({ parts: [{ kind: 'text', text: chunk }], delta: true })
          await new Promise((r) => setTimeout(r, 30))
        }
        emit.artifactUpdate({
          parts: [{ kind: 'data', data: { action: 'fold', reasoning: 'toy' } }],
          delta: false,
        })
        emit.statusUpdate('completed')
      },
    })
  },

  'toy-echo': async ({ body, env }) => {
    const taskId = body.message.taskId
    if (!env.TEST_LLM_BASE_URL || !env.TEST_LLM_API_KEY || !env.TEST_LLM_MODEL) {
      // 无 LLM 配置 fallback 到假回复
      return createA2AStreamResponse({
        taskId,
        async execute(emit) {
          emit.statusUpdate('working')
          emit.artifactUpdate({ parts: [{ kind: 'text', text: '（无 LLM 配置）' }], delta: true })
          emit.artifactUpdate({
            parts: [{ kind: 'data', data: { echoed: 'noop', note: 'no LLM configured' } }],
            delta: false,
          })
          emit.statusUpdate('completed')
        },
      })
    }

    const dataPart = body.message.parts.find((p) => p.kind === 'data')
    const prompt = dataPart && dataPart.kind === 'data' ? JSON.stringify(dataPart.data) : 'hi'

    const model = createModel({
      kind: 'openai-compatible',
      providerId: 'test-llm',
      baseUrl: env.TEST_LLM_BASE_URL,
      model: env.TEST_LLM_MODEL,
      apiKey: env.TEST_LLM_API_KEY,
    })

    return createA2AStreamResponse({
      taskId,
      async execute(emit) {
        emit.statusUpdate('working')
        let full = ''
        try {
          const result = streamText({
            model,
            messages: [
              {
                role: 'user',
                content: `Echo this back with a brief comment: ${prompt}`,
              },
            ],
          })
          for await (const delta of result.textStream) {
            full += delta
            emit.artifactUpdate({ parts: [{ kind: 'text', text: delta }], delta: true })
          }
        } catch (err) {
          log.error('toy-echo LLM call failed', { err: String(err) })
          emit.artifactUpdate({ parts: [{ kind: 'text', text: `[error: ${err}]` }], delta: true })
        }
        emit.artifactUpdate({
          parts: [{ kind: 'data', data: { echoed: prompt, llmText: full } }],
          delta: false,
        })
        emit.statusUpdate('completed')
      },
    })
  },
}

export async function POST(
  req: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params
  const handler = toyAgents[agentId]
  if (!handler) {
    return Response.json({ error: `unknown agent: ${agentId}` }, { status: 404 })
  }

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const parsed = messageSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const env = loadEnv()
  return handler({ body: parsed.data, env })
}
```

- [ ] **Step 4: 跑测试验证通过**

Run:
```bash
npm test tests/api/agent-message-stream.test.ts
```

Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add app/api/agents/[agentId]/message/ tests/api/agent-message-stream.test.ts
git commit -m "feat(p0): toy agent message/stream endpoint (toy-poker folds, toy-echo calls LLM)"
```

---

## Task 17: 里程碑 M2 — Client 端到端调 toy agent

**Files:**
- Create: `tests/api/agent-e2e.test.ts`（integration）
- Modify: `lib/a2a-core/client.ts`（小修：支持从 agentId 推导 URL，方便测试）

**Context**: 用 Task 14 的 toy client 调 Task 16 的 toy endpoint，走完 HTTP → SSE → 流式解析 → 决策返回的完整链路。这是里程碑 M2 的硬证据。

- [ ] **Step 1: 写 integration 测试**

Create `tests/api/agent-e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest'

describe('M2: A2A end-to-end (toy client → toy server)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test'
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('client gets fold decision from toy-poker', async () => {
    // Intercept fetch: route it to our Route Handler in-memory
    const { POST } = await import('@/app/api/agents/[agentId]/message/stream/route')
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      // Expect url like .../api/agents/toy-poker/message/stream
      const m = url.match(/\/api\/agents\/([^/]+)\/message\/stream/)
      if (!m) throw new Error(`unexpected url: ${url}`)
      const agentId = m[1]
      const req = new Request(url, init)
      return POST(req, { params: Promise.resolve({ agentId }) })
    })

    const { requestAgentDecisionToy } = await import('@/lib/a2a-core/client')
    const thoughts: string[] = []
    const decision = await requestAgentDecisionToy<{ action: string; reasoning: string }>({
      url: 'http://localhost:3000/api/agents/toy-poker/message/stream',
      taskId: 'task_e2e_1',
      message: {
        role: 'user',
        parts: [{ kind: 'data', data: { kind: 'poker/decide', state: {} } }],
      },
      matchToken: 'e2e-tok',
      onThinking: (d) => thoughts.push(d),
    })

    expect(decision.action).toBe('fold')
    expect(thoughts.length).toBeGreaterThan(0)
    expect(thoughts.join('')).toContain('评估')
  })
})
```

- [ ] **Step 2: 运行测试验证通过**

Run:
```bash
npm test tests/api/agent-e2e.test.ts
```

Expected: 1 passed。

- [ ] **Step 3: 手工端到端验证（里程碑 M2）**

Run:
```bash
npm run infra:up  # 若没起
npm run dev
```

另一终端先用 curl 直接打 endpoint：

```bash
curl -N -X POST http://localhost:3000/api/agents/toy-poker/message/stream \
  -H "content-type: application/json" \
  -H "X-Match-Token: test" \
  -d '{"message":{"messageId":"m1","taskId":"t1","role":"user","parts":[{"kind":"data","data":{"kind":"poker/decide"}}]}}'
```

Expected: 一串 `data: {"kind":"status-update"...}` → 3 条 text 增量 → `data: {"kind":"artifact-update",...,"parts":[{"kind":"data","data":{"action":"fold"...}}]}` → `data: {"kind":"status-update","state":"completed"}`。

**这是里程碑 M2 完成的硬证据。**

Ctrl+C 停 dev。

- [ ] **Step 4: Commit**

```bash
git add tests/api/agent-e2e.test.ts
git commit -m "test(p0): M2 — A2A end-to-end integration test (client → server)"
```

---

## Task 18: README + phase-0 完成标记

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/notes/phase-0-complete.md`

- [ ] **Step 1: 写项目 README**

Create `README.md`:

```markdown
# Colosseum

LLM Agent Arena — 基于 A2A 协议的多 Agent 博弈竞技平台。

## 状态

- **Phase 0（骨架）**：✅ 完成（M1 LLM 链路 + M2 A2A toy agent 端到端）
- **Phase 1（Poker MVP）**：🚧 进行中
- **Phase 2（A2A 正规化）**：⏳ 计划中
- **Phase 3（Werewolf）**：⏳ 计划中
- **Phase 4（生产部署）**：⏳ 计划中

## 技术栈

- Next.js 15 (App Router, Node runtime)
- TypeScript 5.9 严格模式
- Drizzle ORM + SQLite（dev）/ Postgres 16（prod）
- Vercel AI SDK v5 + `@a2a-js/sdk` + `ioredis`
- Tailwind 4 + shadcn/ui
- Vitest

## 快速启动（开发）

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填 TEST_LLM_BASE_URL / _API_KEY / _MODEL

# 3. 启动基础设施（postgres + redis 容器）
npm run infra:up

# 4. 初始化 DB
npm run db:generate
npm run db:migrate

# 5. 启动 Next.js dev server
npm run dev
```

打开 http://localhost:3000 。

## 测试

```bash
npm test               # 一次性跑
npm run test:watch     # watch 模式
```

## 关键文档

- `docs/superpowers/specs/2026-05-06-colosseum-rewrite-brief.md` — 简要设计（mermaid）
- `docs/superpowers/specs/2026-05-06-colosseum-rewrite-design.md` — 完整技术设计
- `docs/superpowers/plans/` — 按 Phase 拆分的实施计划
- `old/` — 原 LLM Poker Arena 项目完整归档（游戏规则/UI 视觉参考用）

## 验证 Phase 0 里程碑

**M1 — LLM 链路**：

```bash
curl -N -X POST http://localhost:3000/api/llm/ping \
  -H "content-type: application/json" \
  -d '{"prompt":"用一句话介绍 A2A 协议"}'
```

**M2 — A2A toy agent**：

```bash
curl http://localhost:3000/api/agents/toy-poker/.well-known/agent-card.json

curl -N -X POST http://localhost:3000/api/agents/toy-poker/message/stream \
  -H "content-type: application/json" \
  -H "X-Match-Token: test" \
  -d '{"message":{"messageId":"m1","taskId":"t1","role":"user","parts":[{"kind":"data","data":{}}]}}'
```
```

- [ ] **Step 2: 写 phase-0-complete.md**

```bash
mkdir -p docs/superpowers/notes
```

Create `docs/superpowers/notes/phase-0-complete.md`:

```markdown
# Phase 0 完成报告

日期：YYYY-MM-DD（填写实际完成日期）

## 交付物

### 基础设施
- ✅ Next.js 15 项目骨架（App Router, Node runtime, 严格 TS）
- ✅ Tailwind 4 + globals.css
- ✅ Vitest + jsdom + @testing-library
- ✅ ESLint（忽略 old/）
- ✅ Docker Compose（Postgres 16 + Redis 7，仅基础设施，Next.js 本机跑）

### Lib 层
- ✅ `lib/env.ts` — zod 校验的环境变量加载
- ✅ `lib/db/client.ts` + `schema.sqlite.ts` — Drizzle + SQLite 驱动
- ✅ `lib/redis/client.ts` — ioredis 单例
- ✅ `lib/telemetry/logger.ts` — 结构化 JSON 日志
- ✅ `lib/llm/catalog.ts` — 静态 provider catalog
- ✅ `lib/llm/provider-factory.ts` — Vercel AI SDK 工厂（openai-compatible + anthropic）
- ✅ `lib/a2a-core/types.ts` — A2A SSE 事件类型
- ✅ `lib/a2a-core/server-helpers.ts` — `createA2AStreamResponse`（toy）
- ✅ `lib/a2a-core/client.ts` — `requestAgentDecisionToy`（toy）

### Route Handlers
- ✅ GET `/api/health` — db + redis 健康检查
- ✅ POST `/api/llm/ping` — **里程碑 M1** — 真实 LLM 流式
- ✅ GET `/api/agents/:id/.well-known/agent-card.json` — toy agent card
- ✅ POST `/api/agents/:id/message/stream` — toy agent endpoint

### 测试
- ✅ Smoke test
- ✅ env / db / redis / logger / catalog / provider-factory 单测
- ✅ health / llm-ping（mocked）/ agent-card / agent-message-stream 路由测试
- ✅ M2 integration：A2A client → server 端到端

## 里程碑状态

- ✅ **M1**：`POST /api/llm/ping` 流式调通真实 LLM（DeepSeek / OpenAI / Claude 任一）
- ✅ **M2**：toy A2A client 调用 toy A2A server 成功获得结构化 decision

## 为 Phase 1 保留的尾巴 / 已知简化

1. **Agent Card 端点是硬编码**：Phase 1 改为查 `agents` 表动态生成
2. **Agent message endpoint 是硬编码**：Phase 1 接入真实 `gameRegistry.get(gameType)` 调对应 ContextBuilder/ResponseParser
3. **A2A 协议是 toy 版本**：Phase 2 正规化到 @a2a-js/sdk A2AExpressApp/AgentExecutor
4. **URL 用 `message/stream`（斜杠）而非 spec 的 `message:stream`（冒号）**：Phase 2 决定最终 URL 格式
5. **db 只有 `api_profiles`**：Phase 1 按 spec 第 8 节补齐所有 9 张表
6. **没有生产 Postgres 分支的 db client**：Phase 4 实现

## 下一步（Phase 1）

入口：`docs/superpowers/plans/2026-05-06-phase-1-poker-mvp.md`
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/notes/
git commit -m "docs(p0): README + phase-0-complete report"
```

---

## Task 19: 整体验收

**Files:**
- 无需改动

- [ ] **Step 1: 全量测试通过**

Run:
```bash
npm run infra:up
npm test
```

Expected: 所有测试通过，没有 fail 或 skip。

- [ ] **Step 2: Lint 通过**

Run:
```bash
npm run lint
```

Expected: 0 errors, 0 warnings（或仅 Next.js 推荐级别警告）。

- [ ] **Step 3: Type check**

Run:
```bash
npx tsc --noEmit
```

Expected: 0 errors。

- [ ] **Step 4: Build 成功**

Run:
```bash
npm run build
```

Expected: 成功编译。可能看到 "compiled successfully" 和路由表。

- [ ] **Step 5: 启动 prod 模式验证 M1 + M2 真实环境**

Run:
```bash
npm start
```

另一终端重新验证 curl（见 Task 12 Step 5 和 Task 17 Step 3）。

Ctrl+C 停。

- [ ] **Step 6: git log 审阅**

Run:
```bash
git log --oneline -30
```

Expected: 看到 ~20 条 "feat(p0)/test(p0)/chore(p0)/docs(p0)" commits。

- [ ] **Step 7: tag phase-0 完成**

```bash
git tag -a phase-0 -m "Phase 0 complete: skeleton + M1 LLM + M2 A2A toy"
```

---

## Phase 0 Done 定义

满足以下所有条件视为 Phase 0 完成：

1. ✅ `npm test` 全绿
2. ✅ `npm run lint` 零错误
3. ✅ `npm run build` 成功
4. ✅ `curl POST /api/llm/ping` 能流式拿到真实 LLM 响应（M1）
5. ✅ `curl POST /api/agents/toy-poker/message/stream` 能流式拿到 toy agent 响应（M2）
6. ✅ Git 历史清晰，有独立 tag `phase-0`

完成后进入 `docs/superpowers/plans/2026-05-06-phase-1-poker-mvp.md`。

---

## 已知 SDK 漂移风险（执行者注意）

以下几个点本 plan 按当前认知写代码，执行时如遇**编译/类型错误**请先查 SDK 最新文档，**不要强行按 plan 代码来**：

1. **Vercel AI SDK v5 的 `streamText` 返回值形状**：plan 假设 `result.textStream` 是 `AsyncIterable<string>`，且 `await result.text` 返回完整文本。若实际 API 是 `result.fullStream` / `result.textStream.pipeTo(...)` 等变体，参考官方文档调整。相关 Task：12、16。

2. **`@ai-sdk/openai-compatible` 调用形式**：plan 假设 `createOpenAICompatible({name, baseURL, apiKey})(model)` 返回 `LanguageModel`。若 SDK 是 `.chat(model)` / `.languageModel(model)`，调整 `lib/llm/provider-factory.ts`。

3. **`@a2a-js/sdk`**：Phase 0 **不用** 该 SDK（我们写 toy 版 server-helpers + client）。但 Task 1 Step 4 装了它——如果 NPM 上找不到该包名，停下来求助用户，可能正式包名是 `@a2aproject/sdk` 或其他。

4. **Next.js 15 async params**：plan 使用 `{ params: Promise<{ agentId: string }> }` 然后 `await context.params`。若项目实际是 Next.js 15.0-15.1 某个版本 params 不是 Promise，直接改成 `{ params: { agentId: string } }`。

5. **Drizzle SQLite schema 的 `timestamp` mode**：plan 用 `integer('created_at', { mode: 'timestamp' })`。若报类型错，改用 `text('created_at').default(sql\`CURRENT_TIMESTAMP\`)` 存 ISO 字符串。

**一条通用规则**：遇到 SDK API 漂移时，**打开官方文档或 node_modules 里的 d.ts 查真实签名**，然后调整代码；**不要**把 types 强转 `as any` 绕过去。
