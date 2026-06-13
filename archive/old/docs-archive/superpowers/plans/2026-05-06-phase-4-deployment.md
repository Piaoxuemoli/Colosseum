# Phase 4 — 云服务器生产部署（Docker Compose + Caddy + Postgres）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把本地验证完的 Colosseum 打包成 Docker 镜像，用 Compose 在云服务器（`43.156.230.108:3000` 或新购服务器）起 nextjs + postgres + redis + caddy 四个容器；生产 schema 用 Drizzle migrate 同步；备份 cron 就位；公网 URL（或 IP:80）可访问。

**Architecture:**
- 多阶段 Dockerfile（deps → builder → runner），runner 用 Next.js standalone 输出
- `ops/deploy/docker-compose.yml`：nextjs / postgres:16 / redis:7 / caddy:2
- Caddy 反代 80/443 → nextjs:3000；无域名阶段用 `:80`
- Migrations：容器 entry point 启动时自动 `drizzle-kit migrate`
- 备份：crontab `pg_dump` + 14 天轮转

**前置条件：** Phase 3 完成；本地 `npm run build` 绿；`ops/private/deploy.env` 存 SSH/密码等凭据（不入库）。

**参考 spec:** 第 12.1~12.6 节（Docker / Caddy / Dockerfile / Migrations / 备份 / Vercel fallback）。

**不做的事：**
- ❌ Vercel fallback 部署（Phase 5）
- ❌ HTTPS 证书（等域名再启用 Caddy 自动 ACME）
- ❌ HA / 多机（超出范围）

---

## 文件结构

```
Colosseum/
├── ops/deploy/
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── Caddyfile
│   ├── .env.example                         # 生产环境变量模板
│   ├── entrypoint.sh                        # 启动 Next.js 前跑 migrate
│   └── README.md                            # 部署手册（SSH → compose → logs）
├── ops/private/                              # git-ignored；包含 deploy.env + ssh key
│   └── .gitkeep
├── scripts/
│   └── backup.sh                            # pg_dump + 轮转
├── drizzle.config.prod.ts
└── .dockerignore
```

---

## Task 1: Next.js standalone output + .dockerignore

**Files:**
- Modify: `next.config.ts`
- Create: `.dockerignore`

- [ ] **Step 1: 开 standalone**

```typescript
// next.config.ts
const config = {
  output: 'standalone',
  // ...
}
export default config
```

- [ ] **Step 2: .dockerignore**

```
node_modules
.next
.git
old
docs
tests
*.md
ops/private
.env*
.vscode
.claude
.codebuddy
.superpowers
```

- [ ] **Step 3: 本地验证构建**

```bash
npm run build
ls .next/standalone/server.js
```

Expected: `server.js` 存在，`.next/standalone` 体积可控。

- [ ] **Step 4: Commit**

```bash
git add next.config.ts .dockerignore
git commit -m "chore(p4): standalone output + dockerignore"
```

---

## Task 2: Dockerfile 多阶段

**Files:**
- Create: `ops/deploy/Dockerfile`
- Create: `ops/deploy/entrypoint.sh`

**Context:** 3 个 stage：deps 装依赖；builder 跑 `next build`；runner 从 standalone 拷贝启动。entrypoint 负责在启动 server.js 前跑 drizzle migrate。

- [ ] **Step 1: Dockerfile**

```dockerfile
# ops/deploy/Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache postgresql-client

# 非 root 用户
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.prod.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY ops/deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["/entrypoint.sh"]
```

- [ ] **Step 2: entrypoint.sh**

```bash
#!/bin/sh
set -e

echo "[entrypoint] running drizzle migrate..."
node ./node_modules/drizzle-kit/bin.cjs migrate --config drizzle.config.ts

echo "[entrypoint] seeding default moderator..."
node -e "require('./dist/seed-default-moderator.js')" || true

echo "[entrypoint] starting nextjs..."
exec node server.js
```

（seed 脚本需 build 时转译到 `dist/`；可用 `tsx` 直接跑 TS 源码代替 —— 见 Step 3。）

- [ ] **Step 3: drizzle.config.prod.ts**

