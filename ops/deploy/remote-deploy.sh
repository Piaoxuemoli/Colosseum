#!/bin/sh
# Colosseum 远程部署脚本（在服务器上执行，由 scripts/deploy/release.mjs 或 CI 经
# `ssh 'bash -s' < remote-deploy.sh` 调起；也可手动在服务器上跑）。
#
# 用法（环境变量传入）:
#   RELEASE_FILE=<colosseum-<sha>.tar.gz>   /opt/colosseum-releases 下的发布包名
#   RELEASE_SHA=<sha>                       发布 commit（记录用）
#   MODE=deploy|rollback                    默认 deploy
#
# 流程（deploy）:
#   1. DB 预备份（容器内 sqlite .backup，失败继续但有告警）
#   2. 保留上一版目录 /opt/colosseum.prev（回滚用）
#   3. 解包新版本到 /opt/colosseum（tar 覆盖；服务器 .env 不在包内、不受影响）
#   4. docker compose build nextjs → up -d（entrypoint 自动 drizzle migrate）
#   5. 健康门禁：最多 180s 轮询 /api/health；失败自动回滚到 .prev 并重建
#   6. 输出摘要
set -eu

APP_DIR="${APP_DIR:-/opt/colosseum}"
APP_PREV="${APP_PREV:-/opt/colosseum.prev}"
RELEASE_DIR="${RELEASE_DIR:-/opt/colosseum-releases}"
RELEASE_FILE="${RELEASE_FILE:-}"
RELEASE_SHA="${RELEASE_SHA:-unknown}"
MODE="${MODE:-deploy}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/api/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

log() { echo "[remote-deploy $(date +%H:%M:%S)] $*"; }

backup_db() {
  # 与 scripts/backup.sh 同源逻辑：借运行中容器做 sqlite .backup，避免拷贝热库
  local stamp
  stamp="$(date +%Y-%m-%d-%H%M)"
  if docker ps --format '{{.Names}}' | grep -q colosseum-nextjs; then
    if docker exec colosseum-nextjs-1 sqlite3 /data/arena.db ".backup '/tmp/pre-deploy.db'"; then
      mkdir -p /var/backups/colosseum
      docker cp colosseum-nextjs-1:/tmp/pre-deploy.db "/var/backups/colosseum/pre-deploy-${stamp}.db" \
        && gzip -f "/var/backups/colosseum/pre-deploy-${stamp}.db" \
        && log "DB 预备份完成: pre-deploy-${stamp}.db.gz" \
        || log "警告: DB 预备份拷出失败（继续部署，注意风险）"
      docker exec colosseum-nextjs-1 rm -f /tmp/pre-deploy.db || true
    else
      log "警告: 容器内 sqlite .backup 失败（继续部署；首启或库为空时属正常）"
    fi
  else
    log "无运行中 nextjs 容器，跳过 DB 预备份（首次部署）"
  fi
}

wait_health() {
  local waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if curl -sf --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      log "健康检查通过 (${waited}s)"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  log "健康检查超时（${HEALTH_TIMEOUT}s）: $HEALTH_URL"
  return 1
}

do_rollback() {
  log "=== 回滚到上一版本 ==="
  if [ ! -d "$APP_PREV" ]; then
    log "错误: $APP_PREV 不存在，无法自动回滚；请按 ops/deploy/README.md 手动处理"
    exit 1
  fi
  rm -rf "$APP_DIR"
  cp -a "$APP_PREV" "$APP_DIR"
  cd "$APP_DIR/ops/deploy"
  docker compose build nextjs >/dev/null 2>&1 || { log "回滚镜像重建失败"; exit 1; }
  docker compose up -d nextjs
  wait_health || { log "回滚后健康检查仍失败，需要人工介入（docker compose logs nextjs）"; exit 1; }
  log "已回滚到上一版本并恢复健康"
}

# ---------------------------------------------------------------- 主流程
if [ "$MODE" = "rollback" ]; then
  do_rollback
  exit 0
fi

if [ -z "$RELEASE_FILE" ] || [ ! -f "$RELEASE_DIR/$RELEASE_FILE" ]; then
  echo "错误: 发布包不存在 $RELEASE_DIR/$RELEASE_FILE" >&2
  exit 1
fi

log "=== 部署 $RELEASE_SHA ($RELEASE_FILE) ==="
backup_db

# 保留上一版（保留且仅一份）
rm -rf "$APP_PREV"
if [ -d "$APP_DIR" ]; then
  cp -a "$APP_DIR" "$APP_PREV"
  log "上一版本已留存于 $APP_PREV"
fi

# 解包（tar 直接覆盖源码树；.env / 数据卷均不在树内）
mkdir -p "$APP_DIR"
tar -xzf "$RELEASE_DIR/$RELEASE_FILE" -C "$APP_DIR"
echo "RELEASE_SHA=$RELEASE_SHA" > "$APP_DIR/RELEASE"
log "源码就位: $(grep -c . "$APP_DIR/RELEASE" >/dev/null && echo ok)"

cd "$APP_DIR/ops/deploy"
log "构建镜像（首次或依赖变更时需要数分钟）..."
docker compose build nextjs 2>&1 | tail -3
log "启动容器（entrypoint 将自动执行 drizzle migrate）..."
docker compose up -d nextjs
docker compose ps nextjs | tail -1

if wait_health; then
  log "=== 部署成功 ==="
  log "版本: $RELEASE_SHA"
  docker exec colosseum-nextjs-1 sqlite3 /data/arena.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" 2>/dev/null | tr '\n' ' ' || true
  echo
  log "发布包留存: $RELEASE_DIR/$RELEASE_FILE（回滚: MODE=rollback 或 git checkout 上一 tag）"
else
  log "=== 部署失败，自动回滚 ==="
  docker compose logs --tail 30 nextjs || true
  do_rollback
  exit 1
fi
