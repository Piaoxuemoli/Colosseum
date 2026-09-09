// 阿瓦隆观战组件族（AvalonSituationPanel / AvalonQuestBoard / AvalonSeatCard /
// AvalonKnowledgePanel）与 avalon-format 纯函数的轻量渲染断言
// （renderToStaticMarkup，jsdom-free；对齐 commentary-panel.test.ts 做法）。
// 数据面 = 冻结契约脚本流经 avalon-v2 投影（不依赖引擎真实代码）。

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AvalonSituationBody } from '@/frontend/components/match/AvalonSituationPanel'
import { AvalonQuestBoardView } from '@/frontend/components/match/AvalonQuestBoard'
import { buildAvalonSeatCards } from '@/frontend/components/match/AvalonSeatCard'
import { AvalonKnowledgePanelView } from '@/frontend/components/match/AvalonKnowledgePanel'
import {
  AVALON_BOARD_PRESETS,
  AVALON_DEFAULT_PRESET_ID,
  avalonActionText,
  avalonPresetRoleSummary,
  buildAvalonActionEntries,
  findAvalonPreset,
  type AvalonActionEntryVisible,
} from '@/frontend/components/match/avalon-format'
import {
  AVALON_V2_PREFIX,
  deriveAvalonView,
  emptyAvalonV2,
  reduceAvalonV2Event,
} from '@/frontend/store/projections/avalon-v2'
import { AVALON_ROSTER, avalonEnvelope, scriptedAvalonMatch } from '../../store/projections/avalon-helpers'

const events = scriptedAvalonMatch()

function accAt(upto?: number) {
  return events
    .slice(0, upto === undefined ? undefined : upto + 1)
    .reduce(reduceAvalonV2Event, emptyAvalonV2())
}

const indexOfKind = (kind: string, occurrence = 0): number => {
  const indices = events.map((event, index) => (event.kind === `${AVALON_V2_PREFIX}${kind}` ? index : -1)).filter((i) => i >= 0)
  const found = indices[occurrence]
  if (found === undefined) throw new Error(`no ${kind} event (occurrence ${occurrence})`)
  return found
}

const nameOf = (agentId: string) => AVALON_ROSTER.find((player) => player.agentId === agentId)?.displayName ?? agentId

// 指认前（密谋已发生、身份未揭示）。
const preReveal = accAt(indexOfKind('assassinationDeclared') - 1)

function renderSituation(perspective: 'god' | 'public' | 'player', focus: string | null, acc = preReveal): string {
  const view = deriveAvalonView(acc, perspective, focus)
  return renderToStaticMarkup(
    createElement(AvalonSituationBody, {
      acc,
      view,
      players: AVALON_ROSTER,
      thinkingAgentIds: new Set<string>(),
      matchId: 'match_avalon_panel',
    }),
  )
}

