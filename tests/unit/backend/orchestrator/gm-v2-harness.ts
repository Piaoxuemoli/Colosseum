/**
 * GM v2 集成测试共享 harness：内存版 Redis + 内存版 DB queries。
 * 单例 store 经 vi.mock 的异步工厂注入被测模块；resetStore() 逐用例复位。
 */

export class FakeRedis {
  store = new Map<string, string>()
  hashes = new Map<string, Record<string, string>>()
  published: Array<{ channel: string; message: string }> = []

  async set(key: string, value: string, ...rest: unknown[]): Promise<'OK' | null> {
    const nx = rest.includes('NX')
    if (nx && this.store.has(key)) return null
    this.store.set(key, value)
    return 'OK'
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0
    for (const key of keys) {
      if (this.store.delete(key)) removed += 1
      this.hashes.delete(key)
    }
    return removed
  }

  async hset(key: string, values: Record<string, string>): Promise<number> {
    const current = this.hashes.get(key) ?? {}
    this.hashes.set(key, { ...current, ...values })
    return Object.keys(values).length
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.[field] ?? null
  }

  async expire(): Promise<number> {
    return 1
  }

  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message })
    return 1
  }

  clear(): void {
    this.store.clear()
    this.hashes.clear()
    this.published = []
  }
}

export type StoredEvent = {
  id: string
  matchId: string
  seq: number
  occurredAt: string
  kind: string
  actorAgentId: string | null
  payload: Record<string, unknown>
  visibility: string
  restrictedTo: string[] | null
}

export type StoredMatch = {
  id: string
  gameType: string
  status: string
  config: Record<string, unknown>
  startedAt: Date
  completedAt: Date | null
  winnerFaction: string | null
  finalRanking: Record<string, unknown> | null
  stats: Record<string, unknown> | null
}

export type StoredEpisodic = {
  observerAgentId: string
  targetAgentId: string | null
  matchId: string
  gameType: string
  entryJson: Record<string, unknown>
  tags: string[] | undefined
}

export type StoredAgentError = {
  matchId: string
  agentId: string
  layer: string
  errorCode: string
  rawResponse: string | null
  recoveryAction: Record<string, unknown> | null
}

function createStore() {
  return {
    redis: new FakeRedis(),
    events: [] as StoredEvent[],
    matches: [] as StoredMatch[],
    participants: [] as Array<{ matchId: string; agentId: string; seatIndex: number; initialData: Record<string, unknown> | null }>,
    agents: new Map<string, { id: string; displayName: string; gameType: string; kind: string; profileId: string; systemPrompt: string }>(),
    episodic: [] as StoredEpisodic[],
    semantic: new Map<string, { profileJson: Record<string, unknown>; gamesObserved: number }>(),
    semanticWrites: 0,
    workingMemoryDeletes: 0,
    agentErrors: [] as StoredAgentError[],
    finalized: [] as Array<{ matchId: string; winnerFaction: string | null; result: Record<string, unknown> }>,
    /** requestAgentDecisionToy 的可配置替身（缺省抛错：不应被调用）。 */
    agentEndpoint: null as null | (() => Promise<Record<string, unknown>>),
    /** Profile 行替身（moderator 旁白解析用；profileId → 行）。 */
    profiles: new Map<string, { id: string; displayName: string; providerId: string; baseUrl: string; model: string }>(),
    /** runNarration 替身：返回旁白文本；null = 模拟 LLM 失败（抛错）。 */
    narrationLlm: null as null | (() => string),
    /** runNarration 被调用次数（断言「关闸 = 零调用」）。 */
    narrationCalls: 0,
    /** recordLlmUsage 替身收集的用量行。 */
    usageRows: [] as Array<Record<string, unknown>>,
    matchCounter: 0,
  }
}

export type GmStore = ReturnType<typeof createStore>

export const store: GmStore = createStore()

export function resetStore(): void {
  store.redis.clear()
  store.events = []
  store.matches = []
  store.participants = []
  store.agents = new Map()
  store.episodic = []
  store.semantic = new Map()
  store.semanticWrites = 0
  store.workingMemoryDeletes = 0
  store.agentErrors = []
  store.finalized = []
  store.agentEndpoint = null
  store.profiles = new Map()
  store.narrationLlm = null
  store.narrationCalls = 0
  store.usageRows = []
  store.matchCounter = 0
}

export function nextMatchId(): string {
  store.matchCounter += 1
  return `m_test_${store.matchCounter}`
}

export function seedAgent(agentId: string, gameType: string): void {
  store.agents.set(agentId, {
    id: agentId,
    displayName: agentId.replace(/^agt_/, ''),
    gameType,
    kind: 'player',
    profileId: 'prof_test',
    systemPrompt: `persona of ${agentId}`,
  })
}

/** 主持人 Agent + 其 Profile + 服务端 keyring 三件套（R3-3 旁白路径）。 */
export function seedModerator(agentId: string, profileId = 'prof_test'): void {
  store.agents.set(agentId, {
    id: agentId,
    displayName: '系统主持人',
    gameType: 'werewolf',
    kind: 'moderator',
    profileId,
    systemPrompt: '你是狼人杀的主持人。',
  })
  store.profiles.set(profileId, {
    id: profileId,
    displayName: 'Test Profile',
    providerId: 'provider-x',
    baseUrl: 'https://llm.test/v1',
    model: 'test-model',
  })
}

/** 按插入顺序取某对局的事件（模拟 game_events 的 seq 升序读取）。 */
export function eventsOf(matchId: string): StoredEvent[] {
  return store.events.filter((event) => event.matchId === matchId)
}
