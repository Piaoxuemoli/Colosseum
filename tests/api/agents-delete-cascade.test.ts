import { beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateSqliteTestDb } from '@/tests/lib/db/test-utils'

const DB = './tests/tmp-agents-delete-cascade.db'

/**
 * Regression: deleting an agent that's referenced by match_participants
 * used to fail with SqliteError FOREIGN_KEY (500). The route now returns
 * structured 409 + cascades safely when ?cascade=true.
 */
describe('DELETE /api/agents/:id FK handling', () => {
  let profileId: string
  let agentId: string

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('DB_DRIVER', 'sqlite')
    vi.stubEnv('SQLITE_PATH', DB)
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    migrateSqliteTestDb(DB)

    const { createProfile } = await import('@/lib/db/queries/profiles')
    const profile = await createProfile({
      displayName: 'P',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })
    profileId = profile.id

    const { createAgent } = await import('@/lib/db/queries/agents')
    const agent = await createAgent({
      displayName: 'Bot',
      gameType: 'poker',
      profileId,
      systemPrompt: 'x',
      avatarEmoji: '🤖',
    })
    agentId = agent.id
  })

  async function deleteAgent(cascade = false): Promise<Response> {
    const { DELETE } = await import('@/app/api/agents/[agentId]/route')
    const path = cascade
      ? `http://localhost/api/agents/x?cascade=true`
      : `http://localhost/api/agents/x`
    return DELETE(new Request(path, { method: 'DELETE' }), {
      params: Promise.resolve({ agentId }),
    })
  }

  it('no references → 204', async () => {
    const res = await deleteAgent()
    expect(res.status).toBe(204)
  })

  it('referenced by a settled match → 409 needs-cascade, then 204 with ?cascade=true', async () => {
    // Recreate agent + insert a settled-match participant row.
    const { createAgent } = await import('@/lib/db/queries/agents')
    const agent = await createAgent({
      displayName: 'Bot2',
      gameType: 'poker',
      profileId,
      systemPrompt: 'x',
      avatarEmoji: '🤖',
    })
    agentId = agent.id

    const { db } = await import('@/lib/db/client')
    const { matches, matchParticipants } = await import('@/lib/db/schema.sqlite')
    await db.insert(matches).values({
      id: 'm-settled-1',
      gameType: 'poker',
      status: 'completed',
      config: {},
      startedAt: new Date(),
    })
    await db.insert(matchParticipants).values({
      matchId: 'm-settled-1',
      agentId,
      seatIndex: 0,
    })

    const firstRes = await deleteAgent(false)
    expect(firstRes.status).toBe(409)
    const firstBody = (await firstRes.json()) as {
      kind: string
      matchIds: string[]
    }
    expect(firstBody.kind).toBe('needs-cascade')
    expect(firstBody.matchIds).toContain('m-settled-1')

    const secondRes = await deleteAgent(true)
    expect(secondRes.status).toBe(204)

    // participants row should be gone
    const { eq } = await import('drizzle-orm')
    const leftover = await db
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.agentId, agentId))
    expect(leftover).toHaveLength(0)
  })

  it('referenced by a running match → 409 running-match even with ?cascade=true', async () => {
    const { createAgent } = await import('@/lib/db/queries/agents')
    const agent = await createAgent({
      displayName: 'Bot3',
      gameType: 'poker',
      profileId,
      systemPrompt: 'x',
      avatarEmoji: '🤖',
    })
    agentId = agent.id

    const { db } = await import('@/lib/db/client')
    const { matches, matchParticipants } = await import('@/lib/db/schema.sqlite')
    await db.insert(matches).values({
      id: 'm-running-1',
      gameType: 'poker',
      status: 'running',
      config: {},
      startedAt: new Date(),
    })
    await db.insert(matchParticipants).values({
      matchId: 'm-running-1',
      agentId,
      seatIndex: 0,
    })

    const res = await deleteAgent(true) // cascade shouldn't matter here
    expect(res.status).toBe(409)
    const body = (await res.json()) as { kind: string; matchIds: string[] }
    expect(body.kind).toBe('running-match')
    expect(body.matchIds).toContain('m-running-1')
  })
})
