// 主持人旁白编排（src/backend/match/narration.ts，FR-4.7-01 / R3-3）：
// 总闸（关闭 = 完全不打 LLM）、触发缺失直通、主持人 / Profile / key 缺失
// 优雅跳过、LLM 失败静默、成功路径的事件构造（kind/受众/seq/payload）与
// 用量记录（purpose=moderator-narration，mock 模式不计数）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  return {
    moderatorAgent: {
      id: 'agt_mod',
      displayName: '系统主持人',
      gameType: 'werewolf',
      kind: 'moderator',
      profileId: 'prof_1',
      systemPrompt: '你是狼人杀的主持人。',
    },
    fallbackModerators: [] as Array<Record<string, unknown>>,
    profile: {
      id: 'prof_1',
      displayName: 'Test Profile',
      providerId: 'provider-x',
      baseUrl: 'https://llm.test/v1',
      model: 'test-model',
    },
    apiKey: 'sk-test' as string | undefined,
    narrationText: '晨光落下，三号位的座位空了。',
    llmFails: false,
    calls: { runNarration: 0, recordLlmUsage: [] as Array<Record<string, unknown>> },
  }
})

vi.mock('@/backend/agent/llm-runtime', () => ({
  runNarration: vi.fn(async () => {
    h.calls.runNarration += 1
    if (h.llmFails) throw new Error('LLM api_error')
    return {
      text: h.narrationText,
      rawResponse: h.narrationText,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    }
  }),
}))

vi.mock('@/backend/agent/usage-capture', () => ({
  recordLlmUsage: vi.fn(async (input: Record<string, unknown>) => {
    h.calls.recordLlmUsage.push(input)
  }),
  extractUsage: (usage: unknown) => usage,
  NULL_USAGE: { promptTokens: null, completionTokens: null, totalTokens: null },
}))

vi.mock('@/backend/agent/key-cache', () => ({
  getApiKey: vi.fn(async () => h.apiKey),
}))

vi.mock('@/platform/db/queries/agents', () => ({
  findAgentById: vi.fn(async () => h.moderatorAgent),
  listAgents: vi.fn(async () => h.fallbackModerators),
}))

vi.mock('@/platform/db/queries/profiles', () => ({
  findProfileById: vi.fn(async () => h.profile),
}))

import {
  buildNarrationPrompt,
  generateModeratorNarration,
  NARRATION_ENGINE_KIND,
  narrationTriggerFor,
} from '@/backend/match/narration'
import type { WerewolfEngineState } from '@/games/werewolf/engine2'
import { toV2Event } from '../../games/werewolf/integration/_helpers'
import {
  SEATING_6,
  killVote,
  seerCheck,
  start6,
  step,
  witchPoisonPass,
  witchSavePass,
  type Acc,
} from '../../games/werewolf/engine2/_helpers'

/** 天亮公告批（夜 1 刀 p3 → deathsAnnounced）：标准触发素材。 */
function announceFixture(): { state: WerewolfEngineState; batch: ReturnType<typeof toV2Event>[] } {
  const acc: Acc = start6(SEATING_6)
  killVote(acc, 'p3')
  witchSavePass(acc)
  witchPoisonPass(acc)
  const seer = acc.state.players.find((p) => p.alive && p.role === 'seer')
  if (!seer) throw new Error('no seer')
  const batch = step(acc, { type: 'seerCheck', actorId: seer.playerId, targetId: 'p1' })
  return { state: acc.state, batch: batch.map(toV2Event) }
}

const RESERVED_SEQ = 9_001

function callGenerate(overrides?: Partial<Parameters<typeof generateModeratorNarration>[0]>) {
  const { state, batch } = announceFixture()
  return generateModeratorNarration({
    matchId: 'm_narr',
    gameType: 'werewolf',
    matchConfig: { moderatorAgentId: 'agt_mod' },
    state,
    batchEvents: batch,
    publicContext: [],
    summary: { handNumber: 0, day: 1, phase: 'day.announce' },
    reserveEventSeq: (s) => ({ state: { ...(s as object), nextSeq: RESERVED_SEQ + 1 }, seq: RESERVED_SEQ }),
    ...overrides,
  })
}

beforeEach(() => {
  h.llmFails = false
  h.apiKey = 'sk-test'
  h.fallbackModerators = []
  h.calls.runNarration = 0
  h.calls.recordLlmUsage = []
})

afterEach(() => {
  delete process.env.M4_MOCK_LLM
})

describe('buildNarrationPrompt（纯函数）', () => {
  it('拼装人设 + 不虚构/不剧透铁律 + 公开 digest', () => {
    const prompt = buildNarrationPrompt({
      gameType: 'werewolf',
      moderatorSystemPrompt: '你是狼人杀的主持人。',
      trigger: { focusKinds: ['deathsAnnounced'], publicDigest: ['第 1 天天亮公告：昨夜 3 号位出局'] },
    })
    expect(prompt.systemMessage).toContain('你是狼人杀的主持人。')
    expect(prompt.systemMessage).toContain('不超过 80 字')
    expect(prompt.systemMessage).toContain('不剧透任何未公开信息')
    expect(prompt.userMessage).toContain('- 第 1 天天亮公告：昨夜 3 号位出局')
    expect(prompt.userMessage).toContain('deathsAnnounced')
  })
})