```typescript
import type { Config } from 'drizzle-kit'
export default {
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

- [ ] **Step 4: 本地构建冒烟**

```bash
docker build -f ops/deploy/Dockerfile -t colosseum:local .
```

Expected: 构建成功，3 个 stage 都过。

- [ ] **Step 5: Commit**

```bash
git add ops/deploy/Dockerfile ops/deploy/entrypoint.sh drizzle.config.prod.ts
git commit -m "feat(p4): Dockerfile multi-stage + entrypoint migrate"
```

---

## Task 3: docker-compose.yml + Caddyfile + .env.example

**Files:**
- Create: `ops/deploy/docker-compose.yml`
- Create: `ops/deploy/Caddyfile`
- Create: `ops/deploy/.env.example`

- [ ] **Step 1: docker-compose.yml**

```yaml
# ops/deploy/docker-compose.yml
services:
  nextjs:
    image: colosseum:prod
    build: { context: ../.., dockerfile: ops/deploy/Dockerfile }
    environment:
      - DATABASE_URL=postgres://arena:${DB_PASSWORD}@postgres:5432/arena
      - REDIS_URL=redis://redis:6379
      - BASE_URL=${BASE_URL}
      - MATCH_TOKEN_SECRET=${MATCH_TOKEN_SECRET}
      - LOG_LEVEL=info
      - SYSTEM_MODERATOR_BASE_URL=${SYSTEM_MODERATOR_BASE_URL}
      - SYSTEM_MODERATOR_MODEL=${SYSTEM_MODERATOR_MODEL}
      - NODE_ENV=production
    depends_on: [postgres, redis]
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=arena
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=arena
    volumes: [pgdata:/var/lib/postgresql/data]
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes: [redisdata:/data]
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [nextjs]
    restart: unless-stopped

