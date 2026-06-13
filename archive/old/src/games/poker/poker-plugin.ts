/**
 * Poker Plugin — 德扑游戏的完整注册对象。
 * 包含引擎、Agent 模块、UI 组件、元数据。
 */

import type { GamePlugin, GameMeta, ImpressionConfig } from '../../core/protocols'
import type { GameState } from '../../types/game'
import type { PlayerAction } from '../../types/action'
import type { GameConfig } from './engine/poker-engine'
import { PokerEngineAdapter } from './engine/poker-engine-adapter'
import { PokerContextBuilder, PokerResponseParser, PokerBotStrategy } from './agent/poker-agent-adapters'
import { PokerTable } from './ui'

// 暂时用空壳组件占位，Phase 4 实际实现
const PlaceholderComponent = () => null

/** 德扑印象配置 (L/A/S/H) */
const pokerImpressionConfig: ImpressionConfig = {
  dimensions: [
    { key: 'looseness', label: '入池意愿', description: '1=极紧 10=极松', range: [1, 10], default: 5 },
    { key: 'aggression', label: '攻击性', description: '1=被动 10=激进', range: [1, 10], default: 5 },
    { key: 'stickiness', label: '抗弃牌', description: '1=容易弃牌 10=死不弃牌', range: [1, 10], default: 5 },
    { key: 'honesty', label: '诚实度', description: '1=纯诈唬 10=从不诈唬', range: [1, 10], default: 5 },
  ],
  emaAlpha: 0.3,
}

/** 德扑元数据 */
const pokerMeta: GameMeta = {
  gameType: 'poker',
  displayName: '德州扑克',
  minPlayers: 2,
  maxPlayers: 6,
  phases: ['waiting', 'preflop', 'flop', 'turn', 'river', 'showdown'],
  scoreLabel: '筹码',
  roundLabel: '手',
  tableThemeClass: 'poker-table-gradient',
}

/** 德扑默认配置 */
const defaultPokerConfig: GameConfig = {
  seats: [],
  smallBlind: 2,
  bigBlind: 4,
  sessionId: '',
}

/**
 * 德扑插件 — 注册到 GameRegistry。
 * 注意: createEngine/contextBuilder/responseParser/botStrategy 在 Phase 3 实现 Protocol 适配。
 * 目前先注册 meta/impressionConfig/UI 等静态部分。
 */
export const pokerPlugin: GamePlugin<GameState, PlayerAction, GameConfig> = {
  gameType: 'poker',

  createEngine: () => new PokerEngineAdapter(),

  defaultConfig: defaultPokerConfig,

  // Agent 集成
  contextBuilder: new PokerContextBuilder(),
  responseParser: new PokerResponseParser(),
  botStrategy: new PokerBotStrategy(),

  impressionConfig: pokerImpressionConfig,

  // UI 组件
  BoardComponent: PokerTable as unknown as GamePlugin<GameState, PlayerAction, GameConfig>['BoardComponent'],
  SeatComponent: PlaceholderComponent,
  HistoryDetailComponent: PlaceholderComponent,
  SetupComponent: PlaceholderComponent,

  meta: pokerMeta,
}
