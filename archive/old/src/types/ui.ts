/**
 * UI-layer type definitions for component props.
 * These bridge between the engine's GameState and React components.
 */

// ---------- Card ----------

export type Suit = 'spade' | 'heart' | 'diamond' | 'club'
export type CardData = { rank: string; suit: Suit } | null

// ---------- Player Seat ----------

export type PlayerType = 'human' | 'llm' | 'bot' | 'empty'

export interface Player {
  id: string
  name: string
  type: PlayerType
  chips: number
  cards: string[] | null
  position: 'bottom' | 'bottom-right' | 'top-right' | 'top-left' | 'bottom-left' | 'top'
  borderColor: string
  thinking?: string | null
  folded?: boolean
  eliminated?: boolean
  badge?: string | null
  currentBet?: number
  isActive?: boolean
  /** Last action for flash label (e.g. "跟注 $10"), cleared after display */
  lastAction?: { type: string; label: string } | null
}

// ---------- Action Log ----------

export interface ActionLogEntry {
  playerName: string
  playerColor: string
  action: string
  opacity?: number
  highlight?: boolean
}

export interface PhaseHeader {
  phase: string
  phaseColor: string
  phaseBg: string
}

export interface InternalMonologue {
  playerName: string
  content: string
}

// ---------- Spectator Sidebar ----------

export interface ProbabilityEntry {
  name: string
  winPercent: number
  color: string
}

// ---------- History ----------

export interface SessionSummary {
  sessionId: string
  startTime: number
  handCount: number
  playerNames: string[]
  latestWinner: string
}

export interface HandHistoryEntry {
  id: string
  handNumber: number
  date: string
  participants: string[]
  winner: string
  winAmount: number
  steps: {
    phase: string
    action: string
    communityCards: CardData[]
  }[]
}
