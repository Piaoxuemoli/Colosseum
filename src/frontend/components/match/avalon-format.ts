// 阿瓦隆观战组件共享的纯格式层：角色/阵营/阶段中文标签、发言流（动作流）
// 文本构建、板子预设表（组局面展示用）。零 React / store 依赖——组件与
// 单测共用（对齐 commentary-format.ts 的做法）。

import {
  avalonCurrentTeamOf,
  avalonFactionOfRole,
  avalonScoreOf,
  type AvalonPhase,
  type AvalonRole,
  type AvalonView,
  type AvalonV2Accumulator,
} from '@/frontend/store/projections/avalon-v2'

export const AVALON_ROLE_ZH: Record<AvalonRole, string> = {
  merlin: '梅林',
  percival: '派西维尔',
  loyalServant: '忠诚仆从',
  assassin: '刺客',
  morgana: '莫甘娜',
  mordred: '莫德雷德',
  oberon: '奥伯伦',
  minion: '爪牙',
}

export function avalonRoleZh(role: string): string {
  return AVALON_ROLE_ZH[role as AvalonRole] ?? role
}

export const AVALON_FACTION_ZH: Record<'good' | 'evil', string> = {
  good: '好人',
  evil: '坏人',
}

export const AVALON_PHASE_ZH: Record<AvalonPhase, string> = {
  discussion: '讨论',
  proposal: '提名',
  teamVote: '队伍表决',
  quest: '任务执行',
  evilConsultation: '刺杀合议',
  assassination: '刺杀指认',
  ended: '终局',
}

export function avalonPhaseZh(phase: string | null): string {
  if (!phase) return '等待开局'
  return AVALON_PHASE_ZH[phase as AvalonPhase] ?? phase
}

export const AVALON_INSIGHT_ZH: Record<'merlin' | 'percival' | 'evil', string> = {
  merlin: '看见坏人（莫德雷德除外）',
  percival: '看见梅林与莫甘娜（混排）',
  evil: '坏人互识（奥伯伦除外）',
}

// ---------------------------------------------------------------------------
// 发言流 / 动作流（FR-4.4-03 口径：统一中文动作流，按轮次分组）
// ---------------------------------------------------------------------------

export type AvalonActionEntry =
  | { kind: 'phase'; round: number; text: string }
  | { kind: 'statement'; round: number; speakerId: string; text: string; hidden: boolean; isDefault: boolean }
  | { kind: 'proposal'; round: number; attempt: number; leaderId: string; teamIds: string[] }
  | { kind: 'vote'; round: number; attempt: number; votes: Array<{ voterId: string; approve: boolean }>; outcome: 'approved' | 'rejected'; approvals: number; rejections: number }
  | { kind: 'quest'; round: number; outcome: 'success' | 'fail'; failVotes: number; requiredFails: number; teamSize: number }
  | { kind: 'assassination'; round: number; assassinId: string; targetId: string }
  | { kind: 'ended'; round: number; text: string }

export type AvalonActionEntryVisible = AvalonActionEntry & { hidden: boolean }

/**
 * 从 accumulator + 视图构建统一动作流（按到达序；发言文本按视角遮蔽）。
 * hidden=true 的条目只呈现占位语义（密谋内容不可见），不携带文本。
 */
