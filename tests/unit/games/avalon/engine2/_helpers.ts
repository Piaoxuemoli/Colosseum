// 阿瓦隆 engine2（全量规则）测试共享 helpers。
//
// 全部经公开引擎 API（applyAction / applyDefaultAction）驱动——每个测试同时
// 也是阶段机的集成测试。确定性（种子入流）使脚本可复现。
//
// 兼容注记：tests/unit/platform/engine/presentation-contract.test.ts 消费本
// 文件的 IDS5 / start5 / scriptedAvalonMatch（呈现契约门禁的阿瓦隆 case）。

import {
  applyAction,
  applyDefaultAction,
  createMatchFromSeating,
  factionOf,
  resolveBoard,
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
  ResolvedBoard,
} from '@/games/avalon/engine2'

export const IDS5 = ['p1', 'p2', 'p3', 'p4', 'p5'] as const
export const IDS6 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const
export const IDS10 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'] as const
export const SEED = 20260909

/** basic-5 标准落座：p1 梅林、p2 派西维尔、p3 忠诚仆从、p4 刺客、p5 爪牙。 */
export const SEATING_5: AvalonRoleId[] = ['merlin', 'percival', 'loyalServant', 'assassin', 'minion']
/** deceit-5：爪牙 → 莫甘娜。 */
export const SEATING_5_DECEIT: AvalonRoleId[] = ['merlin', 'percival', 'loyalServant', 'assassin', 'morgana']
/** shadow-5：爪牙 → 莫德雷德。 */
export const SEATING_5_SHADOW: AvalonRoleId[] = ['merlin', 'percival', 'loyalServant', 'assassin', 'mordred']
/** basic-6：p1 梅林、p2 派西维尔、p3/p4 忠诚仆从、p5 刺客、p6 莫甘娜。 */
export const SEATING_6: AvalonRoleId[] = [
  'merlin',
  'percival',
  'loyalServant',
  'loyalServant',
  'assassin',
  'morgana',
]
/** lone-king-6：莫甘娜 → 奥伯伦。 */
export const SEATING_6_LONE: AvalonRoleId[] = [
  'merlin',
  'percival',
  'loyalServant',
  'loyalServant',
  'assassin',
  'oberon',
]
/** base-10：梅林/派西维尔/忠诚×4 vs 刺客/莫甘娜/莫德雷德/爪牙。 */
export const SEATING_10: AvalonRoleId[] = [
  'merlin',
  'percival',
  'loyalServant',
  'loyalServant',
  'loyalServant',
  'loyalServant',
  'assassin',
  'morgana',
  'mordred',
  'minion',
]

export interface Acc {
  state: AvalonEngineState
  events: AvalonEvent[]
}

/** 预设 → 解析板子（测试脚本的前提是板子合法）。 */
export function boardOf(presetId: string, overrides?: { discussionEnabled?: boolean }): ResolvedBoard {
  const resolved = resolveBoard({
    preset: presetId,
    ...(overrides?.discussionEnabled === undefined ? {} : { discussionEnabled: overrides.discussionEnabled }),
  })
  if (!resolved.ok) {
    throw new Error(`preset ${presetId} rejected: ${JSON.stringify(resolved.issues)}`)
  }
  return resolved.board
}

export function startBoard(
  board: ResolvedBoard,
  seating: readonly AvalonRoleId[],
  playerIds: readonly string[] = IDS5,
  seed: number = SEED,
): Acc {
  const created = createMatchFromSeating({
    board,
    seating: [...seating],
    playerIds: [...playerIds],
    seed,
  })
  if (created.status !== 'created') {
    throw new Error(`match creation rejected: ${JSON.stringify(created.issues)}`)
  }
  return { state: created.state, events: created.events }
}

