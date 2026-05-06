import Dexie, { type Table } from 'dexie'
import type { HandHistory } from '../types/history'
import type { APIProfile } from '../agent/llm-client'
import type { SerializedEngine } from '../games/poker/engine/poker-engine'
import type { StructuredImpression } from '../types/player'

export interface SessionRecord {
  id: string
  timestamp: number
  seats: SessionSeatConfig[]
  smallBlind: number
  bigBlind: number
  minActionInterval: number
  thinkingTimeout: number
}

export interface SessionSeatConfig {
  seatIndex: number
  type: 'human' | 'llm' | 'bot' | 'empty'
  name: string
  profileId?: string
  systemPrompt?: string
  useCustomPrompt?: boolean
}

export interface ImpressionRecord {
  sessionId: string
  playerId: string
  impressions: Record<string, string> // targetPlayerId -> impression
}

/** 跨对局结构化印象记录 */
export interface StructuredImpressionRecord {
  observerProfileId: string
  targetName: string
  impression: StructuredImpression
}

/** 对局快照，用于断线重连 */
export interface GameSnapshotRecord {
  sessionId: string
  timestamp: number
  version: number
  engineData: SerializedEngine
  gameConfig: {
    smallBlind: number
    bigBlind: number
    minActionInterval: number
    thinkingTimeout: number
    defaultSystemPrompt?: string
  }
  storeState: {
    autoPlay: boolean
    autoPlayHandCount: number
    impressions: Record<string, Record<string, StructuredImpression>>
    impressionHistory: Array<{
      handNumber: number
      playerId: string
      targetId: string
      impression: StructuredImpression
    }>
    initialChipsMap: Record<string, number>
    prevHandRanks: Record<string, number>
    firstPlaceStreak: number
    firstPlacePlayerId: string | null
    llmThoughts: Record<string, string>
    thinkingChain: Array<{ playerId: string; playerName: string; content: string }>
  }
}

export class PokerDB extends Dexie {
  handHistories!: Table<HandHistory, string>
  apiProfiles!: Table<APIProfile, string>
  sessions!: Table<SessionRecord, string>
  impressions!: Table<ImpressionRecord, string>
  gameSnapshots!: Table<GameSnapshotRecord, string>
  structuredImpressions!: Table<StructuredImpressionRecord, string>

  constructor() {
    super('PokerTrainerDB')
    this.version(2).stores({
      handHistories: 'id, sessionId, handNumber, timestamp',
      apiProfiles: 'id, name',
      sessions: 'id, timestamp',
      impressions: '[sessionId+playerId], sessionId',
    })
    this.version(3).stores({
      handHistories: 'id, sessionId, handNumber, timestamp',
      apiProfiles: 'id, name',
      sessions: 'id, timestamp',
      impressions: '[sessionId+playerId], sessionId',
      gameSnapshots: 'sessionId, timestamp',
    })
    this.version(4).stores({
      handHistories: 'id, sessionId, handNumber, timestamp',
      apiProfiles: 'id, name',
      sessions: 'id, timestamp',
      impressions: '[sessionId+playerId], sessionId',
      gameSnapshots: 'sessionId, timestamp',
      structuredImpressions: '[observerProfileId+targetName], observerProfileId',
    })
  }
}

export const db = new PokerDB()
