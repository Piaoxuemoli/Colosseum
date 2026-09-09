// Avalon engine v2 — 板子预设与配置解析（AVR-101 / AVR-601 / AVR-602）。
//
// 任何对局由板子配置完整定义：v1 内置 9 种预设（basic-5 … base-10），同时
// 接受显式自定义配置（人数 5–10，阵营配比与任务人数表对齐标准板子表）。
// 非法配置在开局前结构化拒绝（人数与角色数不符 / 阵营配比错 / 未知角色 /
// 参数越域）。纯逻辑，无 IO。

import type { AvalonRoleId, BoardPreset, ResolvedBoard } from './types'
import { MAX_SEATS, MIN_SEATS, QUEST_COUNT, STANDARD_BOARD_TABLE, factionOf } from './types'

// ---------------------------------------------------------------------------
// AVR-601 v1 内置板子（9 种）
// ---------------------------------------------------------------------------

export const AVALON_PRESETS: Record<string, BoardPreset> = {
  'basic-5': {
    id: 'basic-5',
    name: '基础 5 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, minion: 1 },
    teamSizes: [2, 3, 2, 3, 3],
    doubleFailRounds: [],
    discussionEnabled: true,
  },
  'deceit-5': {
    id: 'deceit-5',
    name: '欺瞒 5 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, morgana: 1 },
    teamSizes: [2, 3, 2, 3, 3],
    doubleFailRounds: [],
    discussionEnabled: true,
  },
  'shadow-5': {
    id: 'shadow-5',
    name: '影主 5 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 1, assassin: 1, mordred: 1 },
    teamSizes: [2, 3, 2, 3, 3],
    doubleFailRounds: [],
    discussionEnabled: true,
  },
  'basic-6': {
    id: 'basic-6',
    name: '基础 6 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 2, assassin: 1, morgana: 1 },
    teamSizes: [2, 3, 4, 3, 4],
    doubleFailRounds: [4],
    discussionEnabled: true,
  },
  'lone-king-6': {
    id: 'lone-king-6',
    name: '孤王 6 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 2, assassin: 1, oberon: 1 },
    teamSizes: [2, 3, 4, 3, 4],
    doubleFailRounds: [4],
    discussionEnabled: true,
  },
  'base-7': {
    id: 'base-7',
    name: '基础 7 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 2, assassin: 1, morgana: 1, minion: 1 },
    teamSizes: [2, 3, 3, 4, 4],
    doubleFailRounds: [4],
    discussionEnabled: true,
  },
  'base-8': {
    id: 'base-8',
    name: '基础 8 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 3, assassin: 1, morgana: 1, minion: 1 },
    teamSizes: [3, 4, 4, 5, 5],
    doubleFailRounds: [4],
    discussionEnabled: true,
  },
  'base-9': {
    id: 'base-9',
    name: '基础 9 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 4, assassin: 1, morgana: 1, minion: 1 },
    teamSizes: [3, 4, 4, 5, 5],
    doubleFailRounds: [4],
    discussionEnabled: true,
  },
  'base-10': {
    id: 'base-10',
    name: '基础 10 人板',
    roles: { merlin: 1, percival: 1, loyalServant: 4, assassin: 1, morgana: 1, mordred: 1, minion: 1 },
    teamSizes: [3, 4, 4, 5, 5],
    doubleFailRounds: [4],
    discussionEnabled: true,
  },
}

export const AVALON_PRESET_IDS = Object.keys(AVALON_PRESETS)

/** 特殊角色唯一性约束（梅林恰好 1；每个特殊坏人 ≤ 1；仆从/爪牙可多张）。 */
const UNIQUE_ROLES: readonly AvalonRoleId[] = ['merlin', 'percival', 'morgana', 'mordred', 'oberon', 'assassin']

export type BoardIssue = { field: string; code: string; message: string }

export type ResolvedBoardResult = { ok: true; board: ResolvedBoard } | { ok: false; issues: BoardIssue[] }

