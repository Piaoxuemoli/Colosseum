// FR-4.9-01 ELO 查询层：结算钩子增量 / 全量幂等重建 / 天梯读取 / 平局跳过。
// 内存 SQLite + 真实迁移链（含 0003 elo_ratings）。

import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from './helpers'
import { agents, apiProfiles, matches } from '@/platform/db/schema.sqlite'
import { applyEloForMatch, getEloLadder, rebuildEloFromHistory } from '@/platform/db/queries/elo'
import { rankingRowOutcome } from '@/platform/db/queries/stats'

const A1 = 'agt_p1'
const A2 = 'agt_p2'
const A3 = 'agt_p3'
const E1 = 'agt_evil'
const E2 = 'agt_evil2'

let db: ReturnType<typeof createTestDb>

function ranking(rows: Array<{ agentId: string; rank: number; score: number }>): Record<string, unknown> {
  return { ranking: rows }
}

async function seedMatch(
  id: string,
  gameType: string,
  startedAt: Date,
  winnerFaction: string | null,
  finalRanking: Record<string, unknown>,
): Promise<void> {
  await db.insert(matches).values({
    id,
    gameType,
    status: 'completed',
    config: {},
    startedAt,
    completedAt: new Date(startedAt.getTime() + 60_000),
    winnerFaction,
    finalRanking,
    stats: {},
  })
}

beforeEach(async () => {
  db = createTestDb()
  await db.insert(apiProfiles).values({
    id: 'prof_test',
    displayName: 'Test Profile',
    providerId: 'openai-compatible',
    baseUrl: 'https://example.invalid/v1',
    model: 'test-model',
  })
  await db.insert(agents).values([
    { id: A1, displayName: 'P1', gameType: 'poker', profileId: 'prof_test', systemPrompt: 's' },
    { id: A2, displayName: 'P2', gameType: 'poker', profileId: 'prof_test', systemPrompt: 's' },
    { id: A3, displayName: 'P3', gameType: 'poker', profileId: 'prof_test', systemPrompt: 's' },
    { id: E1, displayName: 'Evil1', gameType: 'avalon', profileId: 'prof_test', systemPrompt: 's' },
    { id: E2, displayName: 'Evil2', gameType: 'avalon', profileId: 'prof_test', systemPrompt: 's' },
  ])
})

describe('rankingRowOutcome — avalon 分支（口径 6 与 ELO 同源）', () => {
  it('score 1 + good/evil winner counts as win', () => {
    expect(rankingRowOutcome('avalon', 'good', { rank: 1, score: 1 }).win).toBe(true)
    expect(rankingRowOutcome('avalon', 'evil', { rank: 2, score: 1 }).win).toBe(true)
    expect(rankingRowOutcome('avalon', 'good', { rank: 4, score: 0 }).win).toBe(false)
  })

  it('tie (winnerFaction null) is not a win for score-1 rows', () => {
    expect(rankingRowOutcome('avalon', 'tie', { rank: 1, score: 1 }).win).toBe(false)
    expect(rankingRowOutcome('avalon', null, { rank: 1, score: 1 }).win).toBe(false)
  })
})

describe('applyEloForMatch — 结算钩子', () => {
  it('updates ratings for a completed poker match (winner gains, loser drops)', async () => {
    const updated = await applyEloForMatch(db, {
      id: 'm1',
      gameType: 'poker',
      winnerFaction: A1,
      finalRanking: ranking([
        { agentId: A1, rank: 1, score: 1 },
        { agentId: A2, rank: 2, score: 0 },
      ]),
      status: 'completed',
    })
    expect(updated).toBe(2)
    const ladder = await getEloLadder(db, 'poker')
    expect(ladder.map((row) => row.agentId)).toEqual([A1, A2])
    expect(ladder[0]!.rating).toBe(1016)
    expect(ladder[0]!.lastDelta).toBe(16)
    expect(ladder[0]!.wins).toBe(1)
    expect(ladder[1]!.rating).toBe(984)
  })

  it('skips faction ties entirely (no rows touched)', async () => {
    await applyEloForMatch(db, {
      id: 'm_tie',
      gameType: 'avalon',
      winnerFaction: 'tie',
      finalRanking: ranking([
        { agentId: A1, rank: 1, score: 1 },
        { agentId: A2, rank: 2, score: 1 },
      ]),
      status: 'completed',
    })
    expect(await getEloLadder(db, 'avalon')).toEqual([])
  })

  it('skips non-completed matches and unparseable rankings', async () => {
    expect(
      await applyEloForMatch(db, { id: 'm_r', gameType: 'poker', winnerFaction: null, finalRanking: null, status: 'running' }),
    ).toBe(0)
    expect(
      await applyEloForMatch(db, { id: 'm_x', gameType: 'poker', winnerFaction: null, finalRanking: 'junk', status: 'completed' }),
    ).toBe(0)
  })
})

