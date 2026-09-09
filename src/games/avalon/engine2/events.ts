// Avalon engine v2 — event construction + audience filtering.
//
// 事件流是唯一真相（AVR-501）：每个事件携带 audience 标记；`visibleEvents`
// 对观战与 agent 决策上下文施加同一过滤（engine2-integration spec §1.3：
// agent 上下文只允许由 visibleEvents 重建）。身份由流内 rolesAssigned 事件
// 推导，过滤器不依赖外部状态。三口径同源（AVR-205）。

import type { Audience, AvalonAction, AvalonEvent, AvalonEventKind, EventPayloadMap } from './types'

/** 谁在看这条流：god = 观战上帝视角（全量）。 */
export type EventViewer =
  | { type: 'player'; playerId: string }
  | { type: 'god' }
  | { type: 'public-only' }

/**
 * 知识隔离谓词（AVR-204 无越权输出）：
 * - public：全员可见；
 * - role-self：仅本人；
 * - delayed-public（随机种子 / 终局揭示）：上帝视角即时可见；选手视角在
 *   流中出现 gameEnded（终局揭示）之后才可见——种子在终局前不得让选手
 *   反推发牌，终局揭示本身就是延迟公开的解锁事件。
 */
export function eventVisibleTo(event: AvalonEvent, viewer: EventViewer, revealUnlocked: boolean): boolean {
  const audience = event.audience
  switch (viewer.type) {
    case 'god':
      return true
    case 'public-only':
      return audience.kind === 'public'
    case 'player': {
      switch (audience.kind) {
        case 'public':
          return true
        case 'role-self':
          return audience.playerId === viewer.playerId
        case 'delayed-public':
          return revealUnlocked
      }
    }
  }
}

/**
 * 把全量事件流过滤到 `viewer` 可见的子集。终局解锁状态（revealUnlocked）
 * 由流自身推导（是否存在 gameEnded 事件），保证重放/直播同口径。
 */
export function visibleEvents(events: readonly AvalonEvent[], viewer: EventViewer): AvalonEvent[] {
  const revealUnlocked = events.some((event) => event.kind === 'gameEnded')
  return events.filter((event) => eventVisibleTo(event, viewer, revealUnlocked))
}

/**
 * 阶段机使用的事件工厂。泛型 → 联合的赋值对泛型 K 不可证明，故此处
 * 单点收窄（每个具体调用点的 payload 类型都被完整检查）。
 */
export function makeEvent<K extends AvalonEventKind>(args: {
  seq: number
  day: number
  kind: K
  audience: Audience
  actorId: string | null
  payload: EventPayloadMap[K]
  isDefault?: boolean
  action?: AvalonAction
}): AvalonEvent {
  const event = {
    seq: args.seq,
    day: args.day,
    kind: args.kind,
    audience: args.audience,
    actorId: args.actorId,
    payload: args.payload,
    ...(args.isDefault === true ? { isDefault: true as const } : {}),
    ...(args.action !== undefined ? { action: args.action } : {}),
  }
  return event as AvalonEvent
}
