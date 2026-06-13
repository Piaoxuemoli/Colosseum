/**
 * Gateway tests — 验证事务流: LLM→解析→验证→执行→fallback。
 */
import { describe, it, expect, vi } from 'vitest'
import { Gateway } from '../gateway/gateway'
import type { LLMClient, GatewayConfig } from '../gateway/gateway'
import type {
  EngineProtocol,
  ContextBuilder,
  ResponseParser,
  BotStrategy,
  AvailableActionInfo,
  ActionResult,
  AgentPersonality,
  GameEvent,
} from '../protocols'

// ---- Mock types ----
interface MockState {
  phase: string
  currentPlayer: string
}
interface MockAction {
  type: string
  playerId: string
}

// ---- Mock implementations ----

function createMockEngine(): EngineProtocol<MockState, MockAction, unknown> {
  return {
    meta: { gameType: 'mock', displayName: 'Mock', minPlayers: 2, maxPlayers: 4, phases: ['play'] },
    createGame: () => ({ phase: 'play', currentPlayer: 'p0' }),
    getAvailableActions: (_state: MockState, _playerId: string): AvailableActionInfo[] => [
      { type: 'hit' },
      { type: 'stand' },
    ],
    applyAction: (state: MockState, action: MockAction): ActionResult<MockState> => ({
      ok: true,
      state: { ...state, phase: 'done' },
      events: [{ type: 'action', payload: { action: action.type } }],
    }),
    validateAction: (_state: MockState, action: MockAction) => {
      if (action.type === 'invalid') return { valid: false, error: 'Invalid action type' }
      return { valid: true }
    },
    serialize: (s: MockState) => JSON.stringify(s),
    deserialize: (d: string) => JSON.parse(d),
  }
}

function createMockContextBuilder(): ContextBuilder<MockState, MockAction> {
  return {
    buildSystemPrompt: (_p: AgentPersonality, _i: Record<string, Record<string, number>>) => 'system prompt',
    buildUserPrompt: (_s: MockState, _id: string, _a: AvailableActionInfo[]) => 'user prompt',
    buildImpressionPrompt: (_s: MockState, _e: GameEvent[], _i: Record<string, Record<string, number>>) => 'impression prompt',
    buildRetryPrompt: (err: string, _actions: string[]) => `retry: ${err}`,
    buildHandSummary: (_s: MockState) => 'summary',
  }
}

function createMockResponseParser(action: MockAction | null = { type: 'hit', playerId: 'p0' }): ResponseParser<MockAction> {
  return {
    parseAction: (_raw: string, _types: string[]) => {
      if (!action) return { ok: false as const, error: 'Parse failed' }
      return { ok: true as const, action }
    },
    parseImpressions: (_raw: string, _keys: string[]) => null,
  }
}

function createMockBotStrategy(): BotStrategy<MockState, MockAction> {
  return {
    chooseAction: (_state: MockState, playerId: string) => ({ type: 'stand', playerId }),
  }
}

function createMockLLMClient(response: string = '<action>hit</action>'): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: response, thinking: 'thinking...' }),
  }
}

function createGateway(overrides: Partial<GatewayConfig<MockState, MockAction>> = {}): Gateway<MockState, MockAction> {
  return new Gateway({
    engine: createMockEngine(),
    contextBuilder: createMockContextBuilder(),
    responseParser: createMockResponseParser(),
    botStrategy: createMockBotStrategy(),
    llmClient: createMockLLMClient(),
    ...overrides,
  })
}

// ---- Tests ----

describe('Gateway', () => {
  describe('requestAgentAction', () => {
    it('should return LLM action on success', async () => {
      const gateway = createGateway()
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.requestAgentAction(state, 'p0')
      expect(result.source).toBe('llm')
      expect(result.action.type).toBe('hit')
      expect(result.thinking).toBe('thinking...')
    })

    it('should call LLM with system + user messages', async () => {
      const llmClient = createMockLLMClient()
      const gateway = createGateway({ llmClient })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      await gateway.requestAgentAction(state, 'p0')
      expect(llmClient.chat).toHaveBeenCalledTimes(1)
      const messages = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[1].role).toBe('user')
    })

    it('should fallback to bot when parse fails after retries', async () => {
      const gateway = createGateway({
        responseParser: createMockResponseParser(null), // always fails
        maxRetries: 1,
      })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.requestAgentAction(state, 'p0')
      expect(result.source).toBe('bot')
      expect(result.action.type).toBe('stand')
    })

    it('should retry once before fallback', async () => {
      let callCount = 0
      const parser: ResponseParser<MockAction> = {
        parseAction: (_raw: string, _types: string[]) => {
          callCount++
          if (callCount <= 1) return { ok: false as const, error: 'First fail' }
          return { ok: true as const, action: { type: 'hit', playerId: 'p0' } }
        },
        parseImpressions: () => null,
      }
      const gateway = createGateway({ responseParser: parser, maxRetries: 1 })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.requestAgentAction(state, 'p0')
      expect(result.source).toBe('llm')
      expect(callCount).toBe(2)
    })

    it('should fallback to bot when LLM throws', async () => {
      const llmClient: LLMClient = {
        chat: vi.fn().mockRejectedValue(new Error('Network error')),
      }
      const gateway = createGateway({ llmClient, maxRetries: 0 })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.requestAgentAction(state, 'p0')
      expect(result.source).toBe('bot')
    })

    it('should fallback to bot when no actions available', async () => {
      const engine = createMockEngine()
      engine.getAvailableActions = () => []
      const gateway = createGateway({ engine })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.requestAgentAction(state, 'p0')
      expect(result.source).toBe('bot')
    })

    it('should fallback when validation fails', async () => {
      const engine = createMockEngine()
      engine.validateAction = () => ({ valid: false, error: 'Bad action' })
      const gateway = createGateway({ engine, maxRetries: 0 })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.requestAgentAction(state, 'p0')
      expect(result.source).toBe('bot')
    })

    it('should pass onChunk to LLM client', async () => {
      const llmClient = createMockLLMClient()
      const gateway = createGateway({ llmClient })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }
      const onChunk = vi.fn()

      await gateway.requestAgentAction(state, 'p0', { onChunk })
      const opts = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(opts.onChunk).toBe(onChunk)
    })
  })

  describe('submitAction', () => {
    it('should clone state and apply action', () => {
      const gateway = createGateway()
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }
      const action: MockAction = { type: 'hit', playerId: 'p0' }

      const result = gateway.submitAction(state, action)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.state.phase).toBe('done')
      }
      // Original state unchanged
      expect(state.phase).toBe('play')
    })
  })

  describe('updateImpressions', () => {
    it('should call LLM and return empty on parse failure', async () => {
      const gateway = createGateway()
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.updateImpressions(state, 'p0', [])
      expect(result.impressions).toEqual({})
    })

    it('should handle LLM errors gracefully', async () => {
      const llmClient: LLMClient = {
        chat: vi.fn().mockRejectedValue(new Error('timeout')),
      }
      const gateway = createGateway({ llmClient })
      const state: MockState = { phase: 'play', currentPlayer: 'p0' }

      const result = await gateway.updateImpressions(state, 'p0', [])
      expect(result.impressions).toEqual({})
    })
  })
})
