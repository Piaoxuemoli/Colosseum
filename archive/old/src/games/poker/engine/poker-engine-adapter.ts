/**
 * PokerEngineAdapter — 将现有 GameEngine 适配为 EngineProtocol。
 *
 * 策略: Gateway 调用前 structuredClone(state)，引擎内部仍 mutation，
 * 返回 ActionResult 时 state 已是新副本。
 */

import type {
  EngineProtocol,
  EngineMeta,
  AvailableActionInfo,
  ActionResult,
} from '../../../core/protocols'
import type { GameState } from '../../../types/game'
import type { PlayerAction } from '../../../types/action'
import { GameEngine } from './poker-engine'
import type { GameConfig, AvailableAction, SerializedEngine } from './poker-engine'

export class PokerEngineAdapter implements EngineProtocol<GameState, PlayerAction, GameConfig> {
  readonly meta: EngineMeta = {
    gameType: 'poker',
    displayName: '德州扑克',
    minPlayers: 2,
    maxPlayers: 6,
    phases: ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'],
  }

  createGame(config: GameConfig): GameState {
    const engine = new GameEngine(config)
    return engine.getState()
  }

  getAvailableActions(state: GameState, playerId: string): AvailableActionInfo[] {
    // 恢复引擎实例以获取可用动作
    const engine = this.restoreEngine(state)
    const currentPlayer = state.players.find(p => p.seatIndex === state.currentPlayerIndex)
    if (!currentPlayer || currentPlayer.id !== playerId) return []

    const actions = engine.getAvailableActions()
    return actions.map(this.convertAction)
  }

  applyAction(state: GameState, action: PlayerAction): ActionResult<GameState> {
    try {
      // Clone state, restore engine on the clone
      const engine = this.restoreEngine(state)
      engine.executeAction({ type: action.type, amount: action.amount })
      const newState = engine.getState()
      return {
        ok: true,
        state: newState,
        events: [{
          type: 'action_applied',
          payload: {
            playerId: action.playerId,
            actionType: action.type,
            amount: action.amount,
          },
        }],
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  validateAction(state: GameState, action: PlayerAction): { valid: boolean; error?: string } {
    const currentPlayer = state.players.find(p => p.seatIndex === state.currentPlayerIndex)
    if (!currentPlayer || currentPlayer.id !== action.playerId) {
      return { valid: false, error: 'Not this player\'s turn' }
    }
    if (currentPlayer.status !== 'active') {
      return { valid: false, error: 'Player is not active' }
    }
    const engine = this.restoreEngine(state)
    const available = engine.getAvailableActions()
    const matchingAction = available.find(a => a.type === action.type)
    if (!matchingAction) {
      return { valid: false, error: `Action "${action.type}" not available. Available: ${available.map(a => a.type).join(', ')}` }
    }
    return { valid: true }
  }

  serialize(state: GameState): string {
    return JSON.stringify(state)
  }

  deserialize(data: string): GameState {
    return JSON.parse(data) as GameState
  }

  // ---- Helpers ----

  /**
   * 从 GameState 恢复一个 GameEngine 实例。
   * 注意: 这是一个简化实现，完整恢复需要 SerializedEngine。
   * 在当前适配阶段，我们利用 serialize/restore 路径。
   */
  private restoreEngine(state: GameState): GameEngine {
    // 构建最小 SerializedEngine 结构
    const serialized: SerializedEngine = {
      state: structuredClone(state),
      streetActions: { preflop: [], flop: [], turn: [], river: [] },
      currentHandThoughts: {},
      initialPlayerChips: Object.fromEntries(state.players.map(p => [p.id, p.chips])),
      totalChipsInGame: state.players.reduce((s, p) => s + p.chips, 0) + state.pot,
      handHistories: [],
      playerImpressions: {},
    }
    return GameEngine.restore(serialized)
  }

  private convertAction(action: AvailableAction): AvailableActionInfo {
    const info: AvailableActionInfo = { type: action.type }
    if (action.minAmount !== undefined || action.maxAmount !== undefined) {
      info.constraints = {
        amount: {
          min: action.minAmount,
          max: action.maxAmount,
        },
      }
    }
    return info
  }
}
