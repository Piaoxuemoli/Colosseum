// 结算可信化（FR-4.6-01）排名回推：以 engine2 脚本整场（与生产落库一致的
// v2 信封）驱动 deriveRankingFromEvents，与结算交付侧（plugin finish→result，
// 即 matches.finalRanking 的来源）对比——一致须 verified，篡改交付数据必须
// 暴露为 mismatch（不允许静默通过），数据缺失必须 underivable。

import { describe, expect, it } from 'vitest'
import { werewolfPluginV2 } from '@/games/werewolf/integration/plugin-v2'
import type { DeliveredRanking } from '@/frontend/store/projections/ranking-verify'
import {
  deriveRankingFromEvents,
  parseDeliveredRanking,
  verifySettlementRanking,
} from '@/frontend/store/projections/ranking-verify'
import {
  pokerEnvelope,
  rawEvent,
  scriptedPokerMatch,
  scriptedWerewolfMatch,
  werewolfEnvelope,
} from './helpers'

// ---------------------------------------------------------------------------
// 扑克：脚本整场（手 1 连续弃牌、手 2 摊牌后受控终局）
// ---------------------------------------------------------------------------

const pokerScript = scriptedPokerMatch()
const pokerEvents = pokerScript.events.map((event) => pokerEnvelope(event))

/** 结算交付侧：engine finish.ranking → plugin finishToResult 同构（matches.finalRanking 来源）。 */
function deliveredFromPokerFinish(): DeliveredRanking {
  const finish = pokerScript.state.finish
  if (!finish) throw new Error('poker script did not finish')
  const ranking = finish.ranking.map((row) => ({
    agentId: row.seatId,
    rank: row.rank,
    score: row.chips,
    extra: { chips: row.chips },
  }))
  return { winnerFaction: ranking[0]?.agentId ?? null, ranking }
}

describe('ranking-verify — poker（hand-ended endStack 链回推）', () => {
  it('derives full ranking from the event stream (all seats, ranks 1..N)', () => {
    const derived = deriveRankingFromEvents(pokerEvents)
    expect(derived).not.toBeNull()
    expect(derived?.gameType).toBe('poker')
    expect(derived?.ranking.map((entry) => entry.agentId).sort()).toEqual(['agent-a', 'agent-b', 'agent-c'])
    expect(derived?.ranking.map((entry) => entry.rank).sort((a, b) => a - b)).toEqual([1, 2, 3])
    // 筹码守恒：终局总筹码 = 初始总筹码（200×3）。
    expect(derived?.ranking.reduce((sum, entry) => sum + (entry.chips ?? 0), 0)).toBe(600)
  })

  it('matches the delivered settlement ranking → verified', () => {
    const derived = deriveRankingFromEvents(pokerEvents)
    expect(verifySettlementRanking(derived, deliveredFromPokerFinish())).toEqual({
      status: 'verified',
      divergences: [],
    })
  })

  it('detects a tampered rank swap → mismatch listing the divergence', () => {
    const delivered = deliveredFromPokerFinish()
    const swapped = delivered.ranking.map((entry, index, all) => {
      if (entry.rank === 1) return { ...all[1], rank: 1, extra: { ...all[1].extra, chips: all[1].score } }
      if (entry.rank === 2) return { ...all[0], rank: 2, extra: { ...all[0].extra, chips: all[0].score } }
      return entry
    })
    const verification = verifySettlementRanking(
      deriveRankingFromEvents(pokerEvents),
      { ...delivered, ranking: swapped },
    )
    expect(verification.status).toBe('mismatch')
    if (verification.status === 'mismatch') {
      expect(verification.divergences.some((line) => line.includes('名次不符'))).toBe(true)
    }
  })

  it('detects a tampered chips score → mismatch mentioning chips', () => {
    const delivered = deliveredFromPokerFinish()
    const tampered = {
      ...delivered,
      ranking: delivered.ranking.map((entry) => (entry.rank === 1 ? { ...entry, score: 9999 } : entry)),
    }
    const verification = verifySettlementRanking(deriveRankingFromEvents(pokerEvents), tampered)
    expect(verification.status).toBe('mismatch')
    if (verification.status === 'mismatch') {
      expect(verification.divergences.some((line) => line.includes('筹码不符'))).toBe(true)
    }
  })

  it('missing delivered ranking → underivable (never silently verified)', () => {
    const verification = verifySettlementRanking(deriveRankingFromEvents(pokerEvents), null)
    expect(verification.status).toBe('underivable')
  })

  it('empty event stream → underivable', () => {
    const verification = verifySettlementRanking(deriveRankingFromEvents([]), deliveredFromPokerFinish())
    expect(verification.status).toBe('underivable')
  })
})

// ---------------------------------------------------------------------------
// 狼人杀：脚本整场（6 人板，昼 1 放逐后狼 2:2 parity 胜）；交付侧走生产路径
// werewolfPluginV2.classify（toMatchResult 即 finalRanking 落库来源）。
// ---------------------------------------------------------------------------

