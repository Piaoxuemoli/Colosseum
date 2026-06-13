/**
 * 斗地主插件 — 完整 GamePlugin 注册对象。
 */

import type { GamePlugin, GameMeta } from '../../core/protocols'
import type { DdzGameState, DdzAction, DdzConfig } from './engine/ddz-types'
import { DoudizhuEngine } from './engine/doudizhu-engine'
import {
  DdzContextBuilder,
  DdzResponseParser,
  DdzBotStrategy,
  ddzImpressionConfig,
} from './agent/ddz-agent'
import { DdzBoard, DdzSetup, DdzHistory } from './ui'

const ddzMeta: GameMeta = {
  gameType: 'doudizhu',
  displayName: '斗地主',
  minPlayers: 3,
  maxPlayers: 3,
  phases: ['bidding', 'playing', 'finished'],
  scoreLabel: '积分',
  roundLabel: '局',
  tableThemeClass: 'ddz-table-gradient',
}

const defaultDdzConfig: DdzConfig = {
  playerNames: ['玩家一', '玩家二', '玩家三'],
  baseScore: 1,
  sessionId: '',
}

export const doudizhuPlugin: GamePlugin<DdzGameState, DdzAction, DdzConfig> = {
  gameType: 'doudizhu',

  createEngine: () => new DoudizhuEngine(),
  defaultConfig: defaultDdzConfig,

  contextBuilder: new DdzContextBuilder(),
  responseParser: new DdzResponseParser(),
  botStrategy: new DdzBotStrategy(),
  impressionConfig: ddzImpressionConfig,

  BoardComponent: DdzBoard as unknown as GamePlugin<DdzGameState, DdzAction, DdzConfig>['BoardComponent'],
  SeatComponent: () => null,
  HistoryDetailComponent: DdzHistory,
  SetupComponent: DdzSetup as unknown as GamePlugin<DdzGameState, DdzAction, DdzConfig>['SetupComponent'],

  meta: ddzMeta,
}