export function buildAvalonActionEntries(acc: AvalonV2Accumulator, view: AvalonView): AvalonActionEntryVisible[] {
  const entries: Array<AvalonActionEntry & { hidden: boolean }> = []

  for (const statement of view.statements) {
    entries.push({
      kind: 'statement',
      round: statement.round,
      speakerId: statement.speakerId,
      // 遮蔽条目不携带文本（hidden=true 时渲染占位语义）。
      text: statement.hidden ? '' : statement.text,
      hidden: statement.hidden,
      isDefault: statement.isDefault,
    })
  }
  for (const proposal of acc.proposals) {
    entries.push({ kind: 'proposal', hidden: false, ...proposal })
  }
  for (const tally of acc.voteTallies) {
    const votes = acc.voteRecords
      .filter((record) => record.round === tally.round && record.attempt === tally.attempt)
      .map((record) => ({ voterId: record.voterId, approve: record.approve }))
    entries.push({ kind: 'vote', hidden: false, round: tally.round, attempt: tally.attempt, votes, outcome: tally.outcome, approvals: tally.approvals, rejections: tally.rejections })
  }
  for (const quest of acc.quests) {
    if (quest.status === 'success' || quest.status === 'fail') {
      entries.push({
        kind: 'quest',
        hidden: false,
        round: quest.round,
        outcome: quest.status,
        failVotes: quest.failVotes ?? 0,
        requiredFails: quest.requiredFails,
        teamSize: quest.teamSize,
      })
    }
  }
  if (acc.assassination) {
    entries.push({ kind: 'assassination', hidden: false, round: acc.round, assassinId: acc.assassination.assassinId, targetId: acc.assassination.targetId })
  }
  if (acc.ended) {
    const winnerZh = acc.ended.winner === 'good' ? '好人阵营胜利' : acc.ended.winner === 'evil' ? '坏人阵营胜利' : '平局'
    entries.push({ kind: 'ended', hidden: false, round: acc.round, text: `${winnerZh} · ${acc.ended.basis}` })
  }

  // 同轮内保持到达序（Array#sort 稳定）；跨轮按轮次归组。
  return entries.sort((a, b) => a.round - b.round)
}

/** 动作流条目 → 中文一句话（发言条目由组件单独呈现全文）。 */
export function avalonActionText(
  entry: AvalonActionEntryVisible,
  nameOf: (agentId: string) => string,
): string {
  switch (entry.kind) {
    case 'phase':
      return entry.text
    case 'statement':
      return entry.hidden
        ? '坏人正在密谋（不可见）'
        : `${nameOf(entry.speakerId)}：${entry.text}`
    case 'proposal':
      return `第 ${entry.round} 轮 · 第 ${entry.attempt} 次提案：${nameOf(entry.leaderId)} 提名 ${entry.teamIds.map(nameOf).join('、')}`
    case 'vote': {
      const outcome = entry.outcome === 'approved' ? '通过' : '被拒'
      return `第 ${entry.round} 轮 · 第 ${entry.attempt} 次表决：${entry.approvals} 赞成 / ${entry.rejections} 反对 · ${outcome}`
    }
    case 'quest':
      return entry.outcome === 'success'
        ? `第 ${entry.round} 轮任务成功（${entry.teamSize} 人队伍）`
        : `第 ${entry.round} 轮任务失败（${entry.failVotes} 张失败牌 / 需 ${entry.requiredFails} 张）`
    case 'assassination':
      return `刺杀指认：${nameOf(entry.assassinId)} 指认 ${nameOf(entry.targetId)}`
    case 'ended':
      return entry.text
  }
}

// ---------------------------------------------------------------------------
// 板子预设（组局配置面展示用；与引擎侧同表，AVR-601）
// ---------------------------------------------------------------------------

export type AvalonBoardPreset = {
  id: string
  name: string
  playerCount: number
  /** 好人 / 坏人人数。 */
  goodCount: number
  evilCount: number
  /** 角色构成（角色 → 数量；与 matchStarted.roles 同构）。 */
  roles: Record<AvalonRole, number>
  /** 每轮任务人数（轮 1–5）。 */
  teamSizes: number[]
  /** 双失败轮（需要 2 张失败牌的轮次）。 */
  doubleFailRounds: number[]
  /** 扩展板标注（7–10 人，引擎测试覆盖）。 */
  extension: boolean
}

