import type { Card } from './card'

export type PlayerType = 'human' | 'bot' | 'llm'
export type PlayerStatus = 'active' | 'folded' | 'allIn' | 'sittingOut' | 'eliminated'

/** 结构化 4 维度印象评分 */
export interface StructuredImpression {
  /** 入池意愿 1-10: 1=极紧, 10=极松 */
  looseness: number
  /** 攻击性 1-10: 1=被动, 10=激进 */
  aggression: number
  /** 抗弃牌 1-10: 1=容易弃牌, 10=死不弃牌 */
  stickiness: number
  /** 诚实度 1-10: 1=纯诈唬, 10=从不诈唬 */
  honesty: number
  /** ≤30 字备注 */
  note: string
  /** EMA 观察手数 */
  handCount: number
}

export const DEFAULT_IMPRESSION: StructuredImpression = {
  looseness: 5, aggression: 5, stickiness: 5, honesty: 5, note: '', handCount: 0,
}

export interface Player {
  id: string
  name: string
  type: PlayerType
  chips: number
  status: PlayerStatus
  holeCards: Card[]
  currentBet: number
  totalBetThisRound: number
  seatIndex: number
  hasActed: boolean
  /** LLM only: reference to API profile */
  profileId?: string
  /** LLM only: custom system prompt / role description */
  systemPrompt?: string
  /** LLM only: structured impressions of other players, keyed by playerId */
  impressions?: Map<string, StructuredImpression>
}
