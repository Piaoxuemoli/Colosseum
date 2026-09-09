// 本地真实 LLM 全链路验收驱动（R2-5 狼人杀 / R2-6 德扑 / R4-1 阿瓦隆）。
// 密钥不落本文件：从 .env 的 TEST_LLM_* 读取（.env 已被 gitignore）。
// 用法：node scripts/dev/local-llm-validation.mjs [--werewolf-only | --poker-only | --avalon-only]
import { existsSync, readFileSync } from 'node:fs'

function loadDotEnv(path = '.env') {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq < 1 || line.startsWith('#')) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && !(key in process.env)) process.env[key] = value
    out[key] = value
  }
  return out
}

loadDotEnv()
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const LLM_BASE_URL = process.env.TEST_LLM_BASE_URL
const LLM_API_KEY = process.env.TEST_LLM_API_KEY
const LLM_MODEL = process.env.TEST_LLM_MODEL || 'kimi-k3'

if (!LLM_BASE_URL || !LLM_API_KEY) {
  console.error('missing TEST_LLM_* in .env — see docs/dev/llm-api-config.example.md')
  process.exit(1)
}

const args = new Set(process.argv.slice(2))
const AVALON_ONLY = args.has('--avalon-only')
const RUN_WEREWOLF = !args.has('--poker-only') && !AVALON_ONLY
const RUN_POKER = !args.has('--werewolf-only') && !AVALON_ONLY
const RUN_AVALON = !args.has('--werewolf-only') && !args.has('--poker-only')
const RESUME_ID = process.argv.includes('--resume')
  ? process.argv[process.argv.indexOf('--resume') + 1]
  : null

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    throw new Error(`${init?.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  }
  return json
}

const PROFILE_NAME = '本地验收-kimi'
const MOD_NAME = '验收主持人'

const WW_PERSONAS = [
  ['验收狼-直率猎人', '你是直言不讳的村民，说话简短有力，靠直觉投票，讨厌绕弯子。'],
  ['验收狼-谨慎学者', '你是逻辑缜密的学者，发言喜欢列一二三条证据，谨慎投出每一票。'],
  ['验收狼-和气大姐', '你是热心的大姐，关注每个人发言的情绪变化，倾向于保护被冤枉的人。'],
  ['验收狼-冷静青年', '你是冷静的青年，少说多听，只在关键分歧时表明立场。'],
  ['验收狼-激进主播', '你是语速很快的主播，喜欢带节奏，敢于指认任何可疑的人。'],
  ['验收狼-谨慎医生', '你是细致的医生，习惯复盘昨晚死讯与发言矛盾点后再表态。'],
]
const PK_PERSONAS = [
  ['验收扑-紧凶', '你是紧凶风格牌手：起手牌要求高，入场后下注坚决，常用大注施压。'],
  ['验收扑-稳健', '你是稳健风格牌手：控制底池规模，没牌就弃，有牌拿价值。'],
  ['验收扑-松凶', '你是松凶风格牌手：广泛入池，频繁加注试探，喜欢偷池。'],
  ['验收扑-数学', '你是数学流牌手：一切决策看底池赔率与出牌数，从不情绪化。'],
  ['验收扑-跟注站', '你是偏跟注的休闲牌手：不爱弃牌，喜欢看到河牌。'],
  ['验收扑-平衡', '你是平衡风格牌手：随机化诈唬频率，注意位置优势。'],
]
// 阿瓦隆（R4-1）：讨论与投票博弈为主的语言对局——人设突出推理/伪装风格差异。
const AV_PERSONAS = [
  ['验收隆-直言', '你是直言不讳的玩家：发言简短，观点鲜明，投票跟随自己的判断，从不和稀泥。'],
  ['验收隆-缜密', '你是逻辑缜密的玩家：复盘每轮任务结果与投票记录，发言喜欢引用具体事实推理。'],
  ['验收隆-和事佬', '你是温和的玩家：倾向避免冲突，赞成大多数人都同意的队伍，发言打圆场。'],
  ['验收隆-激进', '你是激进的玩家：敢于直接指认可疑之人，主张小队伍精确打击，反对大队伍。'],
  ['验收隆-沉默', '你是少言的玩家：发言最短，只给结论不给理由，投票独立不看别人脸色。'],
  ['验收隆-演说家', '你是富有感染力的演说家：发言长而有条理，善于动员大家统一投票方向。'],
]
const MOD_PROMPT =
  '你是狼人杀主持人。用不超过 80 字的中文宣布每个阶段的进程与结果，语气沉稳中立，绝不泄露任何未公开的身份信息，不代任何玩家做决定。'

async function ensureProfile() {
  const { profiles } = await api('/api/profiles')
  const found = profiles.find((p) => p.displayName === PROFILE_NAME)
  if (found) return found
  const created = await api('/api/profiles', {
    method: 'POST',
    body: JSON.stringify({ displayName: PROFILE_NAME, baseUrl: LLM_BASE_URL, model: LLM_MODEL }),
  })
  console.log(`profile created: ${created.id} (${LLM_MODEL} @ ark)`)
  return created
}

async function ensureAgents(profileId) {
  const { agents } = await api('/api/agents')
  const byName = new Map(agents.map((a) => [a.displayName, a]))
  async function ensure(displayName, gameType, systemPrompt, kind) {
    const found = byName.get(displayName)
    if (found) return found
    const created = await api('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ displayName, gameType, kind, profileId, systemPrompt }),
    })
    console.log(`agent created: ${displayName}`)
    return created
  }
  const werewolf = []
  for (const [name, persona] of WW_PERSONAS) werewolf.push(await ensure(name, 'werewolf', persona, 'player'))
  const poker = []
  for (const [name, persona] of PK_PERSONAS) poker.push(await ensure(name, 'poker', persona, 'player'))
  const avalon = []
  for (const [name, persona] of AV_PERSONAS) avalon.push(await ensure(name, 'avalon', persona, 'player'))
  const moderator = await ensure(MOD_NAME, 'werewolf', MOD_PROMPT, 'moderator')
  return { werewolf, poker, avalon, moderator }
}

async function pollMatch(matchId, { label, timeoutMs, onTick }) {
  const start = Date.now()
  let lastCount = -1
  let consecutiveFailures = 0
  while (Date.now() - start < timeoutMs) {
    let detail
    try {
      detail = await api(`/api/matches/${matchId}`)
      consecutiveFailures = 0
    } catch (err) {
      consecutiveFailures++
      if (consecutiveFailures % 6 === 1) console.log(`[${label}] poll error (x${consecutiveFailures}): ${String(err).slice(0, 120)}`)
      if (consecutiveFailures > 60) throw err
      await new Promise((r) => setTimeout(r, 5_000))
      continue
    }
    const { match, eventCount } = detail
    if (eventCount !== lastCount) {
      console.log(`[${label}] t=${Math.round((Date.now() - start) / 1000)}s status=${match.status} events=${eventCount}`)
      lastCount = eventCount
    }
    if (match.status !== 'running') return detail
    if (onTick) await onTick(detail, Date.now() - start)
    // dev 模式下自驱动 tick 链在编译风暴时会断（fetch 失败被吞）；
    // 轮询的同时外部补发 tick，保证对局必然推进。
    try {
      await fetch(`${BASE}/api/matches/${matchId}/tick`, {
        method: 'POST',
        signal: AbortSignal.timeout(300_000),
      })
    } catch {
      /* 下一轮再补 */
    }
    await new Promise((r) => setTimeout(r, 3_000))
  }
  throw new Error(`[${label}] timeout after ${timeoutMs}ms`)
}

async function errorDigest(matchId) {
  const res = await api(`/api/matches/${matchId}/errors`)
  const groups = res.groups || res.errors || []
  const total = res.total ?? (Array.isArray(groups) ? groups.length : 0)
  const top = Array.isArray(groups) ? groups.slice(0, 5) : []
  return { total, top }
}

async function runWerewolf(setup) {
  console.log('\n===== R2-5 狼人杀真实 LLM 全链路 =====')
  const created = await api('/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      gameType: 'werewolf',
      agentIds: setup.werewolf.map((a) => a.id),
      moderatorAgentId: setup.moderator.id,
      engineConfig: { boardId: 'base-6' },
      config: { agentTimeoutMs: 120_000 },
      keyring: { [setup.profile.id]: LLM_API_KEY },
    }),
  })
  console.log(`match created: ${created.matchId}`)
  const detail = await pollMatch(created.matchId, { label: 'ww', timeoutMs: 30 * 60_000 })
  const digest = await errorDigest(created.matchId)
  console.log(`werewolf final status=${detail.match.status} events=${detail.eventCount} errors=${digest.total}`)
  return { matchId: created.matchId, detail, digest }
}

async function runPoker(setup) {
  console.log('\n===== R2-6 德扑真实 LLM 冒烟 =====')
  const created = await api('/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      gameType: 'poker',
      agentIds: setup.poker.map((a) => a.id),
      config: { agentTimeoutMs: 120_000 },
      keyring: { [setup.profile.id]: LLM_API_KEY },
    }),
  })
  console.log(`match created: ${created.matchId}`)
  let stopSent = false
  const detail = await pollMatch(created.matchId, {
    label: 'pk',
    timeoutMs: 20 * 60_000,
    onTick: async (_d, elapsed) => {
      // 打满 ~4 分钟（约 2-3 手）后请求「本手后结束」，控制 token 成本
      if (!stopSent && elapsed > 4 * 60_000) {
        await api(`/api/matches/${created.matchId}/end`, { method: 'POST' }).catch((e) =>
          console.log(`end request failed: ${e.message}`),
        )
        console.log('[pk] stop-after-hand requested')
        stopSent = true
      }
    },
  })
  const digest = await errorDigest(created.matchId)
  console.log(`poker final status=${detail.match.status} events=${detail.eventCount} errors=${digest.total}`)
  return { matchId: created.matchId, detail, digest }
}

// R4-1 阿瓦隆真实 LLM 全链路：基础 5 人板 + 基础 6 人板各一局（PRD 验收清单）。
async function runAvalon(setup, preset, label, agentCount) {
  console.log(`\n===== R4-1 阿瓦隆真实 LLM 全链路（${label}）=====`)
  const created = await api('/api/matches', {
    method: 'POST',
    body: JSON.stringify({
      gameType: 'avalon',
      agentIds: setup.avalon.slice(0, agentCount).map((a) => a.id),
      engineConfig: { preset },
      config: { agentTimeoutMs: 120_000 },
      keyring: { [setup.profile.id]: LLM_API_KEY },
    }),
  })
  console.log(`match created: ${created.matchId} (preset=${preset})`)
  const detail = await pollMatch(created.matchId, { label: `av-${preset}`, timeoutMs: 40 * 60_000 })
  const digest = await errorDigest(created.matchId)
  console.log(`avalon[${preset}] final status=${detail.match.status} events=${detail.eventCount} errors=${digest.total}`)
  return { matchId: created.matchId, detail, digest }
}

const profile = await ensureProfile()
const setup = await ensureAgents(profile.id)
setup.profile = profile
const results = {}
if (RESUME_ID) {
  // 续管已有对局（不新建，不烧额外 token）
  console.log(`\n===== 续管对局 ${RESUME_ID} =====`)
  const detail = await pollMatch(RESUME_ID, { label: 'resume', timeoutMs: 30 * 60_000 })
  const digest = await errorDigest(RESUME_ID)
  console.log(`resume final status=${detail.match.status} events=${detail.eventCount} errors=${digest.total}`)
  results.resumed = { matchId: RESUME_ID, detail, digest }
} else {
  if (RUN_WEREWOLF) results.werewolf = await runWerewolf(setup)
  if (RUN_POKER) results.poker = await runPoker(setup)
  if (RUN_AVALON) {
    results['avalon-basic-5'] = await runAvalon(setup, 'basic-5', '基础 5 人板', 5)
    results['avalon-basic-6'] = await runAvalon(setup, 'basic-6', '基础 6 人板', 6)
  }
}

console.log('\n===== 验收摘要 =====')
for (const [game, r] of Object.entries(results)) {
  const m = r.detail.match
  const winner = m.winnerFaction ?? '(见对局详情)'
  console.log(`${game}: status=${m.status} winner=${winner} events=${r.detail.eventCount} errors=${r.digest.total} matchId=${r.matchId}`)
  if (r.digest.top.length) console.log(`  top errors: ${JSON.stringify(r.digest.top).slice(0, 300)}`)
}
console.log('DONE')
