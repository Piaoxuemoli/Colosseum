/**
 * Poker UI re-exports — 德扑 UI 组件集合。
 * 目前组件仍在 src/components/game/ 和 src/components/history/ 中。
 * Phase 4 时会将它们实际迁移到此目录。
 * 先通过 re-export 让 poker-plugin.ts 能引用。
 */

// 牌桌主组件
export { PokerTable } from '../../../components/game/PokerTable'

// 历史回放
export { HandDetail as PokerHistory } from '../../../components/history/HandDetail'