describe('rebuildEloFromHistory — 全量幂等重建（口径 7）', () => {
  it('replays completed matches in time order and is idempotent', async () => {
    await seedMatch('h1', 'poker', new Date('2026-09-01T00:00:00Z'), A2, ranking([
      { agentId: A1, rank: 1, score: 1 },
      { agentId: A2, rank: 2, score: 0 },
    ]))
    await seedMatch('h2', 'poker', new Date('2026-09-02T00:00:00Z'), A2, ranking([
      { agentId: A1, rank: 2, score: 0 },
      { agentId: A2, rank: 1, score: 1 },
      { agentId: A3, rank: 3, score: 0 },
    ]))
    await seedMatch('h3_tie', 'avalon', new Date('2026-09-03T00:00:00Z'), 'tie', ranking([
      { agentId: A1, rank: 1, score: 1 },
      { agentId: E1, rank: 2, score: 1 },
    ]))
    await seedMatch('h4_evil', 'avalon', new Date('2026-09-04T00:00:00Z'), 'evil', ranking([
      { agentId: A1, rank: 1, score: 0 },
      { agentId: E1, rank: 2, score: 1 },
      { agentId: E2, rank: 3, score: 1 },
    ]))
    // running 局不参与重建。
    await db.insert(matches).values({
      id: 'h5_running',
      gameType: 'poker',
      status: 'running',
      config: {},
      startedAt: new Date('2026-09-05T00:00:00Z'),
      completedAt: null,
      winnerFaction: null,
      finalRanking: null,
      stats: null,
    })

    const first = await rebuildEloFromHistory(db)
    // tie 局跳过 → 3 局参与；players = 品类分列后的行数（A1 在 poker 与
    // avalon 两个天梯各占一行 → 3 + 3 = 6）。
    expect(first).toEqual({ matchesApplied: 3, players: 6 })
    const pokerAfterFirst = await getEloLadder(db, 'poker')
    const avalonAfterFirst = await getEloLadder(db, 'avalon')

    const second = await rebuildEloFromHistory(db)
    expect(second).toEqual(first)
    expect(await getEloLadder(db, 'poker')).toEqual(pokerAfterFirst)
    expect(await getEloLadder(db, 'avalon')).toEqual(avalonAfterFirst)

    // avalon：坏人 2 人同分胜 A1（同分并列的内部顺序不保证）；
    // A1 垫底 <1000；display name join 生效。
    const avalon = await getEloLadder(db, 'avalon')
    expect([E1, E2]).toContain(avalon[0]!.agentId)
    expect(avalon[0]!.displayName).toMatch(/^Evil/)
    expect(avalon.map((row) => row.agentId)).toContain(A1)
    expect(avalon[2]!.rating).toBeLessThan(1000)
  })

  it('clears stale rows on rebuild (ratings converge, never accumulate ghosts)', async () => {
    await seedMatch('h1', 'poker', new Date('2026-09-01T00:00:00Z'), A1, ranking([
      { agentId: A1, rank: 1, score: 1 },
      { agentId: A2, rank: 2, score: 0 },
    ]))
    await rebuildEloFromHistory(db)
    expect((await getEloLadder(db, 'poker')).length).toBe(2)
    await rebuildEloFromHistory(db)
    expect((await getEloLadder(db, 'poker')).length).toBe(2)
  })
})
