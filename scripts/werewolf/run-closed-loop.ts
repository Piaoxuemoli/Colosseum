/**
 * Werewolf（狼人杀）最小闭环测试 —— mock 驱动真实 agent 层跑完一整局。
 *
 * 设计见 docs/superpowers/specs/2026-06-16-werewolf-agent-closed-loop-design.md（D2/D3/D4）。
 *
 * 回路里保持【真实】的部分：werewolfEngine、WerewolfPlayerContextBuilder（prompt 生成）、
 * WerewolfResponseParser（XML 解析）、WerewolfBotStrategy（非法动作安全网）。
 * 【mock】的部分只有"调 LLM"这一步：mockLlmDecide 按阶段/角色产出合法 <action> XML。
 *
 * 无 Redis / 无 DB / 无 HTTP / 无 LLM / 无前端 —— 对齐 linting-and-quality.md：
 *   "引擎和 parser 优先单测" + "LLM 真调用不进自动测试，用 mock 测逻辑"。
 *
 * 用法：tsx scripts/werewolf/run-closed-loop.ts [局数]
 * 退出码：0 全绿，1 有失败。
 */
import { werewolfEngine } from '@/games/werewolf/engine/werewolf-engine'
import { WerewolfPlayerContextBuilder } from '@/games/werewolf/agent/context-builder'
import { WerewolfResponseParser } from '@/games/werewolf/agent/response-parser'
import { WerewolfBotStrategy } from '@/games/werewolf/agent/bot-strategy'
import type {
  WerewolfAction,
  WerewolfPhase,
  WerewolfRole,
  WerewolfState,
} from '@/games/werewolf/engine/types'
import type { MemoryContextSnapshot } from '@/platform/memory/contracts'

// ---- 固定配置 -----------------------------------------------------------
const AGENT_IDS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
const AGENT_NAMES: Record<string, string> = {
  a1: '爱丽丝',
  a2: '鲍勃',
  a3: '查理',
  a4: '黛安',
  a5: '伊万',
  a6: '菲奥娜',
}
const PERSONA = '你是一位擅长观察与逻辑推理的狼人杀玩家，发言克制、推断有据。'
const EMPTY_MEM: MemoryContextSnapshot = {
  workingSummary: '',
  episodicSection: '',
  semanticSection: '',
}
const MAX_TICKS = 1000 // 防 stall 兜底（40 天封顶 + 每天约 18 动作远小于此）