function preset(
  id: string,
  name: string,
  roles: Partial<Record<AvalonRole, number>>,
  teamSizes: number[],
  doubleFailRounds: number[],
  extension = false,
): AvalonBoardPreset {
  const full: Record<AvalonRole, number> = {
    merlin: roles.merlin ?? 0,
    percival: roles.percival ?? 0,
    loyalServant: roles.loyalServant ?? 0,
    assassin: roles.assassin ?? 0,
    morgana: roles.morgana ?? 0,
    mordred: roles.mordred ?? 0,
    oberon: roles.oberon ?? 0,
    minion: roles.minion ?? 0,
  }
  const playerCount = Object.values(full).reduce((sum, count) => sum + count, 0)
  const evilCount = full.assassin + full.morgana + full.mordred + full.oberon + full.minion
  return { id, name, playerCount, goodCount: playerCount - evilCount, evilCount, roles: full, teamSizes, doubleFailRounds, extension }
}

/** v1 内置板子（任务书冻结口径：6 核心预设 + 4 扩展板）。 */
export const AVALON_BOARD_PRESETS: AvalonBoardPreset[] = [
  preset('basic-5', '基础 5 人', { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 }, [2, 3, 2, 3, 3], []),
  preset('deceit-5', '欺瞒 5 人', { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, morgana: 1 }, [2, 3, 2, 3, 3], []),
  preset('shadow-5', '影主 5 人', { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, mordred: 1 }, [2, 3, 2, 3, 3], []),
  preset('basic-6', '基础 6 人', { merlin: 1, percival: 1, loyalServant: 2, assassin: 1, morgana: 1 }, [2, 3, 4, 3, 4], [4]),
  preset('lone-king-6', '孤王 6 人', { merlin: 1, percival: 1, loyalServant: 2, assassin: 1, oberon: 1 }, [2, 3, 4, 3, 4], [4]),
  preset('base-7', '基础 7 人', { merlin: 1, percival: 1, loyalServant: 2, assassin: 1, morgana: 1, minion: 1 }, [2, 3, 3, 4, 4], [4], true),
  preset('base-8', '基础 8 人', { merlin: 1, percival: 1, loyalServant: 3, assassin: 1, morgana: 1, minion: 1 }, [3, 4, 4, 5, 5], [4], true),
  preset('base-9', '基础 9 人', { merlin: 1, percival: 1, loyalServant: 4, assassin: 1, morgana: 1, minion: 1 }, [3, 4, 4, 5, 5], [4], true),
  preset('base-10', '基础 10 人', { merlin: 1, percival: 1, loyalServant: 4, assassin: 1, morgana: 1, mordred: 1, minion: 1 }, [3, 4, 4, 5, 5], [4], true),
]

export const AVALON_DEFAULT_PRESET_ID = 'basic-5'

export function findAvalonPreset(id: string): AvalonBoardPreset {
  return AVALON_BOARD_PRESETS.find((candidate) => candidate.id === id) ?? AVALON_BOARD_PRESETS[0]
}

/** 预设的角色构成 → 展示文案（「梅林、派西维尔、忠诚仆从 vs 刺客、爪牙」）。 */
export function avalonPresetRoleSummary(p: AvalonBoardPreset): { good: string; evil: string } {
  const names = (faction: 'good' | 'evil'): string[] => {
    const parts: string[] = []
    for (const [role, count] of Object.entries(p.roles) as Array<[AvalonRole, number]>) {
      if (count > 0 && avalonFactionOfRole(role) === faction) {
        parts.push(count > 1 ? `${avalonRoleZh(role)}×${count}` : avalonRoleZh(role))
      }
    }
    return parts
  }
  return { good: names('good').join('、'), evil: names('evil').join('、') }
}

/** 任务板状态速览文本（状态面板/组局摘要共用）。 */
export function avalonScoreText(acc: AvalonV2Accumulator): string {
  const { successes, fails } = avalonScoreOf(acc)
  return `任务 ${successes} : ${fails}`
}

/** 当前任务队伍文本（供状态面板）。 */
export function avalonTeamText(acc: AvalonV2Accumulator, nameOf: (id: string) => string): string {
  const team = avalonCurrentTeamOf(acc)
  return team.length > 0 ? team.map(nameOf).join('、') : '—'
}
