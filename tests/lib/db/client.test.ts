import { beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import Database from 'better-sqlite3'

describe('lib/db/client (sqlite)', () => {
  beforeAll(() => {
    vi.stubEnv('NODE_ENV', 'test')
    process.env.BASE_URL = 'http://localhost:3000'
    process.env.DB_DRIVER = 'sqlite'
    process.env.SQLITE_PATH = './tests/tmp-test.db'
    process.env.REDIS_URL = 'redis://localhost:6379'
    if (existsSync('./tests/tmp-test.db')) unlinkSync('./tests/tmp-test.db')
    const sqlite = new Database('./tests/tmp-test.db')
    sqlite.exec(`
      CREATE TABLE api_profiles (
        id text PRIMARY KEY NOT NULL,
        display_name text NOT NULL,
        provider_id text NOT NULL,
        base_url text NOT NULL,
        model text NOT NULL,
        temperature integer DEFAULT 70 NOT NULL,
        max_tokens integer,
        context_window_tokens integer,
        created_at integer DEFAULT (strftime('%s','now')) NOT NULL
      );
    `)
    sqlite.close()
  })

  it('exposes a drizzle instance', async () => {
    const { db } = await import('@/lib/db/client')
    expect(db).toBeDefined()
    expect(typeof db.select).toBe('function')
  })

  it('imports sqlite schema when DB_DRIVER=sqlite', async () => {
    const { apiProfiles } = await import('@/lib/db/schema.sqlite')
    expect(apiProfiles).toBeDefined()
  })

  it('can insert and select an api profile', async () => {
    const { randomUUID } = await import('node:crypto')
    const { db } = await import('@/lib/db/client')
    const { apiProfiles } = await import('@/lib/db/schema.sqlite')

    const id = randomUUID()
    await db.insert(apiProfiles).values({
      id,
      displayName: 'Test Profile',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    })

    const rows = await db.select().from(apiProfiles)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.find((row) => row.id === id)?.displayName).toBe('Test Profile')
  })
})