/** basic-5 开局（讨论默认开启 → 阶段 discussion，发言人 p1）。 */
export function start5(seating: AvalonRoleId[] = SEATING_5, playerIds: readonly string[] = IDS5): Acc {
  return startBoard(boardOf('basic-5'), seating, playerIds)
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

// ---------------------------------------------------------------------------
// 阶段驱动 helpers
// ---------------------------------------------------------------------------

/** 讨论阶段：座位序全员各发言一次（默认文本或逐人列表）。 */
export function speakAll(acc: Acc, texts?: string | ReadonlyArray<string>): void {
  let guard = 0
  while (acc.state.phase === 'discussion' && guard++ < 12) {
    const speaker = acc.state.pendingActor
    if (!speaker) break
    const value =
      texts === undefined
        ? `我是 ${speaker}，我认为好人稳赢`
        : typeof texts === 'string'
          ? texts
          : texts[guard - 1]
    if (value === undefined) throw new Error('speakAll: text list too short')
    step(acc, { type: 'speak', actorId: speaker, text: value })
  }
}

/** 当前轮值队长提案指定 N 人（N = 本轮任务人数）。 */
export function propose(acc: Acc, team: readonly string[]): void {
  const leader = acc.state.pendingActor
  if (!leader) throw new Error('propose: no pending leader')
  step(acc, { type: 'proposeTeam', actorId: leader, targetIds: [...team] })
}

/** 全员按给定立场表决（座位序自动投票）。 */
export function voteAll(acc: Acc, approve: boolean | ReadonlyArray<boolean>): void {
  let guard = 0
  while (acc.state.phase === 'teamVote' && guard++ < 12) {
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
  while (acc.state.phase === 'quest' && guard++ < 12) {
    const chooser = acc.state.pendingActor
    if (!chooser) break
    const value = typeof succeed === 'boolean' ? succeed : succeed[guard - 1]
    if (value === undefined) throw new Error('questAll: succeed list too short')
    step(acc, { type: 'quest', actorId: chooser, succeed: value })
  }
}

/** 刺杀合议：座位序坏人各发言一次。 */
export function consultAll(acc: Acc, texts?: string | ReadonlyArray<string>): void {
  let guard = 0
  while (acc.state.phase === 'evilConsultation' && guard++ < 12) {
    const speaker = acc.state.pendingActor
    if (!speaker) break
    const value =
      texts === undefined
        ? `${speaker} 合议：刺杀梅林`
        : typeof texts === 'string'
          ? texts
          : texts[guard - 1]
    if (value === undefined) throw new Error('consultAll: text list too short')
    step(acc, { type: 'consult', actorId: speaker, text: value })
  }
}

/** 刺杀指认（当前刺杀权持有者）。 */
export function assassinate(acc: Acc, targetId: string): void {
  const holder = acc.state.pendingActor
  if (!holder) throw new Error('assassinate: no pending holder')
  step(acc, { type: 'assassinate', actorId: holder, targetId })
}

/** 一次通过的完整任务轮：讨论 → 提案 → 全赞成 → 任务抉择。 */
export function runApprovedQuest(
  acc: Acc,
  team: readonly string[],
  questChoices?: boolean | ReadonlyArray<boolean>,
): void {
  speakAll(acc)
  propose(acc, team)
  voteAll(acc, true)
  questAll(acc, questChoices ?? true)
}

/** 持续应用默认动作直到 `until` 成立（或有界步数）。 */
export function runDefaults(acc: Acc, until: (a: Acc) => boolean, maxSteps = 1000): number {
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
 * 标准脚本 A（呈现契约门禁 / 回放 / 重放共用，1成功 / 2失败 + 连坐）：
 * 轮 1 好人队成功 → 轮 2 爪牙上车失败 → 轮 3 双坏队失败 → 轮 4 五连拒 →
 * 连坐触发坏人直接胜（任务战绩 1成功 / 2失败）。
 */
export function scriptedAvalonMatch(): Acc {
  const acc = start5()
  runApprovedQuest(acc, ['p1', 'p2'], true) // 轮 1（2 人队）成功
  runApprovedQuest(acc, ['p1', 'p2', 'p5'], [true, true, false]) // 轮 2（3 人队）爪牙出失败
  runApprovedQuest(acc, ['p4', 'p5'], [false, false]) // 轮 3（2 人队）双坏队全失败
  for (let i = 0; i < 5; i++) {
    // 轮 4（3 人队）：五次提案全否 → 连坐（attempt 1 先走讨论，重提直接提名）
    speakAll(acc)
    const leader = acc.state.pendingActor
    if (!leader) throw new Error('no leader pending')
    const seats = acc.state.players.length
    const leaderSeat = acc.state.players.find((p) => p.playerId === leader)?.seat ?? 1
    const team: string[] = []
    for (let offset = 1; team.length < 3; offset++) {
      const seat = ((leaderSeat - 1 + offset) % seats) + 1
      const found = acc.state.players.find((p) => p.seat === seat)
      if (found) team.push(found.playerId)
    }
    propose(acc, team)
    voteAll(acc, false)
  }
  return acc
}

/**
 * 标准脚本 B（好人 3 胜 + 刺杀未命中）：三轮好人队全成功 → 合议 → 刺杀
 * 指认非梅林 → 好人胜。
 */
export function scriptedGoodWin(): Acc {
  const acc = start5()
  runApprovedQuest(acc, ['p1', 'p2'], true)
  runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
  runApprovedQuest(acc, ['p1', 'p2'], true)
  consultAll(acc)
  assassinate(acc, 'p2') // 派西维尔，非梅林
  return acc
}

/**
 * 标准脚本 C（好人 3 胜 + 刺杀命中梅林）：坏人翻盘。
 */
export function scriptedAssassinationHit(): Acc {
  const acc = start5()
  runApprovedQuest(acc, ['p1', 'p2'], true)
  runApprovedQuest(acc, ['p1', 'p2', 'p3'], true)
  runApprovedQuest(acc, ['p1', 'p2'], true)
  consultAll(acc)
  assassinate(acc, 'p1') // 梅林
  return acc
}

/**
 * 标准脚本 D（坏人 3 任务失败直接胜，无刺杀环节）。
 */
export function scriptedEvilQuestWin(): Acc {
  const acc = start5()
  runApprovedQuest(acc, ['p1', 'p2'], true) // 1 成功
  runApprovedQuest(acc, ['p1', 'p2', 'p5'], [true, true, false]) // 失败
  runApprovedQuest(acc, ['p3', 'p5'], [true, false]) // 失败
  runApprovedQuest(acc, ['p1', 'p2', 'p4'], [true, true, false]) // 1-3 坏人胜
  return acc
}

export { factionOf }
