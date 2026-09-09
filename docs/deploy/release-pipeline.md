# Colosseum 发版链路与 CI/CD 规划

- 日期：2026-09-09　状态：已实施（本地一键发版 + 手动 CD 双通道）
- 相关文件：`scripts/deploy/release.mjs`（本地驱动）、`ops/deploy/remote-deploy.sh`（服务器侧）、`.github/workflows/{ci,deploy}.yml`、`ops/deploy/README.md`（服务器日常操作手册）

## 1. 服务器信息卡（唯一权威）

| 项 | 值 |
|---|---|
| 主机 | 腾讯云 CVM `43.156.230.108`（Ubuntu，root@，:22） |
| 入口 | `http://43.156.230.108/`（裸 IP HTTP；域名过审后启用 Caddyfile 域名块自动 TLS） |
| 应用目录 | `/opt/colosseum`（源码树；上一版留存 `/opt/colosseum.prev`；发布包留存 `/opt/colosseum-releases/`） |
| 栈 | docker compose：`colosseum:prod`(Next standalone) + `redis:7` + `caddy:2`；SQLite 挂 `/data` 卷（arena.db） |
| 迁移 | 容器 entrypoint 每次启动自动 `drizzle-kit migrate`（迁移文件随镜像打包） |
| 备份 | cron `03:07` `scripts/backup.sh` → `/var/backups/colosseum/`，14 天滚动；发版前另有 pre-deploy 备份 |
| SSH 私钥 | 本地 `ops/private/deploy.pem`（不存在时回落 `~/Downloads/hermesqoobee.pem`；可 `DEPLOY_KEY` 覆盖） |

## 2. 发版链路（两条等价通道）

### 通道 A：本地一键（日常首选）

```
npm run release                # 门禁 → 打包(git archive) → scp → 远程部署 → 本地复验
npm run release -- --skip-check  # 跳过本地门禁（CI 已绿时）
npm run release -- --rollback   # 回滚上一版本
npm run release -- --dry-run    # 只预检+打包
```

流程与保障：
1. **预检**：工作树干净 + main + 与 origin 一致（强制：发的东西必须已推送）
2. **门禁**：`npm run check` 全绿（surfaces/lint/typecheck/test/build）
3. **打包**：`git archive HEAD` → `colosseum-<sha8>.tar.gz`（天然排除 .env/密钥/临时文件）
4. **远程部署**（remote-deploy.sh）：DB 预备份 → 留存上一版 → 解包 → `docker compose build && up`（entrypoint 自动迁移）→ **180s 健康门禁，失败自动回滚上一版并重建**
5. **本地复验**：`curl /api/health`
6. Windows 适配：不依赖 rsync；pem 运行时复制到 `tmp/deploy-key.pem` 并 `icacls` 收权（用后即删）

### 通道 B：GitHub Actions 手动 CD（异地/移动端发版）

`.github/workflows/deploy.yml`：`workflow_dispatch`（输入 `confirm=yes` 防误触）→ 校验该 commit 的 CI check-runs 全绿 → 打包 → SSH/SCP 部署 → 线上 smoke。
**一次性配置**：仓库 Settings → Secrets and variables → Actions 添加：
- `DEPLOY_SSH_HOST` = `43.156.230.108`
- `DEPLOY_SSH_USER` = `root`
- `DEPLOY_SSH_KEY` = pem 私钥全文（建议单独签发只读部署密钥，勿复用主 key）

未配 secrets 时 workflow 直接给出指引退出，不会盲跑。

## 3. CI 规划（现状 + 演进）

### 现状（已实施）

| 环节 | 触发 | 内容 | 作用 |
|---|---|---|---|
| **ci.yml** | push main / 所有 PR | lint ∥ typecheck ∥ test+surfaces ∥ build（Node 22，npm 缓存，并发取消） | 合入门禁；PR 必绿 |
| **deploy.yml** | 手动 dispatch | CI 绿校验 → 打包 → SSH 部署 → smoke | 生产发版唯一远程通道 |

原则（私有单人仓库阶段）：
- **不自动部署**：push 到 main 只过 CI；发版是显式决定（手动命令 / 手动 dispatch）
- **发版前置 = CI 绿**：deploy.yml 会等 check-runs 全绿才动服务器
- **发布即留痕**：包留存服务器、版本号（sha8）写入 `/opt/colosseum/RELEASE`、GitHub Actions 历史即发版审计

### 演进路线（按需启用，不提前）

1. **tag 触发 CD**：`v*` tag → 自动走 deploy.yml（发版从「手动 dispatch」升级为「打 tag 即发」），仍要求 CI 绿
2. **environment 保护**：GitHub Environments 加 `production`（可配审批人），私有单人阶段先不开
3. **域名 + HTTPS**：域名过审后启用 `ops/deploy/Caddyfile` 域名块（自动签 TLS），HEALTH_URL 与 BASE_URL 随之切换
4. **镜像 registry 化**：若构建时长成为瓶颈，改为 GH Actions 构建镜像推 GHCR、服务器只 pull（需要服务器 docker login token）
5. **OD-3 公开化后**：公开仓库 + 分支保护（require CI）+ environment 审批，链路不变只加闸门

## 4. 部署后运维清单（每次发版后过一遍）

- [ ] `/api/health` 200（脚本已自动验证）
- [ ] 新迁移生效：`docker exec colosseum-nextjs-1 sqlite3 /data/arena.db ".tables"`（部署日志也会打印表清单）
- [ ] 遗留 RUNNING 旧局清理：`GET /api/matches` 找 running 的旧格式对局 → 逐个 `POST /api/matches/:id/force-end`
- [ ] 备份抽查：`ls -lt /var/backups/colosseum | head`（当天应有 cron 备份或 pre-deploy 备份）
- [ ] 观战/回放/统计页抽查一条真实对局

## 5. 回滚

- 自动：健康门禁失败时 remote-deploy.sh 自动恢复 `/opt/colosseum.prev` 并重建
- 手动：`npm run release:rollback`（远程恢复上一版）或按 README 的 git checkout 方式指到任意历史 tag
- 数据：迁移向前兼容原则（只加不改删列），回滚镜像一般无需回滚 schema；极端情况用 `/var/backups/colosseum` 恢复（先 `docker compose stop nextjs`）
