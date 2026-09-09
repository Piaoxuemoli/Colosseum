// 回放阶段跳转（FR-4.6-02）：从事件流推导「阶段边界」——德州扑克按手
// （hand-started），狼人杀按昼夜轮次（phaseEntered 的 day/night 切换）。
//
// 纯函数模块：只读事件数组，产出边界列表与导航结果；seek 由调用方经
// replay-store.seekTo 完成（不引入新请求）。v2 信封优先，legacy 事件
// （poker/hand-start、werewolf/moderator-narrate 的 day 变化）尽力推导。

import type { GameEvent } from '@/platform/core/types'
import { asRecord, numberOr, stringOr } from './common'
import { avalonReplayBoundaries } from './avalon-v2'

/** 一个可跳转的阶段边界。`seekIndex` = 边界事件下标 + 1（seek 后该边界事件已被应用）。 */
export type ReplayBoundary = {
  seekIndex: number
  /** 展示标签，如「第 2 手」「第 3 夜」「第 2 天」。 */
  label: string
  /** 边界类型：手（牌桌类）或阶段（社交推理类昼夜）。 */
  kind: 'hand' | 'phase'
  /** 手号 / 天（夜）序号。 */
  value: number
}

export type ReplayBoundaryGame = 'poker' | 'werewolf' | 'avalon'

/** 从事件流探测游戏品类（v2 前缀优先，legacy kind 兜底）。 */
export function detectGameOfEvents(events: GameEvent[]): ReplayBoundaryGame | null {
  for (const event of events) {
    if (event.kind.startsWith('poker:')) return 'poker'
    if (event.kind.startsWith('werewolf:')) return 'werewolf'
    if (event.kind.startsWith('avalon:')) return 'avalon'
  }
  for (const event of events) {
    if (event.kind.startsWith('poker/')) return 'poker'
    if (event.kind.startsWith('werewolf/')) return 'werewolf'
  }
  return null
}

/** 狼人杀 night(day=N) 展示为「第 N+1 夜」、day(day=N) 为「第 N 天」（day 只在夜→昼翻转时 +1）。 */
function werewolfPhaseLabel(day: number, isNight: boolean): string {
  return isNight ? `第 ${day + 1} 夜` : `第 ${day} 天`
}

/** 阶段前缀：PhaseId 形如 `night.wolves` / `day.vote`（legacy 流可能为 `night/x`）。 */
function phasePrefix(phase: string): string {
  return phase.split(/[./]/)[0] ?? ''
}

function pokerBoundaries(events: GameEvent[]): ReplayBoundary[] {
  const boundaries: ReplayBoundary[] = []
  for (const [index, event] of events.entries()) {
    if (event.kind === 'poker:v2:hand-started') {
      const payload = asRecord(event.payload) ?? {}
      const hand = numberOr(payload.handNumber, numberOr(payload.hand, 0))
      boundaries.push({
        seekIndex: index + 1,
        label: `第 ${hand} 手`,
        kind: 'hand',
        value: hand,
      })
    } else if (event.kind === 'poker/hand-start') {
      const payload = asRecord(event.payload) ?? {}
      const hand = numberOr(payload.handNumber, 0)
      if (hand > 0) {
        boundaries.push({ seekIndex: index + 1, label: `第 ${hand} 手`, kind: 'hand', value: hand })
      }
    }
  }
  return boundaries
}

function werewolfBoundaries(events: GameEvent[]): ReplayBoundary[] {
  const boundaries: ReplayBoundary[] = []
  let lastPrefix = ''
  let narrateDay = 0

  for (const [index, event] of events.entries()) {
    if (event.kind === 'werewolf:v2:phaseEntered') {
      const envelope = asRecord(event.payload) ?? {}
      const inner = asRecord(envelope.payload) ?? {}
      const phase = stringOr(inner.phase)
      if (!phase) continue
      const prefix = phasePrefix(phase)
      if (prefix !== 'day' && prefix !== 'night') continue
      // 只有昼夜真正切换时才落边界（同阶段内的细分 phase 不重复计）。
      if (prefix === lastPrefix) continue
      lastPrefix = prefix
      const day = numberOr(envelope.day, 1)
      boundaries.push({
        seekIndex: index + 1,
        label: werewolfPhaseLabel(day, prefix === 'night'),
        kind: 'phase',
        value: day,
      })
    } else if (event.kind === 'werewolf/moderator-narrate') {
      // legacy：主持人宣告按 day 推进，day 增长即新的「天」边界（尽力推导）。
      const payload = asRecord(event.payload) ?? {}
      const day = numberOr(payload.day, 0)
      if (day > narrateDay) {
        narrateDay = day
        boundaries.push({ seekIndex: index + 1, label: `第 ${day} 天`, kind: 'phase', value: day })
      }
    }
  }
  return boundaries
}

/**
 * 推导阶段边界列表（按事件顺序）。识别不了的游戏 / 无边界事件 → 空数组
 * （调用方隐藏跳转 UI）。
 */
export function computeReplayBoundaries(events: GameEvent[]): ReplayBoundary[] {
  const game = detectGameOfEvents(events)
  if (game === 'poker') return pokerBoundaries(events)
  if (game === 'werewolf') return werewolfBoundaries(events)
  // 阿瓦隆：任务轮次 + 刺杀环节（avalon-v2 的边界推导与本模块形状对齐）。
  if (game === 'avalon') return avalonReplayBoundaries(events)
  return []
}

/** cursor 当前所处的边界下标（最后一个 seekIndex <= cursor 的边界）；无则 -1。 */
export function activeBoundaryIndex(boundaries: ReplayBoundary[], cursor: number): number {
  let active = -1
  for (const [index, boundary] of boundaries.entries()) {
    if (boundary.seekIndex <= cursor) active = index
    else break
  }
  return active
}

/** cursor 之后的下一个边界（无则 null）。 */
export function nextBoundary(boundaries: ReplayBoundary[], cursor: number): ReplayBoundary | null {
  return boundaries.find((boundary) => boundary.seekIndex > cursor) ?? null
}

/** cursor 之前的上一个边界（无则 null）。cursor 恰在边界上时返回更早一个。 */
export function prevBoundary(boundaries: ReplayBoundary[], cursor: number): ReplayBoundary | null {
  let prev: ReplayBoundary | null = null
  for (const boundary of boundaries) {
    if (boundary.seekIndex < cursor) prev = boundary
    else break
  }
  return prev
}
