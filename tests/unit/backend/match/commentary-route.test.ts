// FR-4.7-02 赛后解说 API（R3-4）：happy path + 422 不虚构拒绝 + 前置校验。
// LLM runtime 与 DB 查询全部 mock——断言密钥只进 runDecision、留存事件
// payload 不含密钥材料（NFR-07）。

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameEvent } from '@/platform/core/types'

// ── 模块 mock（必须在 import route 之前声明）───────────────────────────
const runDecisionMock = vi.hoisted(() =>
  vi.fn(
    async (_input: {
      profile: { apiKey: string; baseUrl: string; model: string; providerKind: string }
      agent: { systemPrompt: string }
      userPrompt: string
    }) => ({ action: {}, thinkingText: '', rawResponse: '<action>{}</action>' }),
  ),
)
vi.mock('@/backend/agent/llm-runtime', () => ({
  runDecision: runDecisionMock,
}))

const MATCHES = vi.hoisted(() => ({
  findMatchById: vi.fn(),
  listParticipants: vi.fn(),
}))
vi.mock('@/platform/db/queries/matches', () => MATCHES)

const EVENTS = vi.hoisted(() => ({
  listMatchEvents: vi.fn(),
  appendEvent: vi.fn(),
  nextSeq: vi.fn(),
}))
vi.mock('@/platform/db/queries/events', () => EVENTS)

const AGENTS = vi.hoisted(() => ({ findAgentById: vi.fn() }))
vi.mock('@/platform/db/queries/agents', () => AGENTS)

const PROFILES = vi.hoisted(() => ({ findProfileById: vi.fn() }))
vi.mock('@/platform/db/queries/profiles', () => PROFILES)

import { POST } from '@/app/api/matches/[matchId]/commentary/route'

const MATCH_ID = 'match_commentary_route'
const API_KEY = 'sk-secret-key-material'

function makeEvent(seq: number, kind = 'poker:v2:action-made', payload: Record<string, unknown> = {}): GameEvent {
  return {
    id: `evt_${seq}`,
    matchId: MATCH_ID,
    gameType: 'poker',
    seq,
    occurredAt: '2026-09-09T00:00:00Z',
    kind,
    actorAgentId: 'agt_a',
    payload,
    visibility: 'public',
    restrictedTo: null,
  }
}

const STREAM = [
  makeEvent(1, 'poker:v2:hand-started', { hand: 1 }),
  makeEvent(2, 'poker:v2:pot-awarded', { hand: 1, amount: 120, winners: [{ seatId: 'agt_a', total: 120 }] }),
  makeEvent(3, 'poker:v2:player-eliminated', { seatId: 'agt_b', rank: 2 }),
  makeEvent(4, 'poker:v2:match-finished', { reason: 'last-man-standing', ranking: [] }),
]

function completedMatchRow() {
  return {
    id: MATCH_ID,
    gameType: 'poker',
    status: 'completed',
    config: { engineVersion: 2 },
    startedAt: new Date('2026-09-09T00:00:00Z'),
    completedAt: new Date('2026-09-09T00:30:00Z'),
    winnerFaction: 'agt_a',
    finalRanking: {
      winnerFaction: 'agt_a',
      ranking: [
        { agentId: 'agt_a', rank: 1, score: 320 },
        { agentId: 'agt_b', rank: 2, score: 0 },
      ],
    },
    stats: null,
  }
}

function profileRow() {
  return {
    id: 'prof_openai',
    displayName: 'OpenAI 主力',
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    temperature: 70,
    maxTokens: null,
    contextWindowTokens: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  }
}

