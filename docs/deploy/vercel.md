# Vercel Fallback 部署

Colosseum 的主路径是 Docker Compose + 云服务器（见 Phase 4）。本文只记录**兜底部署**：当主服务器不可用时，一条命令把同一份代码跑到 Vercel + Supabase + Upstash。

## 前置

- **Supabase**（免费）：建一个 Postgres 项目，从 **Project Settings → Database → Connection Pooling** 复制 pooler 连接串（端口 6543，带 `pgbouncer=true`），用于 serverless 场景。
- **Upstash Redis**（免费）：Create Redis Database，在 **REST API** 面板取 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`。
- **Vercel** 账号并连接 GitHub 仓库。

## 首次部署

1. 本地关联项目：

   ```bash
   npx vercel link
   ```

2. 在 **Vercel Dashboard → Project → Settings → Environment Variables** 中，按照 `.env.vercel.example` 的列把变量全部填入（Production 环境至少填全 `DATABASE_URL`、`UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`、`MATCH_TOKEN_SECRET`、`BASE_URL`）。

3. 触发首次部署：

   ```bash
   npx vercel --prod
   ```

4. 首次部署后，在本地（或任何能访问 Supabase 的机器上）迁移数据库：

   ```bash
   DATABASE_URL='<supabase-pooler-url>' DB_DRIVER=pg npx drizzle-kit migrate
   ```

5. 写入默认 moderator seed（Phase 4 Task 增设的 `db/seeds/default-moderator.ts` 完成后再跑）：

   ```bash
   DATABASE_URL='<supabase-pooler-url>' DB_DRIVER=pg npm run db:seed
   ```

## 日常更新

push 到 `main` 分支，Vercel 会自动构建 + 部署。

## 与主路径的差异

- **Pub/Sub 退化为 list-polling**：Upstash REST 免费套餐没有原生 pub/sub，`RedisLike.subscribe` 退化为 LPUSH + RPOP 轮询（~800ms 延迟）。观战页会感到延迟但不会丢事件。
- **单函数 maxDuration 60s**：`vercel.json` 已设置；足够一回合 LLM 思考，但不要长跑的后台任务。
- **多实例无共享内存**：
  - match-token 走 HMAC（Phase 2-2），天然 stateless。
  - API key 缓存目前仍是 in-process，Vercel 冷启动或多实例时会 cache miss；客户端 keyring 上传端点幂等，重新 upload 即可（见 Phase 1B-5）。
- **`UPSTASH_REDIS_REST_URL` 的感知**：`lib/redis/adapter.ts` 只在 env 有该变量时才加载 Upstash SDK；否则走 ioredis（即本地 / Docker）。

## 回切

Vercel 只用作 fallback，日常仍以云服务器为准。如果回切主路径，域名 DNS 指回服务器即可；Vercel 的部署可以保留不删。
