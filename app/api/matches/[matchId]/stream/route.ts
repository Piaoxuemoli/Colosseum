import Redis from 'ioredis'
import { loadEnv } from '@/lib/env'
import { keys } from '@/lib/redis/keys'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  context: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  const { matchId } = await context.params
  const env = loadEnv()
  const subscriber = new Redis(env.REDIS_URL, { lazyConnect: true })
  const channel = keys.matchChannel(matchId)
  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const closeSubscriber = () => {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    subscriber.disconnect()
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          closeSubscriber()
        }
      }, 15_000)

      await subscriber.subscribe(channel)
      subscriber.on('message', (receivedChannel: string, message: string) => {
        if (receivedChannel !== channel) return
        try {
          controller.enqueue(encoder.encode(`data: ${message}\n\n`))
        } catch {
          closeSubscriber()
        }
      })

      req.signal.addEventListener('abort', () => {
        closeSubscriber()
        try {
          controller.close()
        } catch {
          // The client may have already closed the stream.
        }
      })
    },
    cancel() {
      closeSubscriber()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
