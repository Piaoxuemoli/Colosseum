// 简化阿瓦隆 engine2 测试共享 helpers。
//
// 全部经公开引擎 API（applyAction / applyDefaultAction）驱动——每个测试同时
// 也是阶段机的集成测试。确定性（种子入流）使脚本可复现。

import {
  applyAction,
  applyDefaultAction,
  createMatchFromSeating,
  factionOf,
} from '@/games/avalon/engine2'
import type {
  ActionRejection,
  ApplyOutcome,
  AvalonAction,
  AvalonEngineState,
  AvalonEvent,
  AvalonEventKind,
  AvalonRoleId,
  PlayerSlot,
} from '@/games/avalon/engine2'

export const IDS5 = ['p1', 'p2', 'p3', 'p4', 'p5'] as const
export const SEED = 20260909

/** 标准板落座：p1 梅林、p2 派西维尔、p3 忠诚仆从、p4 莫德雷德、p5 爪牙。 */
export const SEATING_5: AvalonRoleId[] = ['merlin', 'percival', 'loyalServant', 'mordred', 'minion']

export interface Acc {
  state: AvalonEngineState
  events: AvalonEvent[]
}

export function start5(seating: AvalonRoleId[] = SEATING_5, playerIds: readonly string[] = IDS5): Acc {
  const created = createMatchFromSeating({
    seating,
    playerIds: [...playerIds],
    seed: SEED,
  })
  if (created.status !== 'created') {
    throw new Error(`match creation rejected: ${JSON.stringify(created.issues)}`)
  }
  return { state: created.state, events: created.events }
}

/** 应用一个必须被接受的动作；事件折入累加器。 */
export function step(acc: Acc, action: AvalonAction): AvalonEvent[] {
  const outcome = applyAction(acc.state, action)
  if (outcome.status === 'rejected') {
    throw new Error(`action ${action.type} rejected: [${outcome.rejection.code}] ${outcome.rejection.message}`)
  }
  acc.state = outcome.state
  acc.events.push(...outcome.events)
  return outcome.events
}

/** 应用一个必须被拒绝的动作；返回结构化拒绝。 */
export function fail(acc: Acc, action: AvalonAction): ActionRejection {
  const outcome = applyAction(acc.state, action)
  if (outcome.status === 'accepted') {
    throw new Error(`action ${action.type} unexpectedly accepted (phase ${acc.state.phase})`)
  }
  return outcome.rejection
}

/** 应用一个动作（接受与否），接受则折入。 */
export function attempt(acc: Acc, action: AvalonAction): ApplyOutcome {
  const outcome = applyAction(acc.state, action)
  if (outcome.status === 'accepted') {
    acc.state = outcome.state
    acc.events.push(...outcome.events)
  }
  return outcome
}

/** 当前轮值队长提案指定 2 人。 */
export function propose(acc: Acc, team: readonly [string, string]): void {
  const leader = acc.state.pendingActor
  if (!leader) throw new Error('propose: no pending leader')
  step(acc, { type: 'proposeTeam', actorId: leader, targetIds: [...team] })
}

/** 全员按给定立场表决（座位序自动投票，undefined 视为跳过保护——不允许）。 */
export function voteAll(acc: Acc, approve: boolean | ReadonlyArray<boolean>): void {
  let guard = 0
  while (acc.state.phase === 'teamVote' && guard++ < 10) {
    const voter = acc.state.pendingActor
    if (!voter) break
    const value = typeof approve === 'boolean' ? approve : approve[guard - 1]
    if (value === undefined) throw new Error('voteAll: approve list too short')
    step(acc, { type: 'vote', actorId: voter, approve: value })
  }
}

/** 任务成员全部按给定选择执行（座位序）。 */
export function questAll(acc: Acc, succeed: boolean | ReadonlyArray<boolean>): void {
  let guard = 0
  while (acc.state.phase === 'quest' && guard++ < 10) {
    const chooser = acc.state.pendingActor
    if (!chooser) break
    const value = typeof succeed === 'boolean' ? succeed : succeed[guard - 1]
    if (value === undefined) throw new Error('questAll: succeed list too short')
    step(acc, { type: 'quest', actorId: chooser, succeed: value })
  }
}

/** 持续应用默认动作直到 `until` 成立（或有界步数）。 */
export function runDefaults(acc: Acc, until: (a: Acc) => boolean, maxSteps = 500): number {
  let applied = 0
  while (!until(acc) && applied < maxSteps) {
    const outcome = applyDefaultAction(acc.state)
    if (outcome.status === 'rejected') {
      throw new Error(`default rejected in ${acc.state.phase}: ${outcome.rejection.message}`)
    }
    acc.state = outcome.state
    acc.events.push(...outcome.events)
    applied += 1
  }
  if (applied >= maxSteps) throw new Error('runDefaults: exceeded step bound (deadlock?)')
  return applied
}

export function evsOf<K extends AvalonEventKind>(
  events: readonly AvalonEvent[],
  kind: K,
): Array<Extract<AvalonEvent, { kind: K }>> {
  return events.filter((event): event is Extract<AvalonEvent, { kind: K }> => event.kind === kind)
}

export function evOf<K extends AvalonEventKind>(
  events: readonly AvalonEvent[],
  kind: K,
): Extract<AvalonEvent, { kind: K }> {
  const found = evsOf(events, kind)
  if (found.length === 0) throw new Error(`no ${kind} event found`)
  return found[found.length - 1]
}

export function player(acc: Acc, playerId: string): PlayerSlot {
  const found = acc.state.players.find((candidate) => candidate.playerId === playerId)
  if (!found) throw new Error(`no player ${playerId}`)
  return found
}

export function playerByRole(acc: Acc, role: AvalonRoleId): PlayerSlot {
  const found = acc.state.players.find((candidate) => candidate.role === role)
  if (!found) throw new Error(`no player with role ${role}`)
  return found
}

/**
 * 标准脚本（呈现契约门禁 / GM 冒烟共用）：
 * 轮 1 成功（好人队）→ 轮 2 失败（爪牙上车）→ 轮 3 失败（爪牙再上车）→ 坏人 2-1 胜。
 */
export function scriptedAvalonMatch(): Acc {
  const acc = start5()
  propose(acc, ['p1', 'p2'])
  voteAll(acc, true)
  questAll(acc, true)
  propose(acc, ['p4', 'p5'])
  voteAll(acc, true)
  questAll(acc, [true, false])
  propose(acc, ['p3', 'p5'])
  voteAll(acc, true)
  questAll(acc, [true, false])
  return acc
}

export { factionOf }