describe('AvalonSituationBody — 三视角渲染', () => {
  it('god 视角：任务板 + 座位卡横排 + 发言全文 + 密谋容器 + 知识面板 + 赛点横幅', () => {
    const html = renderSituation('god', null)
    // 任务板 5 槽 + 赛点条。
    expect(html).toContain('data-testid="avalon-quest-slot-5"')
    expect(html).toContain('data-testid="avalon-match-point"')
    // 座位卡：5 张 + god 角色徽标（梅林）。
    expect(html).toContain('data-testid="avalon-seat-card-p5"')
    expect(html).toContain('data-testid="avalon-role-p1"')
    expect(html).toContain('梅林')
    // 讨论发言全文（载荷透传不截断）。
    expect(html).toContain('第 1 轮 p1 的发言')
    // 密谋容器可见全文（坏人频道）。
    expect(html).toContain('data-testid="avalon-consultation-visible"')
    expect(html).toContain('p4 密谋：我认为 p1 像梅林')
    // 知识面板（god 专属，含派西维尔混排注记）。
    expect(html).toContain('data-testid="avalon-knowledge-panel"')
    expect(html).toContain('混排并列，不标注真伪')
    // 好人 3 成功 → 赛点横幅（「好人还未获胜！」）。
    expect(html).toContain('data-testid="avalon-match-point-banner"')
    expect(html).toContain('好人还未获胜')
  })

  it('public 视角：身份遮蔽 + 密谋占位 + 无知识面板', () => {
    const html = renderSituation('public', null)
    expect(html).not.toContain('data-testid="avalon-role-p1"')
    expect(html).not.toContain('梅林')
    expect(html).not.toContain('p4 密谋')
    expect(html).toContain('data-testid="avalon-consultation-masked"')
    expect(html).toContain('坏人正在密谋（不可见）')
    expect(html).not.toContain('data-testid="avalon-knowledge-panel"')
    // 公共面照常：任务板 / 记名表决 / 刺杀仪式容器。
    expect(html).toContain('data-testid="avalon-quest-board"')
    expect(html).toContain('data-testid="avalon-vote-panel"')
    expect(html).toContain('data-testid="avalon-assassination-panel"')
  })

  it('单玩家视角（p3 好人）：仅本人角色徽标；密谋遮蔽；本人出牌可见', () => {
    const html = renderSituation('player', 'p3')
    expect(html).toContain('data-testid="avalon-role-p3"')
    expect(html).not.toContain('data-testid="avalon-role-p1"')
    expect(html).toContain('data-testid="avalon-consultation-masked"')
    expect(html).toContain('data-testid="avalon-own-choices"')
    expect(html).toContain('第 1 轮 · 成功牌')
  })

  it('终局翻牌：胜方横幅 + 依据 + 全员 reveal（public 视角同样可见）', () => {
    const html = renderSituation('public', null, accAt())
    expect(html).toContain('data-testid="avalon-end-panel"')
    expect(html).toContain('坏人阵营胜利')
    expect(html).toContain('刺杀命中梅林（任务 3:1）')
    expect(html).toContain('data-testid="avalon-reveal-list"')
    // 终局后 public 视角全员翻牌。
    expect(html).toContain('data-testid="avalon-role-p1"')
  })
})

describe('AvalonQuestBoardView — 任务板', () => {
  function basic6Acc() {
    return reduceAvalonV2Event(
      emptyAvalonV2(),
      avalonEnvelope('matchStarted', {
        boardId: 'basic-6',
        boardName: '基础 6 人',
        seats: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, playerId: `p${seat}` })),
        questCount: 5,
        teamSizes: [2, 3, 4, 3, 4],
        doubleFailRounds: [4],
        discussionEnabled: true,
        roles: { merlin: 1, percival: 1, loyalServant: 2, assassin: 1, morgana: 1 },
      }),
    )
  }

  it('双失败轮显式标记（第 4 轮 ×2）', () => {
    const acc = basic6Acc()
    const html = renderToStaticMarkup(
      createElement(AvalonQuestBoardView, {
        quests: acc.quests,
        successes: 0,
        fails: 0,
        round: 1,
        attempt: 1,
        rejectionCount: 0,
        ended: false,
      }),
    )
    expect(html).toContain('data-testid="avalon-quest-slot-4"')
    expect(html).toContain('×2')
    expect(html).toContain('双失败轮：需要 2 张失败牌才判失败')
    expect(html).not.toContain('data-testid="avalon-rejection-warning"')
  })

  it('第 4 次拒绝后显示「再拒一次坏人直接获胜」警示', () => {
    const html = renderToStaticMarkup(
      createElement(AvalonQuestBoardView, {
        quests: basic6Acc().quests,
        successes: 1,
        fails: 1,
        round: 2,
        attempt: 5,
        rejectionCount: 4,
        ended: false,
      }),
    )
    expect(html).toContain('data-testid="avalon-rejection-warning"')
    expect(html).toContain('再拒一次坏人直接获胜')
  })

  it('失败槽显示失败张数（推理锚点）', () => {
    const acc = accAt()
    const html = renderToStaticMarkup(
      createElement(AvalonQuestBoardView, {
        quests: acc.quests,
        successes: 3,
        fails: 1,
        round: 4,
        attempt: 1,
        rejectionCount: 0,
        ended: true,
      }),
    )
    expect(html).toContain('1 张失败牌')
  })
})

