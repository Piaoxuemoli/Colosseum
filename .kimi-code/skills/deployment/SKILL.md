---
name: colosseum-deployment
description: "Deploy, update, roll back, and operate Colosseum (Next.js AI Arena) on a cloud server via Docker Compose + SQLite + Caddy, or on Vercel as a fallback. USE FOR: deploy colosseum, update production, rollback, backup, restore, server maintenance, production smoke, docker compose deploy, caddy config. DO NOT USE FOR: local development setup (use ops/dev/README.md), code-level feature implementation, LLM provider configuration."
license: MIT
metadata:
  author: Colosseum Team
  version: "1.0.0"
---

# Colosseum 部署与运维 Skill

本 Skill 覆盖 Colosseum 的两条部署路径：

1. **主路径**：云服务器 + Docker Compose + SQLite + Redis + Caddy（推荐，当前生产环境）。
2. **备用路径**：Vercel + Supabase + Upstash（无自有服务器时的 fallback）。

本地开发环境见 `ops/dev/README.md`。

---

## 前置条件

### 云服务器主路径

- 一台可公网访问的 Linux 服务器（当前生产：`43.156.230.108`）。
- 服务器已安装 Docker CE ≥ 24 与 `docker compose` 插件。
- 本地持有 SSH 私钥（如 `ops/private/puke.pem`），**不得提交到 Git**。
- 服务器防火墙/安全组放行 `:80`（以及 `:443` 如果后续启用 HTTPS）。
- 一个强随机的 `MATCH_TOKEN_SECRET`（建议 `openssl rand -base64 48`）。

### Vercel Fallback

- Vercel 账号并连接 GitHub 仓库。
- Supabase Postgres 项目（取 pooler 连接串）。
- Upstash Redis 项目（取 REST URL / Token）。

---

## 主路径：云服务器 Docker Compose

### 1. 首次部署

1. **同步代码到服务器**

   ```bash
   ssh -i ops/private/puke.pem -o StrictHostKeyChecking=no root@<host> 'mkdir -p /opt/colosseum'

   rsync -e "ssh -i ops/private/puke.pem -o StrictHostKeyChecking=no" -az --delete \
     --exclude node_modules --exclude .next --exclude .next-build --exclude .git \
     --exclude old --exclude ops/private --exclude .env \
     ./ root@<host>:/opt/colosseum/
   ```

   > 无 rsync 时也可在服务器 `git clone` / `git pull`。

2. **配置生产环境变量**

   ```bash
   ssh -i ops/private/puke.pem root@<host>
   cd /opt/colosseum/ops/deploy
   cp .env.example .env
   # 编辑 .env，至少填写：
   #   BASE_URL=http://<host>
   #   MATCH_TOKEN_SECRET=<random-32-bytes>
   #   SYSTEM_MODERATOR_BASE_URL / SYSTEM_MODERATOR_MODEL
   ```

3. **启动栈**

   ```bash
   docker compose up -d --build
   docker compose logs -f nextjs   # 等待 migrate 完成并出现 listening
   ```

4. **验证**

   ```bash
   curl http://<host>/api/health   # 应返回 {"ok":true,"db":"ok","redis":"ok"}
   ```

5. **启用自动备份 cron**

   ```bash
   sudo install -m 644 /opt/colosseum/ops/deploy/cron.d/colosseum-backup /etc/cron.d/colosseum-backup
   sudo systemctl restart cron
   /opt/colosseum/scripts/backup.sh   # 手动跑一次确认
   ```

### 2. 日常更新

```bash
# 方式 A：rsync（推荐，本地改动未 push 时）
rsync ... ./ root@<host>:/opt/colosseum/

# 方式 B：服务器直接 git pull
ssh -i ops/private/puke.pem root@<host> '
  cd /opt/colosseum && git pull --ff-only &&
  cd ops/deploy && docker compose build nextjs &&
  docker compose up -d nextjs &&
  docker compose logs --tail 50 nextjs
'
```

### 3. 回滚

```bash
ssh -i ops/private/puke.pem root@<host>
cd /opt/colosseum
git log --oneline -10
git checkout <sha-or-tag>
cd ops/deploy
docker compose up -d --build nextjs
```

### 4. 备份与恢复

- **自动备份**：每日 03:07 执行 `scripts/backup.sh`，输出 `/var/backups/colosseum/arena-YYYY-MM-DD-HHMM.db.gz`，保留 14 天。
- **手动备份**：直接运行 `/opt/colosseum/scripts/backup.sh`。
- **恢复**：

  ```bash
  docker compose stop nextjs
  gunzip -c /var/backups/colosseum/arena-xxx.db.gz > /tmp/arena.db
  docker cp /tmp/arena.db colosseum-nextjs-1:/data/arena.db
  docker compose start nextjs
  ```

### 5. 常用运维命令

```bash
docker compose ps
docker compose logs -f nextjs
docker compose logs --tail 100 caddy
docker exec -it colosseum-nextjs-1 sqlite3 /data/arena.db
docker exec -it colosseum-redis-1 redis-cli
docker compose restart nextjs
```

### 6. 故障排查速查

| 症状 | 检查点 |
|---|---|
| `:80` 超时 | `docker compose ps` + 云安全组 |
| Lobby 空白/SSR 500 | `docker compose logs nextjs` |
| SSE 不推送 | `docker compose logs caddy` + Caddyfile `@sse` 路径 |
| 迁移失败 | `docker compose logs nextjs \| grep drizzle` + `/data/arena.db` 权限 |
| OOM | 升级机型或 compose 中加 `mem_limit` |

---

## 备用路径：Vercel Fallback

当主服务器不可用时使用。详细步骤见 `docs/deploy/vercel.md`，摘要如下：

1. `npx vercel link`
2. 在 Vercel Dashboard 按 `.env.vercel.example` 填入环境变量（`DATABASE_URL`、`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`、`MATCH_TOKEN_SECRET`、`BASE_URL`）。
3. `npx vercel --prod`
4. 迁移数据库：`DATABASE_URL='<supabase-pooler-url>' DB_DRIVER=pg npx drizzle-kit migrate`
5. 后续 `main` 分支 push 自动部署。

> 注意：Upstash REST 免费套餐无原生 pub/sub，SSE 会有约 800ms 轮询延迟。

---

## 开发环境

本地开发使用 Postgres + Redis 容器，Next.js 在本机运行：

```bash
npm run infra:up   # 启动 postgres + redis
npm run dev        # 启动 Next.js（另一个终端）
```

详见 `ops/dev/README.md` 与根目录 `docker-compose.yml`。

---

## 安全约束

1. **API Key 不落盘**：LLM API key 只存在于浏览器 localStorage 与 Redis match keyring（2h TTL）。
2. **敏感文件不入库**：`.env`、`ops/private/`、SSH key 必须加入 `.gitignore`。
3. **强随机密钥**：`MATCH_TOKEN_SECRET` 至少 32 字节随机。
4. **防火墙最小开放**：仅 `:80` / `:443`，SSH 建议限 IP。

---

## 相关文件

- 生产部署手册：`ops/deploy/README.md`
- Vercel fallback：`docs/deploy/vercel.md`
- 开发环境：`ops/dev/README.md`
- 生产 Compose：`ops/deploy/docker-compose.yml`
- 生产 Dockerfile：`ops/deploy/Dockerfile`
- Caddy 配置：`ops/deploy/Caddyfile`
- 备份脚本：`scripts/backup.sh`