volumes: { pgdata: {}, redisdata: {}, caddy_data: {}, caddy_config: {} }
```

- [ ] **Step 2: Caddyfile**

```
:80 {
  encode gzip
  reverse_proxy nextjs:3000

  @sse {
    path /api/matches/*/stream
  }
  handle @sse {
    reverse_proxy nextjs:3000 {
      flush_interval -1
      transport http {
        read_timeout  2h
        write_timeout 2h
      }
    }
  }
}

# 有域名时启用（Caddy 自动申请证书）
# your-domain.com {
#   encode gzip
#   reverse_proxy nextjs:3000
# }
```

- [ ] **Step 3: .env.example**

```env
# ops/deploy/.env.example
DB_PASSWORD=change-me-strong-password
MATCH_TOKEN_SECRET=change-me-32bytes-random
BASE_URL=http://43.156.230.108
SYSTEM_MODERATOR_BASE_URL=https://api.deepseek.com/v1
SYSTEM_MODERATOR_MODEL=deepseek-chat
```

- [ ] **Step 4: 本地冒烟**

```bash
cd ops/deploy
cp .env.example .env
# 填 DB_PASSWORD / MATCH_TOKEN_SECRET
docker compose up -d --build
curl http://localhost/api/_health
docker compose logs nextjs | tail -50
docker compose down -v
```

Expected: `/api/_health` 返回 200 JSON；logs 可见 "listening on 3000"。

- [ ] **Step 5: Commit**

```bash
git add ops/deploy/docker-compose.yml ops/deploy/Caddyfile ops/deploy/.env.example
git commit -m "feat(p4): compose stack (nextjs/postgres/redis/caddy)"
```

---

## Task 4: 备份脚本 + cron

**Files:**
- Create: `scripts/backup.sh`
- Create: `ops/deploy/cron.d/colosseum-backup`

- [ ] **Step 1: backup.sh**

```bash
#!/bin/sh
# scripts/backup.sh — 在服务器上跑，pg_dump + 14 天轮转
set -e
BACKUP_DIR=${BACKUP_DIR:-/var/backups/colosseum}
mkdir -p "$BACKUP_DIR"
DATE=$(date +%F-%H%M)
docker exec colosseum-postgres-1 pg_dump -U arena arena | gzip > "$BACKUP_DIR/arena-$DATE.sql.gz"
find "$BACKUP_DIR" -name "arena-*.sql.gz" -mtime +14 -delete
echo "[backup] ok: $BACKUP_DIR/arena-$DATE.sql.gz"
```

- [ ] **Step 2: cron 文件**

```
# ops/deploy/cron.d/colosseum-backup
0 3 * * * root /opt/colosseum/scripts/backup.sh >> /var/log/colosseum-backup.log 2>&1
```

- [ ] **Step 3: 服务器部署**

（手动执行）
```bash
# 在服务器
sudo cp /opt/colosseum/ops/deploy/cron.d/colosseum-backup /etc/cron.d/colosseum-backup
sudo chmod 644 /etc/cron.d/colosseum-backup
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backup.sh ops/deploy/cron.d/colosseum-backup
git commit -m "feat(p4): pg_dump backup script + cron"
```

---

## Task 5: 部署手册（README）

**Files:**
- Create: `ops/deploy/README.md`

- [ ] **Step 1: 内容**

````markdown
# Colosseum 生产部署手册

服务器：云主机（建议 2C4G+，Docker + docker compose 插件）

## 前置
- [ ] 服务器已装 Docker CE ≥ 24 和 docker compose plugin
- [ ] SSH 密钥在 `ops/private/puke.pem`（不入库）
- [ ] `ops/private/deploy.env` 含：SSH_HOST / SSH_USER / REMOTE_PATH=/opt/colosseum 等

## 首次部署
```bash
# 本地
ssh -i ops/private/puke.pem <user>@<host> 'mkdir -p /opt/colosseum'
rsync -e "ssh -i ops/private/puke.pem" -az --delete \
  --exclude node_modules --exclude .next --exclude ops/private \
  ./ <user>@<host>:/opt/colosseum/

ssh -i ops/private/puke.pem <user>@<host>
cd /opt/colosseum/ops/deploy
cp .env.example .env && vi .env   # 填入 DB_PASSWORD / MATCH_TOKEN_SECRET
docker compose up -d --build
docker compose logs -f nextjs     # 等待 entrypoint 跑 migrate + 打出 listening
```

访问：`http://<ip>/` 应看到 lobby。

## 日常更新
```bash
# 本地 build 确保 tsc 过
npm run build

# rsync 到服务器
rsync -e "ssh -i ops/private/puke.pem" -az --delete ... <user>@<host>:/opt/colosseum/

# 服务器
cd /opt/colosseum/ops/deploy
docker compose build nextjs
docker compose up -d nextjs       # 只重启 app
docker compose logs -f nextjs
```

## 查看 / 故障排查
```bash
docker compose ps
docker compose logs <service>     # nextjs / postgres / redis / caddy
docker exec -it colosseum-postgres-1 psql -U arena arena
docker exec -it colosseum-redis-1 redis-cli
```

## 备份 / 恢复
- 每日 3:00 自动 `pg_dump → /var/backups/colosseum/arena-YYYY-MM-DD-HHMM.sql.gz`
- 恢复：
```bash
gunzip -c /var/backups/colosseum/arena-xxx.sql.gz | \
  docker exec -i colosseum-postgres-1 psql -U arena arena
```

## 回滚
```bash
# 切到上一个 git tag
git -C /opt/colosseum checkout <prev-tag>
cd /opt/colosseum/ops/deploy
docker compose up -d --build nextjs
```

## 安全
- [ ] DB_PASSWORD / MATCH_TOKEN_SECRET 必须强随机（≥ 32 字节）
- [ ] 云防火墙只开放 80/443（SSH 可选限 IP）
- [ ] 客户端 API key 存浏览器 IndexedDB，不经后端持久化；仅 match 运行期经 HTTPS 上传到内存 cache
````

- [ ] **Step 2: Commit**

```bash
git add ops/deploy/README.md
git commit -m "docs(p4): deployment README"
```

---

## Task 6: 生产烟测 checklist

**Files:**
- Create: `docs/demo/phase-4-m7-checklist.md`

- [ ] **Step 1: 内容**

```markdown
# Phase 4 M7 · 生产部署烟测

## 服务器冒烟
- [ ] `docker compose ps` 4 个服务都是 `Up` 且 healthy（若配了 healthcheck）
- [ ] `curl http://<ip>/api/_health` 200
- [ ] `curl http://<ip>/api/_metrics | jq` 有 counter

## 功能冒烟
- [ ] 打开 `http://<ip>/`：lobby 页面渲染
- [ ] 创建 1 个 profile（DeepSeek），1 个 poker agent（kind=player）
- [ ] （可选）6 bot poker match 跑完 ≥1 手
- [ ] 创建 werewolf match（默认 moderator），观察 narrator 显示

## 资源
- [ ] `docker stats` 内存 < 1.5G（nextjs）/ < 500M（postgres + redis）
- [ ] 持续 30 分钟空载，CPU < 5%

## 备份
- [ ] 手动执行 `/opt/colosseum/scripts/backup.sh`，确认输出 gz 文件
- [ ] 伪造 `arena-2020-01-01.sql.gz` 触发 14 天轮转删除

## 日志
- [ ] `docker compose logs nextjs | grep '"level":"info"'` 有结构化 JSON 行
```

- [ ] **Step 2: Commit**

```bash
git add docs/demo/phase-4-m7-checklist.md
git commit -m "docs(p4): M7 deployment smoke checklist"
```

---

## Task 7: 录屏 / 演示（Phase 闭环）

- [ ] **Step 1:** 录 3-5 分钟演示
  - 登录 / 创建 profile / agent
  - 创建 6-bot poker match → 看思考链 + 筹码曲线 + RankingPanel
  - 创建 werewolf match → 看 ModeratorPanel + 身份揭露
  - 打开 `/api/_metrics` / agent-card.json 展示

- [ ] **Step 2:** 截图存 `docs/demo/screenshots/m7/`；video 存项目外（太大）或放到 releases

- [ ] **Step 3: Commit**

```bash
git add docs/demo/screenshots/m7/
git commit -m "docs(p4): M7 demo screenshots"
```

---

## Done criteria (Phase 4 / M7)

- [ ] Docker 镜像本地能构建
- [ ] compose 栈能起四个容器
- [ ] 公网 IP:80 可访问 lobby
- [ ] poker + werewolf match 都能在生产跑通
- [ ] 备份脚本 cron 正常
- [ ] README 覆盖首次部署 / 更新 / 回滚 / 故障排查
- [ ] M7 checklist 全绿

完成后 Colosseum 达到 **面试可演示形态**。Phase 5 可选（Vercel fallback / 回放 UI / Polish）。
