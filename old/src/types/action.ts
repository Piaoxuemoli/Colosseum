export type ActionType =
  | 'fold'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'allIn'
  | 'postSmallBlind'
  | 'postBigBlind'

export interface PlayerAction {
  playerId: string
  type: ActionType
  amount: number
  timestamp: number
  /** The game phase when this action was taken */
  phase?: string
}