function isRoleId(value: string): value is AvalonRoleId {
  return (
    value === 'merlin' ||
    value === 'percival' ||
    value === 'loyalServant' ||
    value === 'assassin' ||
    value === 'morgana' ||
    value === 'mordred' ||
    value === 'oberon' ||
    value === 'minion'
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析板子配置：`{ preset }` 引用内置预设（可覆盖 discussionEnabled），
 * 或显式 `{ roles, teamSizes, ... }` 自定义配置。未知预设 / 非法组合拒绝。
 */
export function resolveBoard(config: unknown): ResolvedBoardResult {
  if (!isPlainObject(config)) {
    return { ok: false, issues: [{ field: 'board', code: 'invalid-config', message: '板子配置必须是对象' }] }
  }

  const presetId = typeof config.preset === 'string' ? config.preset : null
  if (presetId !== null) {
    const preset = AVALON_PRESETS[presetId]
    if (!preset) {
      return {
        ok: false,
        issues: [
          {
            field: 'preset',
            code: 'unknown-preset',
            message: `未知板子预设 "${presetId}"（可用：${AVALON_PRESET_IDS.join(', ')}）`,
          },
        ],
      }
    }
    const board: ResolvedBoard = {
      id: preset.id,
      name: preset.name,
      roles: { ...preset.roles },
      teamSizes: [...preset.teamSizes],
      doubleFailRounds: [...preset.doubleFailRounds],
      discussionEnabled:
        typeof config.discussionEnabled === 'boolean' ? config.discussionEnabled : (preset.discussionEnabled ?? true),
    }
    return validateBoard(board)
  }

  // 显式自定义配置（AVR-101：板子标识 = 预设引用或显式配置）。
  const rolesRaw = config.roles
  if (!isPlainObject(rolesRaw)) {
    return {
      ok: false,
      issues: [{ field: 'roles', code: 'missing-roles', message: '自定义板必须提供 roles（{角色: 数量}）' }],
    }
  }
  const roles: Partial<Record<AvalonRoleId, number>> = {}
  for (const [key, value] of Object.entries(rolesRaw)) {
    if (!isRoleId(key)) {
      return { ok: false, issues: [{ field: `roles.${key}`, code: 'unknown-role', message: `未知角色 "${key}"` }] }
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return {
        ok: false,
        issues: [{ field: `roles.${key}`, code: 'invalid-count', message: `角色 "${key}" 数量必须是非负整数` }],
      }
    }
    if (value > 0) roles[key] = value
  }

  const teamSizesRaw = config.teamSizes
  if (!Array.isArray(teamSizesRaw) || teamSizesRaw.length !== QUEST_COUNT) {
    return {
      ok: false,
      issues: [{ field: 'teamSizes', code: 'invalid-team-sizes', message: `teamSizes 必须是长度 ${QUEST_COUNT} 的数组` }],
    }
  }
  for (const [index, size] of teamSizesRaw.entries()) {
    if (typeof size !== 'number' || !Number.isInteger(size)) {
      return {
        ok: false,
        issues: [{ field: `teamSizes.${index}`, code: 'invalid-team-size', message: `第 ${index + 1} 轮任务人数必须是整数` }],
      }
    }
  }

  const doubleFailRaw = Array.isArray(config.doubleFailRounds) ? config.doubleFailRounds : []
  const doubleFailRounds: number[] = []
  for (const value of doubleFailRaw) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return {
        ok: false,
        issues: [{ field: 'doubleFailRounds', code: 'invalid-round', message: 'doubleFailRounds 必须是整数数组' }],
      }
    }
    doubleFailRounds.push(value)
  }

  const board: ResolvedBoard = {
    id: typeof config.id === 'string' && config.id.length > 0 ? config.id : 'custom',
    name: typeof config.name === 'string' && config.name.length > 0 ? config.name : '自定义板',
    roles,
    teamSizes: [...teamSizesRaw],
    doubleFailRounds,
    discussionEnabled: typeof config.discussionEnabled === 'boolean' ? config.discussionEnabled : true,
  }
  return validateBoard(board)
}

/**
 * 板子合法性（AVR-101 验收第 2 条）：人数与角色数一致、阵营配比符合标准
 * 板子表、好人必含梅林、特殊角色唯一、任务人数与双失败轮参数在值域内。
 */
export function validateBoard(board: ResolvedBoard): ResolvedBoardResult {
  const issues: BoardIssue[] = []

  const seats = Object.values(board.roles).reduce((sum, count) => sum + count, 0)
  if (seats < MIN_SEATS || seats > MAX_SEATS) {
    issues.push({
      field: 'roles',
      code: 'seats-out-of-range',
      message: `板子人数必须在 ${MIN_SEATS}–${MAX_SEATS} 之间，当前角色总数 ${seats}`,
    })
  }

  for (const role of UNIQUE_ROLES) {
    const count = board.roles[role] ?? 0
    if (count > 1) {
      issues.push({
        field: `roles.${role}`,
        code: 'duplicate-special-role',
        message: `${role} 最多 1 张，当前 ${count} 张`,
      })
    }
  }
  if ((board.roles.merlin ?? 0) !== 1) {
    issues.push({ field: 'roles.merlin', code: 'merlin-required', message: '好人阵营必须恰好包含 1 名梅林' })
  }

  const standard = STANDARD_BOARD_TABLE.find((row) => row.seats === seats)
  if (standard) {
    const good = Object.entries(board.roles)
      .filter(([role]) => factionOf(role as AvalonRoleId) === 'good')
      .reduce((sum, [, count]) => sum + count, 0)
    const evil = seats - good
    if (good !== standard.good || evil !== standard.evil) {
      issues.push({
        field: 'roles',
        code: 'faction-ratio-mismatch',
        message: `${seats} 人板阵营配比应为 好 ${standard.good} / 坏 ${standard.evil}，当前 好 ${good} / 坏 ${evil}`,
      })
    }
  }

  if (board.teamSizes.length !== QUEST_COUNT) {
    issues.push({
      field: 'teamSizes',
      code: 'invalid-length',
      message: `teamSizes 长度必须等于任务轮数 ${QUEST_COUNT}`,
    })
  }
  for (const [index, size] of board.teamSizes.entries()) {
    if (size < 2 || size > seats) {
      issues.push({
        field: `teamSizes.${index}`,
        code: 'team-size-out-of-range',
        message: `第 ${index + 1} 轮任务人数 ${size} 越域（2–${seats}）`,
      })
    }
  }

  if (new Set(board.doubleFailRounds).size !== board.doubleFailRounds.length) {
    issues.push({ field: 'doubleFailRounds', code: 'duplicate-round', message: 'doubleFailRounds 不得重复' })
  }
  for (const round of board.doubleFailRounds) {
    if (round <= 1 || round > QUEST_COUNT) {
      issues.push({
        field: 'doubleFailRounds',
        code: 'round-out-of-range',
        message: `双失败轮 ${round} 越域（仅允许 2–${QUEST_COUNT} 的轮次）`,
      })
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, board }
}

/** 本轮判失败所需张数（双失败轮 2 / 普通轮 1，AVR-401/402）。 */
export function requiredFailsOf(board: ResolvedBoard, round: number): number {
  return board.doubleFailRounds.includes(round) ? 2 : 1
}