function call(body: unknown) {
  const req = new Request(`http://localhost/api/matches/${MATCH_ID}/commentary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ matchId: MATCH_ID }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  MATCHES.findMatchById.mockResolvedValue(completedMatchRow())
  MATCHES.listParticipants.mockResolvedValue([
    { matchId: MATCH_ID, agentId: 'agt_a', seatIndex: 0, initialData: null },
    { matchId: MATCH_ID, agentId: 'agt_b', seatIndex: 1, initialData: null },
  ])
  AGENTS.findAgentById.mockImplementation(async (id: string) => ({ id, displayName: id === 'agt_a' ? 'Alice' : 'Bob' }))
  EVENTS.listMatchEvents.mockResolvedValue(STREAM)
  EVENTS.nextSeq.mockResolvedValue(99)
  EVENTS.appendEvent.mockResolvedValue(undefined)
  PROFILES.findProfileById.mockResolvedValue(profileRow())
})

describe('POST /api/matches/:id/commentary — happy path', () => {
  it('校验通过 → 落 match/commentary 事件并返回解说（密钥不出现在任何留存物）', async () => {
    runDecisionMock.mockResolvedValue({
      action: {
        headline: 'Alice 两连池终结比赛',
        summary: 'Alice 全场压制，第 1 手大池后锁定胜局。',
        highlights: [
          { seq: 2, title: '大底池', text: 'Alice 拿下 120 派彩。' },
          { seq: 3, title: '淘汰', text: 'Bob 出局，第 2 名。' },
        ],
        mvp: { agentId: 'agt_a', reason: '关键池全胜' },
      },
      thinkingText: '...',
      rawResponse: '<action>{...}</action>',
    })

    const res = await call({ apiKey: API_KEY, profileId: 'prof_openai' })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      eventSeq: number
      commentary: { headline: string; highlights: Array<{ seq: number }> }
      source: { model: string; providerHost: string; createdAt: string }
    }
    expect(body.eventSeq).toBe(99)
    expect(body.commentary.headline).toBe('Alice 两连池终结比赛')
    expect(body.commentary.highlights.map((h) => h.seq)).toEqual([2, 3])
    expect(body.source.model).toBe('gpt-4o-mini')
    expect(body.source.providerHost).toBe('api.openai.com')

    // LLM 凭据：只进 runDecision 的 profile（baseUrl/model 来自 Profile 行）。
    expect(runDecisionMock).toHaveBeenCalledTimes(1)
    const [runtimeInput] = runDecisionMock.mock.calls[0]
    expect(runtimeInput.profile.apiKey).toBe(API_KEY)
    expect(runtimeInput.profile.baseUrl).toBe('https://api.openai.com/v1')
    expect(runtimeInput.profile.model).toBe('gpt-4o-mini')
    expect(runtimeInput.profile.providerKind).toBe('openai-compatible')

    // 留存事件：公共可见、kind 正确、payload 无密钥材料。
    expect(EVENTS.appendEvent).toHaveBeenCalledTimes(1)
    const stored = EVENTS.appendEvent.mock.calls[0][0] as GameEvent
    expect(stored.kind).toBe('match/commentary')
    expect(stored.visibility).toBe('public')
    expect(stored.seq).toBe(99)
    expect(JSON.stringify(stored.payload)).not.toContain(API_KEY)
    expect(JSON.stringify(stored.payload)).toContain('Alice 两连池终结比赛')
    expect(JSON.stringify(stored.payload)).toContain('gpt-4o-mini')
  })

  it('直连模式（无 profileId）要求 baseUrl + model', async () => {
    runDecisionMock.mockResolvedValue({
      action: {
        headline: 'h',
        summary: 's',
        highlights: [{ seq: 1, title: 't', text: 'x' }],
      },
      thinkingText: '',
      rawResponse: '',
    })
    const missing = await call({ apiKey: API_KEY })
    expect(missing.status).toBe(400)

    const direct = await call({ apiKey: API_KEY, baseUrl: 'https://llm.local/v1', model: 'local-model' })
    expect(direct.status).toBe(200)
    const [runtimeInput] = runDecisionMock.mock.calls[0]
    expect(runtimeInput.profile.baseUrl).toBe('https://llm.local/v1')
    expect(runtimeInput.profile.providerKind).toBe('custom')

    const badUrl = await call({ apiKey: API_KEY, baseUrl: 'not-a-url', model: 'm' })
    expect(badUrl.status).toBe(400)
  })
})

describe('POST /api/matches/:id/commentary — 不虚构拒绝（422）', () => {
  it('过半亮点引用不存在的 seq → 422 + invalidSeqs，不落事件', async () => {
    runDecisionMock.mockResolvedValue({
      action: {
        headline: 'h',
        summary: 's',
        highlights: [
          { seq: 2, title: '真', text: '真实时刻' },
          { seq: 777, title: '假', text: '编造时刻' },
          { seq: 888, title: '假', text: '编造时刻' },
        ],
      },
      thinkingText: '',
      rawResponse: '',
    })

    const res = await call({ apiKey: API_KEY, profileId: 'prof_openai' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { code: string; invalidSeqs: number[]; retryable: boolean }
    expect(body.code).toBe('commentary_fabrication')
    expect(body.invalidSeqs).toEqual([777, 888])
    expect(body.retryable).toBe(true)
    expect(EVENTS.appendEvent).not.toHaveBeenCalled()
  })

  it('输出非 JSON 对象 / 缺字段 → 422 invalid_shape', async () => {
    runDecisionMock.mockResolvedValue({ action: { type: 'fold' }, thinkingText: '', rawResponse: '' })
    const res = await call({ apiKey: API_KEY, profileId: 'prof_openai' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('commentary_invalid_shape')
  })
})

describe('POST /api/matches/:id/commentary — 前置校验与失败路径', () => {
  it('对局未结束 → 409', async () => {
    MATCHES.findMatchById.mockResolvedValue({ ...completedMatchRow(), status: 'running' })
    const res = await call({ apiKey: API_KEY, profileId: 'prof_openai' })
    expect(res.status).toBe(409)
    expect(runDecisionMock).not.toHaveBeenCalled()
  })

  it('对局不存在 → 404；profileId 未知 → 400', async () => {
    MATCHES.findMatchById.mockResolvedValue(undefined)
    expect((await call({ apiKey: API_KEY, profileId: 'prof_x' })).status).toBe(404)

    MATCHES.findMatchById.mockResolvedValue(completedMatchRow())
    PROFILES.findProfileById.mockResolvedValue(undefined)
    expect((await call({ apiKey: API_KEY, profileId: 'prof_x' })).status).toBe(400)
  })

  it('请求体缺 apiKey → 400', async () => {
    const res = await call({ profileId: 'prof_openai' })
    expect(res.status).toBe(400)
  })

  it('LLM 失败 → 502 且不落事件', async () => {
    runDecisionMock.mockRejectedValue(new Error('provider exploded'))
    const res = await call({ apiKey: API_KEY, profileId: 'prof_openai' })
    expect(res.status).toBe(502)
    const body = (await res.json()) as { code: string; retryable: boolean }
    expect(body.code).toBe('llm_api_error')
    expect(body.retryable).toBe(true)
    expect(EVENTS.appendEvent).not.toHaveBeenCalled()
  })
})
