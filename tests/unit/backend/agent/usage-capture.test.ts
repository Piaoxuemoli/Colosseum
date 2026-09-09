// FR-4.8-03（R3-6）：用量捕获层——extractUsage 纯函数 + recordLlmUsage
// 持久化（内存库）与「写入失败不抛错」约定。

import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { llmUsage } from '@/platform/db/schema.sqlite'
import * as schema from '@/platform/db/schema.sqlite'
import { extractUsage, recordLlmUsage, NULL_USAGE } from '@/backend/agent/usage-capture'
import { createTestDb } from '../../platform/db/helpers'

describe('extractUsage — ai@5 LanguageModelV2Usage → 持久化口径', () => {
  it('maps full usage', () => {
    expect(extractUsage({ inputTokens: 12, outputTokens: 34, totalTokens: 46 })).toEqual({
      promptTokens: 12,
      completionTokens: 34,
      totalTokens: 46,
    })
  })

  it('maps undefined fields to null（供应方未上报）', () => {
    expect(extractUsage({ inputTokens: undefined, outputTokens: undefined, totalTokens: undefined })).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    })
    expect(extractUsage({})).toEqual({ ...NULL_USAGE })
  })

  it('tolerates non-object input', () => {
    expect(extractUsage(null)).toEqual({ ...NULL_USAGE })
    expect(extractUsage(undefined)).toEqual({ ...NULL_USAGE })
    expect(extractUsage('12')).toEqual({ ...NULL_USAGE })
  })

  it('rejects negative / non-finite values and truncates floats', () => {
    expect(extractUsage({ inputTokens: -1, outputTokens: Number.NaN, totalTokens: 1.9 })).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: 1,
    })
  })

  it('keeps explicit zero distinct from unknown', () => {
    expect(extractUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    })
  })
})

describe('recordLlmUsage — llm_usage 流水写入', () => {
  it('inserts a row with usage', async () => {
    const db = createTestDb()
    await recordLlmUsage(
      {
        matchId: 'match_x',
        agentId: 'agt_y',
        profileId: 'prof_z',
        purpose: 'agent-decision',
        model: 'm',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
      db,
    )

    const rows = await db.select().from(llmUsage).where(eq(llmUsage.matchId, 'match_x'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      agentId: 'agt_y',
      profileId: 'prof_z',
      purpose: 'agent-decision',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      model: 'm',
    })
    expect(rows[0].createdAt).toBeInstanceOf(Date)
  })

  it('defaults to call-count-only row when usage omitted', async () => {
    const db = createTestDb()
    await recordLlmUsage(
      { matchId: null, agentId: null, profileId: null, purpose: 'profile-test', model: 'm' },
      db,
    )

    const rows = await db.select().from(llmUsage)
    expect(rows).toHaveLength(1)
    expect(rows[0].promptTokens).toBeNull()
    expect(rows[0].completionTokens).toBeNull()
    expect(rows[0].totalTokens).toBeNull()
  })

  it('never throws when the insert fails（fire-and-forget-safe）', async () => {
    // 未跑迁移的空库：llm_usage 表不存在 → 插入必败，但调用方不受影响。
    const empty = drizzle(new Database(':memory:'), { schema })
    await expect(
      recordLlmUsage(
        { matchId: 'm', agentId: 'a', profileId: null, purpose: 'agent-decision', model: null },
        empty as unknown as Parameters<typeof recordLlmUsage>[1],
      ),
    ).resolves.toBeUndefined()
  })
})