// mulberry32：确定性 [0,1) 伪随机，按种子可复现。
function mulberry32(seed: number): () => number {
  let a = Math.floor(seed * 1e9) >>> 0
  if (a === 0) a = 0x9e3779b9
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(arr: readonly T[], rng: () => number): T | undefined {
  return arr.length > 0 ? arr[Math.floor(rng() * arr.length)] : undefined
}

// ---- mock LLM：按阶段/角色产出合法 <action> XML --------------------------
function mockLlmDecide(state: WerewolfState, actor: string, rng: () => number): string {
  const role = state.roleAssignments[actor] ?? 'villager'
  const phase: WerewolfPhase = state.phase
  const alive = state.players.filter((p) => p.alive)
  const others = alive.filter((p) => p.agentId !== actor)
  let action: WerewolfAction

  switch (phase) {
    case 'night/werewolfDiscussion':
      action = { type: 'day/speak', content: '兄弟，今晚先盯那个爱跳身份的。' }
      break
    case 'night/werewolfKill': {
      const nonWolf = alive.filter((p) => state.roleAssignments[p.agentId] !== 'werewolf')
      const t = pick(nonWolf.length > 0 ? nonWolf : others, rng)
      action = {
        type: 'night/werewolfKill',
        targetId: t?.agentId ?? others[0]?.agentId ?? actor,
        reasoning: 'mock wolf kill',
      }
      break
    }
    case 'night/seerCheck': {
      const checked = new Set(state.seerCheckResults.map((r) => r.targetId))
      const unchecked = others.filter((p) => !checked.has(p.agentId))
      const t = pick(unchecked.length > 0 ? unchecked : others, rng)
      action = { type: 'night/seerCheck', targetId: t?.agentId ?? others[0]?.agentId ?? actor }
      break
    }
    case 'night/witchAction': {
      const killed = state.lastNightKilled
      const canSave =
        state.witchPotions.save && killed !== null && !(state.day === 0 && killed === actor)
      if (canSave) {
        action = { type: 'night/witchSave' }
        break
      }
      if (state.witchPotions.poison && rng() < 0.35) {
        const t = pick(others, rng)
        if (t) {
          action = { type: 'night/witchPoison', targetId: t.agentId }
          break
        }
      }
      action = { type: 'night/witchPoison', targetId: null }
      break
    }
    case 'day/speak': {
      // 论文策略先验：狼人偶尔伪装预言家（impersonate seer）
      const claimSeer = role === 'werewolf' && rng() < 0.4
      const claimedRole: WerewolfRole | undefined = claimSeer ? 'seer' : undefined
      action = {
        type: 'day/speak',
        content: claimSeer
          ? '我是预言家，昨晚验了某人，他是狼。'
          : '我先把昨晚的信息捋一捋，大家别急着归票。',
        claimedRole,
      }
      break
    }
    case 'day/vote': {
      if (role !== 'werewolf') {
        // mock 协调：模拟"预言家共享查验 → 好人集中归票已验出的狼"，
        // 使村民胜路径可达、终局分布非单边（仅 mock 策略，生产 agent 层不变）。
        const confirmedWolf = state.seerCheckResults
          .filter((r) => r.role === 'werewolf')
          .map((r) => r.targetId)
          .filter((id) => alive.some((p) => p.agentId === id))
        if (confirmedWolf.length > 0 && rng() < 0.85) {
          action = { type: 'day/vote', targetId: confirmedWolf[0], reason: 'seer-confirmed' }
          break
        }
      }
      if (rng() < 0.15) {
        action = { type: 'day/vote', targetId: null }
        break
      }
      const t = pick(others, rng)
      action = { type: 'day/vote', targetId: t?.agentId ?? null, reason: 'mock' }
      break
    }
    default:
      action = { type: 'day/speak', content: '' }
  }

  return [
    `<thinking>mock：${role} 在 ${phase} 阶段选择动作</thinking>`,
    `<action>${JSON.stringify(action)}</action>`,
  ].join('\n')
}

// ---- 单局闭环 -----------------------------------------------------------
interface LoopResult {
  seed: number
  winner: WerewolfState['winner']
  ticks: number
  fallbacks: number
  actorsSeen: number
  error?: string
}

function runClosedLoop(seed: number): LoopResult {
  const rng = mulberry32(seed)
  let state = werewolfEngine.createInitialState({ seed, agentNames: AGENT_NAMES }, AGENT_IDS)
  const ctx = new WerewolfPlayerContextBuilder()
  const parser = new WerewolfResponseParser()
  const bot = new WerewolfBotStrategy(rng)

  let ticks = 0
  let fallbacks = 0
  const actorsSeen = new Set<string>()

  while (!state.matchComplete && ticks < MAX_TICKS) {
    const actor = werewolfEngine.currentActor(state)
    // D5 不变量：非终局状态必须有非空 currentActor。null 即死角色阶段 bug。
    if (actor === null) {
      return {
        seed,
        winner: state.winner,
        ticks,
        fallbacks,
        actorsSeen: actorsSeen.size,
        error: `null actor at phase=${state.phase} day=${state.day} (非终局死锁)`,
      }
    }
    actorsSeen.add(actor)

    const valid = werewolfEngine.availableActions(state, actor)
    // 真实 prompt 生成（证明 context-builder 在回路里工作）
    const { systemMessage, userMessage } = ctx.build({
      agent: { id: actor, systemPrompt: PERSONA },
      gameState: state,
      validActions: valid,
      memoryContext: EMPTY_MEM,
    })
    if (!systemMessage || !userMessage) {
      return { seed, winner: state.winner, ticks, fallbacks, actorsSeen: actorsSeen.size, error: `空 prompt @ tick ${ticks}` }
    }

    // mock LLM → 真实解析
    const xml = mockLlmDecide(state, actor, rng)
    const parsed = parser.parse(xml, valid)
    let action = parsed.action as WerewolfAction

    let next
    try {
      next = werewolfEngine.applyAction(state, actor, action)
    } catch {
      // 解析动作非法 → bot 安全网回退（镜像生产）
      fallbacks++
      action = bot.decide(state, valid) as WerewolfAction
      next = werewolfEngine.applyAction(state, actor, action)
    }
    state = next.nextState
    ticks++
  }

  return {
    seed,
    winner: state.winner,
    ticks,
    fallbacks,
    actorsSeen: actorsSeen.size,
    error: ticks >= MAX_TICKS ? `达到 MAX_TICKS=${MAX_TICKS}（phase=${state.phase} day=${state.day}）` : undefined,
  }
}

// ---- 多局聚合 + 断言 -----------------------------------------------------
function main() {
  const argCount = Number(process.argv[2] ?? 14)
  const baseSeeds = [0.05, 0.12, 0.21, 0.34, 0.42, 0.5, 0.58, 0.63, 0.71, 0.8, 0.88, 0.95, 0.123, 0.777]
  const seeds = baseSeeds.slice(0, Math.max(1, Math.min(baseSeeds.length, Math.floor(argCount))))

  console.log(`Werewolf 闭环测试：${seeds.length} 局（mock LLM + 真实 agent 层）\n`)
  let fail = 0
  const dist: Record<string, number> = { villagers: 0, werewolves: 0, tie: 0 }

  for (const seed of seeds) {
    const r = runClosedLoop(seed)
    const ok = r.winner !== null && !r.error
    if (ok && r.winner) dist[r.winner] = (dist[r.winner] ?? 0) + 1
    if (!ok) fail++
    const tag = ok ? '✓' : '❌'
    console.log(
      `${tag} seed=${seed} winner=${r.winner ?? '—'} ticks=${r.ticks} fallbacks=${r.fallbacks} actors=${r.actorsSeen}${r.error ? '  ' + r.error : ''}`,
    )
  }

  const decided = dist.villagers + dist.werewolves + dist.tie
  console.log(`\n终局分布：${JSON.stringify(dist)}（共 ${decided} 局）`)
  if (decided > 0 && (dist.villagers === decided || dist.werewolves === decided)) {
    console.log('warn: 终局单边分布（策略失衡提示，非硬失败）')
  }

  if (fail > 0) {
    console.error(`\n${fail}/${seeds.length} 局闭环失败`)
    process.exit(1)
  }
  console.log(`\n所有 ${seeds.length} 局闭环通过 ✓`)
}

main()
