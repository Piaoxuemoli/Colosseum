import { db } from '@/lib/db/client'
import { apiProfiles } from '@/lib/db/schema.sqlite'
import { redis } from '@/lib/redis/client'
import { log } from '@/lib/telemetry/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  let dbStatus: 'ok' | 'error' = 'error'
  let redisStatus: 'ok' | 'error' = 'error'

  try {
    await db.select().from(apiProfiles).limit(1)
    dbStatus = 'ok'
  } catch (err) {
    log.error('health db check failed', { err: String(err) })
  }

  try {
    const pong = await redis.ping()
    if (pong === 'PONG') redisStatus = 'ok'
  } catch (err) {
    log.error('health redis check failed', { err: String(err) })
  }

  const ok = dbStatus === 'ok' && redisStatus === 'ok'
  return Response.json({ ok, db: dbStatus, redis: redisStatus }, { status: ok ? 200 : 503 })
}
