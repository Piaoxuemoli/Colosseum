# Colosseum 生产部署手册

目标服务器:`43.156.230.108` (腾讯云,Ubuntu/Debian,裸 IP,`:80` 暴露)

## 栈

- **nextjs** — Next.js standalone build + SQLite on `/data` 卷
- **redis** — 7-alpine,appendonly 持久化
- **caddy** — 2-alpine 反向代理 `:80 → nextjs:3000`,SSE 专用 flush_interval

> 当前阶段不跑 Postgres 容器 —— 生产用 SQLite,schema 与 dev 一致。Postgres 的升级等 `lib/db/schema.pg.ts` 落地后再切。

## 前置(服务器)

- [ ] Docker CE ≥ 24 + `docker compose` 插件已装
- [ ] 防火墙/安全组放开 `:80`(和 `:443` 如果以后上 HTTPS)
- [ ] 本地有 SSH 私钥 `ops/private/puke.pem` 和 `ops/private/deploy.env`

```
# ops/private/deploy.env(示例)
SSH_HOST=43.156.230.108
SSH_USER=root
SSH_PORT=22
SSH_KEY=ops/private/puke.pem
REMOTE_DIR=/opt/colosseum
```

## 首次部署

### 1. 同步代码到服务器

```bash
# 本机(Windows Git Bash / WSL / macOS / Linux 皆可)
ssh -i ops/private/puke.pem -o StrictHostKeyChecking=no root@43.156.230.108 'mkdir -p /opt/colosseum'

# 用 rsync 同步(排除本地临时 / 私有文件)
rsync -e "ssh -i ops/private/puke.pem -o StrictHostKeyChecking=no" -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .next-build \
  --exclude .git \
  --exclude old \
  --exclude tests/tmp-* \
  --exclude ops/private \
  --exclude .env \
  ./ root@43.156.230.108:/opt/colosseum/
```

*(没有 rsync 的话,可以 `git push` 之后在服务器上 `git clone` —— 见下方"Git 方式"。)*

### 2. 配置 `.env`

```bash
ssh -i ops/private/puke.pem root@43.156.230.108
cd /opt/colosseum/ops/deploy
cp .env.example .env
vi .env
# 至少填:
#   BASE_URL=http://43.156.230.108
#   MATCH_TOKEN_SECRET=$(openssl rand -base64 48)
#   SYSTEM_MODERATOR_BASE_URL / MODEL
```

### 3. 起栈

```bash
# 仍在服务器上 /opt/colosseum/ops/deploy
docker compose up -d --build
docker compose logs -f nextjs   # 等待 "drizzle-kit migrate" 和 "listening on 3000"
```

### 4. 验证

- 浏览器开 `http://43.156.230.108/` → 应看到 Lobby
- `curl http://43.156.230.108/api/health` → 200 JSON
- `docker compose ps` → 3 个容器全 `Up`

### 5. 上线 cron(备份)

```bash
sudo install -m 644 /opt/colosseum/ops/deploy/cron.d/colosseum-backup /etc/cron.d/colosseum-backup
sudo systemctl restart cron   # Ubuntu;RHEL 系是 crond
```

手动跑一次验证:

```bash
/opt/colosseum/scripts/backup.sh
ls /var/backups/colosseum
```

## Git 方式(rsync 的替代)

```bash
# 服务器
cd /opt && git clone https://github.com/Piaoxuemoli/Colosseum.git colosseum
cd /opt/colosseum/ops/deploy && cp .env.example .env && vi .env
docker compose up -d --build
```

日常更新:

```bash
ssh -i ops/private/puke.pem root@43.156.230.108 '
  cd /opt/colosseum && git pull --ff-only &&
  cd ops/deploy && docker compose build nextjs &&
  docker compose up -d nextjs &&
  docker compose logs --tail 50 nextjs
'
```

## 日常操作

```bash
docker compose ps                     # 容器状态
docker compose logs -f nextjs         # 实时日志
docker compose logs --tail 100 caddy  # Caddy 访问日志

# 进 SQLite
docker exec -it colosseum-nextjs-1 sqlite3 /data/arena.db

# 进 Redis
docker exec -it colosseum-redis-1 redis-cli

# 重启单个服务
docker compose restart nextjs
```

## 备份 / 恢复

- 自动:cron 每天 03:07 执行 `scripts/backup.sh` → `/var/backups/colosseum/arena-YYYY-MM-DD-HHMM.db.gz`,保留 14 天。
- 恢复:

```bash
# 停应用(防止并发写)
docker compose stop nextjs

# 解压并拷回卷
gunzip -c /var/backups/colosseum/arena-YYYY-MM-DD-HHMM.db.gz > /tmp/arena.db
docker cp /tmp/arena.db colosseum-nextjs-1:/data/arena.db

# 启应用
docker compose start nextjs
```

## 回滚

```bash
cd /opt/colosseum
git log --oneline -10       # 找目标 commit/tag
git checkout <sha-or-tag>
cd ops/deploy
docker compose up -d --build nextjs
```

## 故障排查

| 症状 | 先看哪里 |
|---|---|
| 访问 `:80` 超时 | `docker compose ps` + 云安全组 |
| Lobby 页空白 + SSR 500 | `docker compose logs nextjs` |
| SSE 事件不推送 | `docker compose logs caddy`,检查 Caddyfile 的 `@sse` 路径是否匹配 |
| 数据库迁移失败 | `docker compose logs nextjs | grep drizzle`,手动 `docker exec -it … sh` 进去看 `/data/arena.db` 权限 |
| OOM | 升级机型或在 compose 里加 `mem_limit` |

## 安全

- [ ] `MATCH_TOKEN_SECRET` ≥ 32 字节随机(`openssl rand -base64 48`)
- [ ] 云防火墙只开放 `:80` / `:443`(SSH 限 IP 更安全)
- [ ] LLM API key 仅在浏览器 localStorage + match 开始时经 HTTPS 上传,**服务端不落盘**
- [ ] 禁止把 `ops/private/`、`.env`、服务器 SSH key 提交到 Git
