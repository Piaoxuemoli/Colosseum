// engine2 v2 投影共享工具（spec：docs/specs/engine2-integration.md §3/§6）。
//
// 落库/SSE 信封：kind = `${gameType}:v2:${engine2Kind}`，payload 为 engine2
// 事件本体逐字段平铺（含 audience）。本目录的投影模块消费该信封，产出与现有
// UI 组件兼容的 view model；本文件只放两游戏共用的解析小工具。

import type { GameEvent } from '@/platform/core/types'

/** 观战视角（spec §6 / PK-1 已代决：两游戏观战默认上帝视角）。 */
export type ViewMode = 'god' | 'public'

export const POKER_V2_PREFIX = 'poker:v2:'
export const WEREWOLF_V2_PREFIX = 'werewolf:v2:'

export function isPokerV2Event(event: Pick<GameEvent, 'kind'>): boolean {
  return event.kind.startsWith(POKER_V2_PREFIX)
}

export function isWerewolfV2Event(event: Pick<GameEvent, 'kind'>): boolean {
  return event.kind.startsWith(WEREWOLF_V2_PREFIX)
}

/** 信封 kind → engine2 kind（去掉 `${gameType}:v2:` 前缀）。 */
export function engineKindOf(event: Pick<GameEvent, 'kind'>, prefix: string): string {
  return event.kind.slice(prefix.length)
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function stringOr(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' ? value : fallback
}

export function stringArrayOr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** engine2 牌面（{ rank, suit }）→ 前端 CardVisual；形状一致，仅做净化。 */
export function cardsOr(value: unknown): Array<{ rank: string; suit: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const raw = asRecord(item)
    const rank = raw ? stringOr(raw.rank) : null
    const suit = raw ? stringOr(raw.suit) : null
    return rank && suit ? [{ rank, suit }] : []
  })
}

/**
 * engine2 audience → 可见性谓词（延迟公开的到期判定由各投影模块按游戏语义做）。
 * - public：两视角都可见；
 * - 其余（self/wolves/role-self/moderator/delayed-public）：god 全量；public 视
 *   视角规则收敛（夜间动作隐藏、底牌手结后揭示等，见各投影模块）。
 */
export function isPublicAudience(audience: unknown): boolean {
  const raw = asRecord(audience)
  return raw?.kind === 'public'
}
