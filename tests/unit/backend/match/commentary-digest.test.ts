// FR-4.7-02 赛后解说 digest 构造（R3-4）：从真实 v2 事件流 + finalRanking
// 提取关键时刻。两游戏各用 engine2 驱动的完整脚本局（复用前端投影测试
// 脚手架，事件形状与生产落库一致），另加定向合成事件覆盖分支与规模上限。

import { describe, expect, it } from 'vitest'
import {
  MAX_KEY_MOMENTS,
  POKER_BIG_POT_HANDS,
  buildCommentaryDigest,
  buildCommentaryPrompt,
} from '@/backend/match/commentary'
import {
  MATCH_ID,
  POKER_SEAT_IDS,
  indexOfKind,
  pokerEnvelope,
  rawEvent,
  scriptedPokerMatch,
  scriptedWerewolfMatch,
  werewolfEnvelope,
} from '../../frontend/store/projections/helpers'
import type { GameEvent } from '@/platform/core/types'

const POKER_NAMES: Record<string, string> = {
  'agent-a': 'Alice',
  'agent-b': 'Bob',
  'agent-c': 'Carol',
}

const WEREWOLF_NAMES: Record<string, string> = {
  p1: '玩家一',
  p2: '玩家二',
  p3: '预言家',
  p4: '女巫',
  p5: '村民五',
  p6: '村民六',
}

function envelopeAll(events: GameEvent[]): number[] {
  return events.map((event) => event.seq)
}

describe('buildCommentaryDigest — 德州扑克', () => {
  const script = scriptedPokerMatch()
  const events = script.events.map((event) => pokerEnvelope(event))

  it('提取终局、大底池等时刻，且每条 seq 都真实存在于事件流', () => {
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'poker',
      events,
      finalRanking: null,
      agentNames: POKER_NAMES,
    })

    expect(digest.gameType).toBe('poker')
    const seqs = new Set(envelopeAll(events))
    for (const moment of digest.keyMoments) {
      expect(seqs.has(moment.seq)).toBe(true)
    }

    const labels = digest.keyMoments.map((moment) => moment.label)
    expect(labels).toContain('终局')
    expect(labels).toContain('大底池')
    // 脚本局每手都有 pot-awarded，手数 ≤ 上限 → 每手都入选大底池。
    expect(labels.filter((label) => label === '大底池').length).toBeGreaterThan(0)
  })

  it('大底池时刻带赢家与金额事实（来自 pot-awarded payload）', () => {
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'poker',
      events,
      finalRanking: null,
      agentNames: POKER_NAMES,
    })
    const bigPot = digest.keyMoments.find((moment) => moment.label === '大底池')
    expect(bigPot).toBeDefined()
    expect(bigPot?.description).toMatch(/派彩 \d+/)
  })

  it('淘汰 / 盲注升级 / 全下 / run-out 各自成时刻', () => {
    const withSynthetic = [
      ...events,
      rawEvent('poker', 'poker:v2:player-eliminated', { seatId: 'agent-c', rank: 3 }),
      rawEvent('poker', 'poker:v2:blind-level-raised', { level: 2, blinds: { sb: 10, bb: 20 } }),
      rawEvent('poker', 'poker:v2:action-made', {
        hand: 99,
        seatId: 'agent-a',
        action: { type: 'allIn', amount: 180 },
      }),
      rawEvent('poker', 'poker:v2:run-out-started', { hand: 99 }),
    ]
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'poker',
      events: withSynthetic,
      finalRanking: null,
      agentNames: POKER_NAMES,
    })
    const byLabel = new Map(digest.keyMoments.map((moment) => [moment.label, moment]))

    expect(byLabel.get('淘汰')?.description).toContain('Carol')
    expect(byLabel.get('淘汰')?.description).toContain('第 3 名')
    expect(byLabel.get('盲注升级')?.description).toContain('10/20')
    expect(byLabel.get('全下')?.description).toContain('Alice')
    expect(byLabel.get('run-out')?.description).toContain('第 99 手')
  })

  it('大底池只保留派彩总额最大的前 POKER_BIG_POT_HANDS 手', () => {
    // 8 手各一次派彩（金额 10,20,…,80）→ 只保留金额最大的 5 手。
    const potEvents: GameEvent[] = []
    for (let hand = 1; hand <= 8; hand++) {
      potEvents.push(
        rawEvent('poker', 'poker:v2:pot-awarded', {
          hand,
          potIndex: 0,
          amount: hand * 10,
          winners: [{ seatId: POKER_SEAT_IDS[0], total: hand * 10 }],
        }),
      )
    }
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'poker',
      events: potEvents,
      finalRanking: null,
      agentNames: POKER_NAMES,
    })
    const bigPots = digest.keyMoments.filter((moment) => moment.label === '大底池')
    expect(bigPots.length).toBe(POKER_BIG_POT_HANDS)
    for (const moment of bigPots) {
      expect(moment.description).toMatch(/第 ([4-8]) 手/)
    }
  })

  it('finalRanking 进入 digest，且名册由 seatIds + 排名并集构成', () => {
    const finalRanking = {
      winnerFaction: 'agent-a',
      ranking: [
        { agentId: 'agent-a', rank: 1, score: 400 },
        { agentId: 'agent-b', rank: 2, score: 150 },
        { agentId: 'agent-c', rank: 3, score: 50 },
      ],
    }
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'poker',
      events,
      finalRanking,
      agentNames: POKER_NAMES,
    })
    expect(digest.ranking?.map((entry) => entry.agentId)).toEqual(['agent-a', 'agent-b', 'agent-c'])
    expect(digest.winnerFaction).toBe('agent-a')
    for (const seat of POKER_SEAT_IDS) expect(digest.rosterAgentIds).toContain(seat)
  })
})

