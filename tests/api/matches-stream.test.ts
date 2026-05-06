import { beforeAll, describe, expect, it, vi } from 'vitest'

type MessageHandler = (channel: string, message: string) => void

class FakeRedisSubscriber {
  static instances: FakeRedisSubscriber[] = []
  private handlers: MessageHandler[] = []
  subscribedChannel: string | null = null
  disconnected = false

  constructor() {
    FakeRedisSubscriber.instances.push(this)
  }

  async subscribe(channel: string): Promise<number> {
    this.subscribedChannel = channel
    return 1
  }

  on(event: 'message', handler: MessageHandler): void {
    if (event === 'message') this.handlers.push(handler)
  }

  disconnect(): void {
    this.disconnected = true
  }

  emitMessage(channel: string, message: string): void {
    for (const handler of this.handlers) handler(channel, message)
  }
}

describe('GET /api/matches/:id/stream', () => {
  beforeAll(() => {
    vi.resetModules()
    vi.doMock('ioredis', () => ({ default: FakeRedisSubscriber }))
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', './tests/tmp-matches-stream.db')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
  })

  it('returns SSE stream and forwards subscriber messages', async () => {
    const { GET } = await import('@/app/api/matches/[matchId]/stream/route')
    const { keys } = await import('@/lib/redis/keys')
    const matchId = 'match_test_stream_1'
    const res = await GET(new Request('http://localhost/api/matches/x/stream'), {
      params: Promise.resolve({ matchId }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const subscriber = FakeRedisSubscriber.instances[0]
    expect(subscriber.subscribedChannel).toBe(keys.matchChannel(matchId))

    const reader = res.body!.getReader()
    subscriber.emitMessage(keys.matchChannel(matchId), JSON.stringify({ kind: 'test', data: 'hello' }))
    const { value } = await reader.read()
    const raw = new TextDecoder().decode(value)
    await reader.cancel()

    expect(raw).toContain('data:')
    expect(raw).toContain('hello')
    expect(subscriber.disconnected).toBe(true)
  })
})
