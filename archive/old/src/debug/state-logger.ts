/**
 * Debug State Logger — 记录关键状态到内存，结束后导出为 JSON 文件
 *
 * 日志事件类型:
 * - NEW_HAND: 新手开始时的完整引擎状态
 * - LLM_PROMPT: LLM 收到的 prompt 数据（手牌/公共牌/底池/可用操作）
 * - LLM_DECISION: LLM 返回的决策 + thinking 摘要
 * - ACTION_EXEC: 引擎执行动作后的状态快照
 * - SYNC_STATE: syncState 推送给 UI 的状态快照
 * - STALE_ABORT: stale hand 检测触发中断
 * - PHASE_CHANGE: 阶段变化（preflop→flop 等）
 * - SHOWDOWN: 本手结束
 */

import type { GameState } from '../types/game'

export interface StateLogEntry {
  ts: number               // Date.now()
  event: string            // 事件类型
  handNumber: number
  phase: string
  /** 以下字段按事件类型可选填充 */
  playerId?: string
  playerName?: string
  holeCards?: string       // "Ah Ks"
  communityCards?: string  // "Th Js 2d"
  pot?: number
  chips?: number           // 当前玩家筹码
  validActions?: string    // "fold,call,raise"
  decision?: string        // "call"
  decisionAmount?: number
  thinkingSnippet?: string // thinking 前 80 字
  players?: { id: string; name: string; chips: number; status: string; currentBet: number }[]
  storeHandNumber?: number // store 中的 handNumber（用于对比）
  storePhase?: string
  storePot?: number
  detail?: string          // 自由文本说明
}

/** 内存中的日志缓冲区 */
const logBuffer: StateLogEntry[] = []

/** 是否启用日志 */
let enabled = true

export function enableStateLogger(on: boolean) {
  enabled = on
}

export function logState(entry: Omit<StateLogEntry, 'ts'>) {
  if (!enabled) return
  logBuffer.push({ ts: Date.now(), ...entry })
}

/** 从 GameState 提取紧凑的玩家摘要 */
export function snapshotPlayers(state: GameState) {
  return state.players.map(p => ({
    id: p.id,
    name: p.name,
    chips: p.chips,
    status: p.status,
    currentBet: p.currentBet,
  }))
}

/** 卡片数组转字符串 */
export function cardsStr(cards: { rank: string; suit: string }[]): string {
  const suitChar: Record<string, string> = { hearts: 'h', diamonds: 'd', clubs: 'c', spades: 's' }
  return cards.map(c => `${c.rank}${suitChar[c.suit] || c.suit}`).join(' ')
}

/** 获取当前日志条数 */
export function getLogCount(): number {
  return logBuffer.length
}

/** 导出所有日志并下载为 JSON 文件 */
export function exportLogs(): StateLogEntry[] {
  return [...logBuffer]
}

/** 清空日志 */
export function clearLogs() {
  logBuffer.length = 0
}

/** 下载日志为 JSON 文件（浏览器端） */
export function downloadLogs() {
  const data = JSON.stringify(logBuffer, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `poker-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}