describe('buildCommentaryDigest — 狼人杀', () => {
  const script = scriptedWerewolfMatch()
  const events = script.events.map((event) => werewolfEnvelope(event))

  it('提取死讯公告 / 投票结果 / 终局揭示 / 查验，seq 全部真实', () => {
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'werewolf',
      events,
      finalRanking: null,
      agentNames: WEREWOLF_NAMES,
    })

    expect(digest.gameType).toBe('werewolf')
    const seqs = new Set(envelopeAll(events))
    for (const moment of digest.keyMoments) expect(seqs.has(moment.seq)).toBe(true)

    const labels = digest.keyMoments.map((moment) => moment.label)
    expect(labels).toContain('死讯公告')
    expect(labels).toContain('投票结果')
    expect(labels).toContain('终局揭示')
    expect(labels).toContain('查验')
    expect(labels).toContain('狼队刀口')
  })

  it('死讯公告与放逐事实与引擎事件一致（不虚构的素材面）', () => {
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'werewolf',
      events,
      finalRanking: null,
      agentNames: WEREWOLF_NAMES,
    })
    const announcedSeq = events[indexOfKind(events, 'werewolf:v2:deathsAnnounced')].seq
    const deathMoment = digest.keyMoments.find((moment) => moment.seq === announcedSeq)
    expect(deathMoment?.label).toBe('死讯公告')
    // 脚本局夜 1 刀预言家 p3 → 单死公告。
    expect(deathMoment?.description).toContain('单死')

    const voteSeq = events[indexOfKind(events, 'werewolf:v2:voteResult')].seq
    const voteMoment = digest.keyMoments.find((moment) => moment.seq === voteSeq)
    expect(voteMoment?.description).toContain('放逐')
    expect(voteMoment?.description).toContain('村民五')

    const endedSeq = events[indexOfKind(events, 'werewolf:v2:gameEnded')].seq
    const endMoment = digest.keyMoments.find((moment) => moment.seq === endedSeq)
    expect(endMoment?.description).toContain('狼人阵营')
    // 全桌身份揭示进素材（上帝视角终局揭示；RoleId 为引擎词表如 seer）。
    expect(endMoment?.description).toContain('seer')
  })

  it('关键时刻总数不超过 MAX_KEY_MOMENTS（长局防 prompt 爆炸）', () => {
    // 合成超长流：60+ 条死讯公告 + 60+ 条投票结果。
    const flood: GameEvent[] = []
    for (let day = 1; day <= 80; day++) {
      flood.push(
        rawEvent('werewolf', 'werewolf:v2:deathsAnnounced', {
          payload: { kind: 'single', seatNumbers: [day % 6] },
          day,
        }),
      )
      flood.push(
        rawEvent('werewolf', 'werewolf:v2:voteResult', {
          payload: { round: 'main', outcome: 'no-exile', tally: [] },
          day,
        }),
      )
    }
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'werewolf',
      events: flood,
      finalRanking: null,
      agentNames: WEREWOLF_NAMES,
    })
    expect(digest.keyMoments.length).toBeLessThanOrEqual(MAX_KEY_MOMENTS)
  })
})

describe('buildCommentaryPrompt — 不虚构约束的提示词面', () => {
  it('prompt 要求引用清单 seq 并禁止编造，清单以 #seq= 呈现', () => {
    const script = scriptedPokerMatch()
    const events = script.events.map((event) => pokerEnvelope(event))
    const digest = buildCommentaryDigest({
      matchId: MATCH_ID,
      gameType: 'poker',
      events,
      finalRanking: null,
      agentNames: POKER_NAMES,
    })
    const prompt = buildCommentaryPrompt(digest)

    expect(prompt.systemMessage).toContain('严禁编造')
    expect(prompt.systemMessage).toContain('<action>')
    expect(prompt.userMessage).toContain('#seq=')
    expect(prompt.userMessage).toContain('唯一事实来源')
    // 每条清单行都带真实 seq。
    for (const moment of digest.keyMoments) {
      expect(prompt.userMessage).toContain(`#seq=${moment.seq} [${moment.label}]`)
    }
  })
})