describe('buildAvalonSeatCards — 座位卡数据', () => {
  it('队长徽标 / 表决立场时间线（每轮最后一次有效表决）/ 任务参与', () => {
    const view = deriveAvalonView(preReveal, 'god', null)
    const cards = buildAvalonSeatCards(preReveal, view, AVALON_ROSTER, new Set(['p5']))
    const byId = new Map(cards.map((card) => [card.playerId, card]))

    expect(byId.get('p5')?.isLeader).toBe(true)
    expect(byId.get('p1')?.isLeader).toBe(false)
    expect(byId.get('p5')?.thinking).toBe(true)
    // 第 2 轮时间线取第 2 次提案（最后一次有汇总的表决）的记名立场。
    expect(byId.get('p1')?.voteTimeline[1]).toBe(true)
    expect(byId.get('p4')?.voteTimeline[1]).toBe(false)
    // 第 1 轮立场。
    expect(byId.get('p4')?.voteTimeline[0]).toBe(false)
    expect(byId.get('p3')?.voteTimeline[0]).toBe(true)
    // 任务参与：p1 参与 R1/R2/R4。
    expect(byId.get('p1')?.questRounds.map((quest) => quest.round)).toEqual([1, 2, 4])
    expect(byId.get('p1')?.questRounds[1]?.outcome).toBe('fail')
    // god 视角全员角色可见。
    expect(cards.every((card) => card.role !== null)).toBe(true)
  })
})

describe('AvalonKnowledgePanelView — 知识面板（AF-OD-2 v1 简版）', () => {
  it('静态连线：梅林/派西维尔/坏人互识；派西维尔混排并列不标注', () => {
    const html = renderToStaticMarkup(createElement(AvalonKnowledgePanelView, { acc: preReveal, nameOf }))
    expect(html).toContain('data-testid="avalon-knowledge-p1"')
    expect(html).toContain('data-testid="avalon-knowledge-p2"')
    expect(html).toContain('看见坏人（莫德雷德除外）')
    expect(html).toContain('看见梅林与莫甘娜（混排）')
    expect(html).toContain('坏人互识（奥伯伦除外）')
    expect(html).toContain('（混排并列，不标注真伪）')
  })
})