describe('narrationTriggerFor（gameType 装配）', () => {
  it('werewolf 有触发器；poker 无（牌桌类零成本直通）', () => {
    expect(narrationTriggerFor('werewolf')).toBeTypeOf('function')
    expect(narrationTriggerFor('poker')).toBeNull()
  })
})

describe('generateModeratorNarration — 门与前置条件', () => {
  it('narrationEnabled=false → 不发起任何 LLM 调用', async () => {
    const out = await callGenerate({ matchConfig: { narrationEnabled: false, moderatorAgentId: 'agt_mod' } })
    expect(out).toBeNull()
    expect(h.calls.runNarration).toBe(0)
  })

  it('gameType=poker → 直通（无触发器）', async () => {
    const out = await callGenerate({ gameType: 'poker' })
    expect(out).toBeNull()
    expect(h.calls.runNarration).toBe(0)
  })

  it('非关键批（仅公开遗言，public 受众但非宣告类）→ 不触发', async () => {
    const acc: Acc = start6(SEATING_6)
    killVote(acc, 'p3')
    witchSavePass(acc)
    witchPoisonPass(acc)
    seerCheck(acc, 'p1')
    // 天亮公告后 pendingActor = 夜死者 p3 的遗言槽（public 事件，非触发点）。
    const actor = acc.state.pendingActor
    if (!actor) throw new Error('no pending actor')
    const batch = step(acc, { type: 'lastWords', actorId: actor, content: '我是真预言家' })
    expect(batch.some((event) => event.kind === 'deathsAnnounced')).toBe(false)
    const out = await callGenerate({
      state: acc.state,
      batchEvents: batch.map(toV2Event),
      summary: { handNumber: 0, day: 1, phase: 'day.lastWords' },
    })
    expect(out).toBeNull()
    expect(h.calls.runNarration).toBe(0)
  })

  it('主持人缺失 → 优雅跳过（无 LLM 调用）', async () => {
    const agentBackup = h.moderatorAgent
    h.moderatorAgent = undefined as unknown as typeof h.moderatorAgent
    h.fallbackModerators = []
    const out = await callGenerate({ matchConfig: {} }) // 无 config id → 走 listAgents 回落
    expect(out).toBeNull()
    expect(h.calls.runNarration).toBe(0)
    h.moderatorAgent = agentBackup
  })

  it('存量对局回落：config 无 moderatorAgentId 时取库内首个主持人', async () => {
    h.fallbackModerators = [h.moderatorAgent]
    const out = await callGenerate({ matchConfig: {} })
    expect(out).not.toBeNull()
    expect(h.calls.runNarration).toBe(1)
  })

  it('keyring 无 key → 优雅跳过', async () => {
    h.apiKey = undefined
    const out = await callGenerate()
    expect(out).toBeNull()
    expect(h.calls.runNarration).toBe(0)
  })
})

describe('generateModeratorNarration — LLM 调用与事件构造', () => {
  it('成功：返回公共旁白事件（kind/受众/seq/payload）并记录用量', async () => {
    const out = await callGenerate()
    expect(out).not.toBeNull()
    expect(h.calls.runNarration).toBe(1)

    const event = out?.event
    expect(event?.kind).toBe(`werewolf:v2:${NARRATION_ENGINE_KIND}`)
    expect(event?.actorAgentId).toBe('agt_mod')
    expect(event?.seq).toBe(RESERVED_SEQ)
    expect(event?.visibility).toBe('public')
    expect(event?.restrictedTo).toBeNull()

    const body = event?.payload as Record<string, unknown>
    expect(body.audience).toEqual({ kind: 'public' })
    expect(body.day).toBe(1)
    const payload = body.payload as Record<string, unknown>
    expect(payload.text).toBe('晨光落下，三号位的座位空了。')
    expect(payload.source).toBe('llm')
    expect(payload.triggeredByKinds).toEqual(['deathsAnnounced'])

    // reserveEventSeq 之后的状态交还 GM 覆写 Redis
    expect((out?.state as { nextSeq?: number }).nextSeq).toBe(RESERVED_SEQ + 1)

    // 用量流水（FR-4.8-03）：purpose = moderator-narration
    expect(h.calls.recordLlmUsage).toHaveLength(1)
    expect(h.calls.recordLlmUsage[0]?.purpose).toBe('moderator-narration')
    expect(h.calls.recordLlmUsage[0]?.model).toBe('test-model')
  })

  it('LLM 失败 → 返回 null（静默跳过，不抛错）', async () => {
    h.llmFails = true
    const out = await callGenerate()
    expect(out).toBeNull()
    expect(h.calls.runNarration).toBe(1)
    expect(h.calls.recordLlmUsage).toHaveLength(0)
  })

  it('M4_MOCK_LLM=1 时成功但不记用量（与 agent endpoint 同口径）', async () => {
    process.env.M4_MOCK_LLM = '1'
    const out = await callGenerate()
    expect(out).not.toBeNull()
    expect(h.calls.recordLlmUsage).toHaveLength(0)
  })
})
