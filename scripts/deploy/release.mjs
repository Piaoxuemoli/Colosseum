// 一键发版：本地门禁预检 → git archive 打包 → scp 上传 → 远程部署（含自动回滚）。
// Windows 友好：不依赖 rsync；SSH 私钥运行时复制到 tmp/ 并用 icacls 收紧 ACL（用后即删）。
//
// 用法:
//   npm run release                    # 跑完整门禁后发版 main@HEAD
//   npm run release -- --skip-check    # 跳过本地门禁（相信 CI 已绿时用）
//   npm run release -- --rollback      # 远程回滚到上一版本
//   npm run release -- --dry-run       # 只做预检与打包，不碰服务器
//
// 配置优先级: ops/private/deploy.env > 环境变量 > 内置默认（43.156.230.108）。
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, copyFileSync, chmodSync, statSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run')
const ROLLBACK = args.has('--rollback')
const SKIP_CHECK = args.has('--skip-check')

// ── 配置 ────────────────────────────────────────────────────────────────
function loadDeployEnv() {
  const out = {}
  for (const p of ['ops/private/deploy.env']) {
    const f = resolve(ROOT, p)
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq < 1 || line.trim().startsWith('#')) continue
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
  }
  return out
}
const deployEnv = loadDeployEnv()
const SSH_HOST = process.env.SSH_HOST || deployEnv.SSH_HOST || '43.156.230.108'
const SSH_USER = process.env.SSH_USER || deployEnv.SSH_USER || 'root'
const SSH_PORT = process.env.SSH_PORT || deployEnv.SSH_PORT || '22'
const REMOTE_DIR = process.env.REMOTE_DIR || deployEnv.REMOTE_DIR || '/opt/colosseum'
const RELEASE_DIR = '/opt/colosseum-releases'
const HEALTH_URL = `http://${SSH_HOST}/api/health`

const KEY_CANDIDATES = [
  process.env.DEPLOY_KEY,
  deployEnv.SSH_KEY,
  resolve(ROOT, 'ops/private/deploy.pem'),
  'C:/Users/Qoobeewang/Downloads/hermesqoobee.pem',
].filter(Boolean)
const KEY_SRC = KEY_CANDIDATES.find((p) => existsSync(p))

// ── 小工具 ──────────────────────────────────────────────────────────────
const log = (m) => console.log(`[release] ${m}`)
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })

// ── SSH 私钥的 Windows ACL 处理 ─────────────────────────────────────────
const KEY_TMP = resolve(ROOT, 'tmp/deploy-key.pem')
function prepareKey() {
  if (!KEY_SRC) {
    console.error(`[release] 找不到 SSH 私钥（尝试过: ${KEY_CANDIDATES.join(', ')}）`)
    console.error('        放到 ops/private/deploy.pem，或设 DEPLOY_KEY 环境变量')
    process.exit(1)
  }
  copyFileSync(KEY_SRC, KEY_TMP)
  if (process.platform === 'win32') {
    // OpenSSH for Windows 要求私钥仅当前用户可读，否则拒绝使用
    execSync(`icacls "${KEY_TMP}" /inheritance:r /grant:r "${process.env.USERNAME}:R"`, { stdio: 'pipe' })
  } else {
    chmodSync(KEY_TMP, 0o600)
  }
}
function cleanupKey() {
  if (existsSync(KEY_TMP)) rmSync(KEY_TMP)
}

function ssh(cmd, input) {
  const r = spawnSync(
    'ssh',
    [
      '-i', KEY_TMP,
      '-p', SSH_PORT,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=15',
      `${SSH_USER}@${SSH_HOST}`,
      cmd,
    ],
    { cwd: ROOT, stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit', input: input ?? undefined },
  )
  if (r.status !== 0) {
    cleanupKey()
    console.error(`[release] ssh 命令失败（exit ${r.status}）`)
    process.exit(r.status ?? 1)
  }
}

// ── 预检 ────────────────────────────────────────────────────────────────
function precheck() {
  const dirty = execSync('git status --porcelain', { cwd: ROOT }).toString().trim()
  if (dirty) {
    console.error('[release] 工作树不干净，先提交或暂存：\n' + dirty)
    process.exit(1)
  }
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim()
  if (branch !== 'main') {
    console.error(`[release] 只允许在 main 上发版（当前 ${branch}）`)
    process.exit(1)
  }
  execSync('git fetch origin main', { cwd: ROOT, stdio: 'pipe' })
  const local = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
  const remote = execSync('git rev-parse origin/main', { cwd: ROOT }).toString().trim()
  if (local !== remote) {
    console.error('[release] 本地 main 与 origin/main 不一致（先 push/pull）')
    process.exit(1)
  }
  return local
}

function runGates() {
  log('运行本地门禁 npm run check（约 2-4 分钟；--skip-check 可跳过）...')
  run('npm run check')
}

// ── 打包 ────────────────────────────────────────────────────────────────
function pack(sha) {
  const short = sha.slice(0, 8)
  const file = resolve(ROOT, `tmp/colosseum-${short}.tar.gz`)
  execSync(`git archive --format=tar.gz -o "${file}" HEAD`, { cwd: ROOT, stdio: 'pipe' })
  const size = (statSync(file).size / 1024 / 1024).toFixed(1)
  log(`发布包就绪: ${basename(file)} (${size} MB)`)
  return { file, name: basename(file), short }
}

// ── 主流程 ──────────────────────────────────────────────────────────────
const sha = precheck()
if (!ROLLBACK && !SKIP_CHECK) runGates()

if (ROLLBACK) {
  prepareKey()
  try {
    log(`连接 ${SSH_USER}@${SSH_HOST} 执行回滚...`)
    ssh(`MODE=rollback APP_DIR=${REMOTE_DIR} bash -s`, readFileSync(resolve(ROOT, 'ops/deploy/remote-deploy.sh')))
    log('回滚流程结束')
  } finally {
    cleanupKey()
  }
  process.exit(0)
}

const { file, name, short } = pack(sha)
if (DRY) {
  log('--dry-run：预检与打包完成，未触碰服务器')
  process.exit(0)
}

prepareKey()
try {
  log(`连接 ${SSH_USER}@${SSH_HOST}:${SSH_PORT} ...`)
  ssh(`mkdir -p ${RELEASE_DIR}`)

  log(`上传 ${name} ...`)
  const r = spawnSync(
    'scp',
    ['-i', KEY_TMP, '-P', SSH_PORT, '-o', 'StrictHostKeyChecking=no', file, `${SSH_USER}@${SSH_HOST}:${RELEASE_DIR}/${name}`],
    { cwd: ROOT, stdio: 'inherit' },
  )
  if (r.status !== 0) throw new Error(`scp 失败（exit ${r.status}）`)

  log('触发远程部署（构建镜像 + 迁移 + 健康门禁 + 失败自动回滚）...')
  ssh(
    `RELEASE_FILE=${name} RELEASE_SHA=${short} APP_DIR=${REMOTE_DIR} bash -s`,
    readFileSync(resolve(ROOT, 'ops/deploy/remote-deploy.sh')),
  )

  log('从本地复验线上健康...')
  execSync(`curl -sf --max-time 15 ${HEALTH_URL}`, { stdio: 'inherit' })
  console.log(`\n[release] ✅ 发版完成: ${short} → http://${SSH_HOST}/ （健康正常）`)
} finally {
  cleanupKey()
}