const werewolfScript = scriptedWerewolfMatch()
const werewolfEvents = werewolfScript.events.map((event) => werewolfEnvelope(event))

function deliveredFromWerewolfPlugin(): DeliveredRanking {
  const classified = werewolfPluginV2.classify(werewolfScript.state)
  if (classified.kind !== 'finished') throw new Error('werewolf script state not finished')
  const result = classified.result
  return {
    winnerFaction: result.winnerFaction ?? null,
    ranking: result.ranking.map((entry) => ({
      agentId: entry.agentId,
      rank: entry.rank,
      score: entry.score,
      extra: entry.extra,
    })),
  }
}

describe('ranking-verify — werewolf（gameEnded 揭示回推）', () => {
  it('derives winner faction + full ranking from gameEnded reveal', () => {
    const derived = deriveRankingFromEvents(werewolfEvents)
    expect(derived).not.toBeNull()
    expect(derived?.gameType).toBe('werewolf')
    expect(derived?.winnerFaction).toBe('wolves')
    expect(derived?.ranking).toHaveLength(6)
    // 胜方阵营全员名次先于败方。
    const wolfRanks = derived?.ranking.filter((entry) => entry.role === 'werewolf').map((entry) => entry.rank) ?? []
    const goodRanks = derived?.ranking.filter((entry) => entry.role !== 'werewolf').map((entry) => entry.rank) ?? []
    expect(Math.max(...wolfRanks)).toBeLessThan(Math.min(...goodRanks))
  })

  it('matches the delivered plugin settlement ranking → verified', () => {
    expect(verifySettlementRanking(deriveRankingFromEvents(werewolfEvents), deliveredFromWerewolfPlugin())).toEqual({
      status: 'verified',
      divergences: [],
    })
  })

  it('detects a tampered winner faction → mismatch', () => {
    const delivered = deliveredFromWerewolfPlugin()
    const verification = verifySettlementRanking(deriveRankingFromEvents(werewolfEvents), {
      ...delivered,
      winnerFaction: 'good',
    })
    expect(verification.status).toBe('mismatch')
    if (verification.status === 'mismatch') {
      expect(verification.divergences.some((line) => line.includes('胜方阵营不符'))).toBe(true)
    }
  })

  it('detects a tampered role reveal → mismatch mentioning identity', () => {
    const delivered = deliveredFromWerewolfPlugin()
    const tampered = {
      ...delivered,
      ranking: delivered.ranking.map((entry) =>
        entry.agentId === 'p3' ? { ...entry, extra: { ...entry.extra, role: 'villager' } } : entry,
      ),
    }
    const verification = verifySettlementRanking(deriveRankingFromEvents(werewolfEvents), tampered)
    expect(verification.status).toBe('mismatch')
    if (verification.status === 'mismatch') {
      expect(verification.divergences.some((line) => line.includes('身份不符'))).toBe(true)
    }
  })

  it('legacy werewolf/game-end stream is derived best-effort', () => {
    const events = [
      rawEvent('werewolf', 'werewolf/moderator-narrate', { day: 1, upcomingPhase: 'night', narration: '天黑请闭眼', deaths: [{ agentId: 'p3', cause: 'wolf-kill' }] }),
      rawEvent(
        'werewolf',
        'werewolf/game-end',
        { winner: 'villagers', actualRoles: { p1: 'werewolf', p2: 'villager', p3: 'seer' } },
      ),
    ]
    const derived = deriveRankingFromEvents(events)
    expect(derived?.winnerFaction).toBe('good')
    // 存活好人先于死亡好人，死亡者按 alive 排序靠后；p3（已死）排在 p2（存活）之后。
    const rankOf = (agentId: string) => derived?.ranking.find((entry) => entry.agentId === agentId)?.rank
    expect(rankOf('p2')).toBeDefined()
    expect(rankOf('p3')).toBeDefined()
    expect((rankOf('p2') as number) < (rankOf('p3') as number)).toBe(true)
  })
})

describe('ranking-verify — parseDeliveredRanking（防御性解析）', () => {
  it('parses a finalRanking-shaped JSON value', () => {
    const parsed = parseDeliveredRanking({
      winnerFaction: 'wolves',
      ranking: [
        { agentId: 'p1', rank: 1, score: 1, extra: { role: 'werewolf' } },
        { agentId: 'p2', rank: 2, score: 0 },
      ],
    })
    expect(parsed?.winnerFaction).toBe('wolves')
    expect(parsed?.ranking).toHaveLength(2)
  })

  it('returns null for null / malformed / empty payloads', () => {
    expect(parseDeliveredRanking(null)).toBeNull()
    expect(parseDeliveredRanking({ nope: true })).toBeNull()
    expect(parseDeliveredRanking({ ranking: [] })).toBeNull()
    expect(parseDeliveredRanking({ ranking: [{ agentId: '', rank: 0 }] })).toBeNull()
  })
})