describe('avalon-format — 动作流与预设表', () => {
  it('buildAvalonActionEntries：提案/表决/任务/刺杀/终局条目 + 密谋按视角遮蔽', () => {
    const godView = deriveAvalonView(preReveal, 'god', null)
    const godEntries = buildAvalonActionEntries(preReveal, godView)
    expect(godEntries.some((entry) => entry.kind === 'proposal' && entry.attempt === 2)).toBe(true)
    expect(godEntries.filter((entry) => entry.kind === 'vote' && entry.round === 2)).toHaveLength(2)
    expect(godEntries.filter((entry) => entry.kind === 'quest')).toHaveLength(4)
    const consultation = godEntries.filter(
      (entry): entry is Extract<AvalonActionEntryVisible, { kind: 'statement' }> => entry.kind === 'statement' && !entry.hidden,
    )
    expect(consultation.some((entry) => entry.text.includes('密谋'))).toBe(true)

    const publicView = deriveAvalonView(preReveal, 'public', null)
    const publicEntries = buildAvalonActionEntries(preReveal, publicView)
    const masked = publicEntries.filter(
      (entry): entry is Extract<AvalonActionEntryVisible, { kind: 'statement' }> => entry.kind === 'statement' && entry.hidden,
    )
    expect(masked).toHaveLength(2)
    expect(masked.every((entry) => entry.text === '')).toBe(true)
    expect(avalonActionText(masked[0]!, nameOf)).toBe('坏人正在密谋（不可见）')
  })

  it('avalonActionText：中文动作流口径', () => {
    const view = deriveAvalonView(accAt(), 'god', null)
    const entries = buildAvalonActionEntries(accAt(), view)
    expect(avalonActionText(entries.find((entry) => entry.kind === 'proposal')!, nameOf)).toContain('P1 提名')
    expect(avalonActionText(entries.find((entry) => entry.kind === 'vote')!, nameOf)).toContain('3 赞成 / 2 反对 · 通过')
    expect(avalonActionText(entries.find((entry) => entry.kind === 'quest' && entry.round === 2)!, nameOf)).toContain('1 张失败牌')
    expect(avalonActionText(entries.find((entry) => entry.kind === 'assassination')!, nameOf)).toBe('刺杀指认：P4 指认 P1')
    expect(avalonActionText(entries.find((entry) => entry.kind === 'ended')!, nameOf)).toContain('坏人阵营胜利 · 刺杀命中梅林（任务 3:1）')
  })

  it('板子预设表：9 个预设（5 核心 + 4 扩展），人数 = 角色数之和，扩展板标注', () => {
    expect(AVALON_BOARD_PRESETS).toHaveLength(9)
    expect(AVALON_BOARD_PRESETS.map((preset) => preset.id)).toEqual([
      'basic-5',
      'deceit-5',
      'shadow-5',
      'basic-6',
      'lone-king-6',
      'base-7',
      'base-8',
      'base-9',
      'base-10',
    ])
    for (const preset of AVALON_BOARD_PRESETS) {
      const roleSum = Object.values(preset.roles).reduce((sum, count) => sum + count, 0)
      expect(roleSum, preset.id).toBe(preset.playerCount)
      expect(preset.teamSizes).toHaveLength(5)
      expect(preset.goodCount + preset.evilCount).toBe(preset.playerCount)
      expect(preset.doubleFailRounds.every((round) => round > 1)).toBe(true)
    }
    expect(AVALON_BOARD_PRESETS.filter((preset) => preset.extension).map((preset) => preset.playerCount)).toEqual([7, 8, 9, 10])
  })

  it('核心预设口径：basic-5 / basic-6 的任务人数表与双失败轮（AVR-601）', () => {
    const basic5 = findAvalonPreset('basic-5')
    expect(basic5.teamSizes).toEqual([2, 3, 2, 3, 3])
    expect(basic5.doubleFailRounds).toEqual([])
    expect(basic5.roles).toMatchObject({ merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 })
    const basic6 = findAvalonPreset('basic-6')
    expect(basic6.teamSizes).toEqual([2, 3, 4, 3, 4])
    expect(basic6.doubleFailRounds).toEqual([4])
    // 欺瞒 5 人 = 爪牙→莫甘娜；影主 5 人 = 爪牙→莫德雷德。
    expect(findAvalonPreset('deceit-5').roles).toMatchObject({ morgana: 1, minion: 0 })
    expect(findAvalonPreset('shadow-5').roles).toMatchObject({ mordred: 1, minion: 0 })
    expect(findAvalonPreset('lone-king-6').roles).toMatchObject({ oberon: 1, morgana: 0 })
    // 未知 id 回落默认板。
    expect(findAvalonPreset('no-such-board').id).toBe(AVALON_DEFAULT_PRESET_ID)
  })

  it('预设角色构成文案：阵营分组中文名', () => {
    const summary = avalonPresetRoleSummary(findAvalonPreset('basic-5'))
    expect(summary.good).toBe('梅林、派西维尔、忠诚仆从')
    expect(summary.evil).toBe('刺客、爪牙')
    const summary6 = avalonPresetRoleSummary(findAvalonPreset('basic-6'))
    expect(summary6.good).toBe('梅林、派西维尔、忠诚仆从×2')
    expect(summary6.evil).toBe('刺客、莫甘娜')
  })
})
