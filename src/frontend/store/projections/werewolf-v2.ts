// 狼人杀 engine2 事件投影（spec：docs/specs/engine2-integration.md §3/§6）。
//
// 消费 `werewolf:v2:${kind}` 信封事件（payload = engine2 WerewolfEvent 本体逐
// 字段平铺：{ seq, day, audience, actorId, kind, payload: {...} }），归约成现有
// WerewolfBoard/PlayerCard/ModeratorPanel/VoteTally/WerewolfRoster 消费的同一套
// view model：day / phase / speechLog / voteLog / moderatorNarration / deaths /
// roleAssignments / winner。
//
// 视角（spec §6 / WFR-2xx，观战默认上帝视角）：
// - god：全量——角色（rolesAssigned 即时积累）、夜间动作（狼刀/查验/用药等以
//   主持人旁白呈现）、死因（nightSettled 结算即见）；
// - public：只从 public 事件重建——夜间动作隐藏、身份在 gameEnded 揭示前隐藏、
//   夜间死因隐藏（板子开 deathCauseRevealed 时以公告载荷为准）。
//
// 未知 kind 静默忽略（向前兼容）；事件本体仍追加进 events 列表。

import type { GameEvent } from '@/platform/core/types'
import type {
  MatchViewProjection,
  PokerUiPlayer,
  WerewolfDeathEntry,
  WerewolfDerived,
  WerewolfNarrationEntry,
} from '../match-view-store'
import { WEREWOLF_V2_PREFIX, asRecord, engineKindOf, numberOr, stringOr } from './common'

/** v2 投影的内部累积器（不直接供组件消费；deriveMatchView/ingest 共用）。 */
export type WerewolfV2Accumulator = {
  /** seat（1-based）→ playerId，来自 matchStarted。 */
  playerBySeat: Record<number, string>
  /** role-self rolesAssigned 积累的身份（god 视角真相）。 */
  roles: Record<string, string>
  /** 结算时的完整死因记录（含夜间死因），gameEnded 揭示后对两视角公开。 */
  revealed: boolean
}

export function emptyWerewolfV2(): WerewolfV2Accumulator {
  return { playerBySeat: {}, roles: {}, revealed: false }
}

const NIGHT_ACTION_KINDS = new Set([
  'teammatesRevealed',
  'guardTargetChosen',
  'wolfKillVote',
  'wolfKillAgreed',
  'knifeTargetRevealed',
  'witchSaveDecision',
  'witchPoisonDecision',
  'seerChecked',
  'seerSkipped',
  'hunterShootPermission',
  'hunterDeclined',
])

const CAUSE_ZH: Record<string, string> = {
  'wolf-kill': '夜刀',
  poison: '毒杀',
  shot: '枪杀',
  exile: '票出',
  'milk-pierce': '奶穿',
  'self-explode': '自爆',
  lovers: '殉情',
}

function causeLabel(cause: string): string {
  return CAUSE_ZH[cause] ?? cause
}

function appendNarration(
  werewolf: WerewolfDerived,
  entry: WerewolfNarrationEntry,
): WerewolfDerived {
  return { ...werewolf, moderatorNarration: [...werewolf.moderatorNarration, entry] }
}

function appendDeath(
  werewolf: WerewolfDerived,
  entry: WerewolfDeathEntry,
): WerewolfDerived {
  if (werewolf.deaths.some((death) => death.agentId === entry.agentId)) return werewolf
  return { ...werewolf, deaths: [...werewolf.deaths, entry] }
}

/** 用展示名替换 agentId（找不到时回退原 id）。 */
function nameOf(players: PokerUiPlayer[], agentId: string): string {
  return players.find((player) => player.agentId === agentId)?.displayName ?? agentId
}

function seatsToAgentIds(seatNumbers: readonly number[], playerBySeat: Record<number, string>): string[] {
  const ids: string[] = []
  for (const seat of seatNumbers) {
    const playerId = playerBySeat[seat]
    if (typeof playerId === 'string') ids.push(playerId)
  }
  return ids
}

/** nightSettled（moderator）等夜间私密事件 → god 视角的主持人旁白文本。 */
function nightNarrationText(
  kind: string,
  ev: Record<string, unknown>,
  payload: Record<string, unknown>,
  players: PokerUiPlayer[],
): string {
  const actor = stringOr(ev.actorId)
  const actorName = actor ? nameOf(players, actor) : null
  const target = (key: string) => {
    const id = stringOr(payload[key])
    return id ? nameOf(players, id) : null
  }
  switch (kind) {
    case 'teammatesRevealed': {
      const wolves = Array.isArray(payload.wolfIds)
        ? payload.wolfIds.filter((id): id is string => typeof id === 'string').map((id) => nameOf(players, id))
        : []
      return `狼队互识：${wolves.join('、')}`
    }
    case 'guardTargetChosen':
      return `守卫守护：${target('targetId') ?? '空守'}`
    case 'wolfKillVote':
      return actorName ? `${actorName} 刀 ${target('targetId') ?? '空刀'}` : '狼队刀口投票'
    case 'wolfKillAgreed':
      return `狼队刀口商定：${target('targetId') ?? '空刀'}`
    case 'knifeTargetRevealed':
      return `刀口告知：${target('targetId') ?? '空刀'}`
    case 'witchSaveDecision':
      return payload.used === true ? `女巫用解药：救 ${target('targetId') ?? '?'}` : '女巫不使用解药'
    case 'witchPoisonDecision':
      return payload.used === true ? `女巫用毒药：毒 ${target('targetId') ?? '?'}` : '女巫不使用毒药'
    case 'seerChecked': {
      const result = stringOr(payload.result)
      const resultZh = result === 'werewolf' ? '狼人' : '好人'
      return `预言家查验 ${target('targetId') ?? '?'}：${resultZh}`
    }
    case 'seerSkipped':
      return '预言家跳过查验'
    case 'hunterShootPermission':
      return payload.canShoot === true ? '猎人可以开枪' : '猎人无法开枪'
    case 'hunterDeclined':
      return actorName ? `${actorName}（猎人）憋枪` : '猎人憋枪'
    case 'nightSettled': {
      const deaths = Array.isArray(payload.deaths)
        ? payload.deaths.flatMap((item) => (asRecord(item) ? [item] : []))
        : []
      if (deaths.length === 0) return '夜间结算：平安夜'
      const described = deaths.map((death) => {
        const id = stringOr(death.playerId)
        const causes = Array.isArray(death.causes)
          ? death.causes.filter((c: unknown): c is string => typeof c === 'string').map(causeLabel)
          : []
        const name = id ? nameOf(players, id) : '?'
        return causes.length > 0 ? `${name}（${causes.join('＋')}）` : name
      })
      return `夜间结算：${described.join('、')} 出局`
    }
    default:
      return kind
  }
}

function publicWinnerOf(winner: string | null): WerewolfDerived['winner'] {
  if (winner === 'wolves') return 'werewolves'
  if (winner === 'good') return 'villagers'
  if (winner === 'tie') return 'tie'
  return null
}

/**
 * 归约一个 `werewolf:v2:*` 信封事件。未知 kind 静默忽略（向前兼容）。
 */
export function reduceWerewolfV2Event(state: MatchViewProjection, event: GameEvent): MatchViewProjection {
  const kind = engineKindOf(event, WEREWOLF_V2_PREFIX)
  const ev = asRecord(event.payload) ?? {}
  const payload = asRecord(ev.payload) ?? {}

  const viewMode = state.viewMode
  const isGod = viewMode === 'god'
  let v2 = state.werewolfV2
  let v2Dirty = false
  const mutV2 = (): WerewolfV2Accumulator => {
    if (!v2Dirty) {
      v2 = { playerBySeat: { ...state.werewolfV2.playerBySeat }, roles: { ...state.werewolfV2.roles }, revealed: state.werewolfV2.revealed }
      v2Dirty = true
    }
    return v2
  }

  let status = state.status
  let currentActor = state.currentActor
  let matchComplete = state.matchComplete
  const winnerAgentId = state.winnerAgentId
  let werewolf = state.werewolf

  const day = numberOr(ev.day, werewolf.day)

  switch (kind) {
    case 'matchStarted': {
      const seats = Array.isArray(payload.seats) ? payload.seats.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      const acc = mutV2()
      for (const seat of seats) {
        const seatNumber = numberOr(seat.seat, 0)
        const playerId = stringOr(seat.playerId)
        if (seatNumber > 0 && playerId) acc.playerBySeat[seatNumber] = playerId
      }
      if (status === 'waiting') status = 'live'
      break
    }
    case 'randomnessSeed': {
      // moderator 受众的随机性来源：无 view model 槽位。
      break
    }
    case 'rolesAssigned': {
      const playerId = stringOr(ev.actorId)
      const role = stringOr(payload.role)
      if (!playerId || !role) break
      mutV2().roles[playerId] = role
      // god 视角即时积累身份；public 视角在 gameEnded 揭示前不可见。
      if (isGod) werewolf = { ...werewolf, roleAssignments: { ...v2.roles } }
      break
    }
    case 'phaseEntered': {
      const phase = stringOr(payload.phase)
      werewolf = {
        ...werewolf,
        day,
        phase: phase ?? werewolf.phase,
      }
      if (payload.phase === 'ended') currentActor = null
      break
    }
    case 'nightSettled': {
      // moderator 受众：结算死因只进 god 视角；public 的死讯经 deathsAnnounced。
      if (!isGod) break
      const deaths = Array.isArray(payload.deaths) ? payload.deaths.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      for (const death of deaths) {
        const agentId = stringOr(death.playerId)
        if (!agentId) continue
        const causes = Array.isArray(death.causes)
          ? death.causes.filter((c: unknown): c is string => typeof c === 'string')
          : []
        // 夜 N 结算事件的 day=N-1，公告日为次日（DeathRecord.settledDay 语义）。
        werewolf = appendDeath(werewolf, { agentId, day: day + 1, cause: causes[0] ?? null })
      }
      werewolf = appendNarration(werewolf, {
        day,
        phase: werewolf.phase ?? '',
        narration: nightNarrationText(kind, ev, payload, state.players),
      })
      break
    }
    case 'deathsAnnounced': {
      const seatNumbers = Array.isArray(payload.seatNumbers)
        ? payload.seatNumbers.filter((seat): seat is number => typeof seat === 'number')
        : []
      const causes = Array.isArray(payload.causes)
        ? payload.causes.map((group) =>
            Array.isArray(group) ? group.filter((c: unknown): c is string => typeof c === 'string') : [],
          )
        : null
      const agentIds = seatsToAgentIds(seatNumbers, v2.playerBySeat)
      for (const [i, agentId] of agentIds.entries()) {
        // 公开死因仅当板子开启 deathCauseRevealed（公告载荷带 causes）。
        const announcedCause = causes?.[i]
        const cause = announcedCause && announcedCause.length > 0 ? announcedCause.join('+') : null
        werewolf = appendDeath(werewolf, { agentId, day, cause })
      }
      werewolf = appendNarration(werewolf, {
        day,
        phase: werewolf.phase ?? '',
        narration:
          seatNumbers.length === 0
            ? '天亮了，昨夜是平安夜'
            : `天亮了，昨夜出局：${agentIds.map((id) => nameOf(state.players, id)).join('、')}`,
      })
      break
    }
    case 'hunterShot': {
      const targetId = stringOr(payload.targetId)
      if (targetId) {
        // 开枪是 public 事实，死因对两视角均可见。
        werewolf = appendDeath(werewolf, { agentId: targetId, day, cause: 'shot' })
      }
      break
    }
    case 'lastWords': {
      const playerId = stringOr(payload.playerId) ?? stringOr(ev.actorId)
      const content = stringOr(payload.content)
      if (!playerId || !content) break
      werewolf = {
        ...werewolf,
        speechLog: [...werewolf.speechLog, { day, agentId: playerId, content }],
      }
      break
    }
    case 'speech': {
      const playerId = stringOr(payload.playerId)
      const content = stringOr(payload.content) ?? ''
      if (!playerId) break
      werewolf = {
        ...werewolf,
        speechLog: [...werewolf.speechLog, { day, agentId: playerId, content }],
      }
      break
    }
    case 'voteCast': {
      const voterId = stringOr(payload.voterId)
      if (!voterId) break
      const target = stringOr(payload.targetId)
      werewolf = {
        ...werewolf,
        voteLog: [...werewolf.voteLog, { day, voter: voterId, target }],
      }
      break
    }
    case 'voteResult': {
      const outcome = stringOr(payload.outcome)
      const exiledId = stringOr(payload.exiledId)
      if (exiledId) {
        // 放逐是 public 事实（voteResult 公告 exiledId），死因两视角均可见。
        werewolf = appendDeath(werewolf, { agentId: exiledId, day, cause: 'exile' })
      }
      const outcomeText =
        outcome === 'exile'
          ? `投票放逐：${nameOf(state.players, exiledId ?? '?')}`
          : outcome === 'tie-pk'
            ? '平票，进入 PK 发言'
            : outcome === 'no-exile-after-pk'
              ? 'PK 后平票，无人出局'
              : outcome === 'no-majority'
                ? '未过半，无人出局'
                : '无人出局'
      werewolf = appendNarration(werewolf, { day, phase: werewolf.phase ?? '', narration: outcomeText })
      break
    }
    case 'gameEnded': {
      const winner = publicWinnerOf(stringOr(payload.winner))
      const reveal = Array.isArray(payload.reveal) ? payload.reveal.flatMap((item) => (asRecord(item) ? [item] : [])) : []
      const roles: Record<string, string> = {}
      const finalDeaths: WerewolfDeathEntry[] = []
      for (const entry of reveal) {
        const playerId = stringOr(entry.playerId)
        if (!playerId) continue
        const role = stringOr(entry.role)
        if (role) roles[playerId] = role
        const death = asRecord(entry.death)
        if (death) {
          const settledDay = numberOr(death.settledDay, day)
          const causes = Array.isArray(death.causes)
            ? death.causes.filter((c: unknown): c is string => typeof c === 'string')
            : []
          finalDeaths.push({ agentId: playerId, day: settledDay, cause: causes[0] ?? null })
        }
      }
      mutV2().revealed = true
      // 终局揭示是 public 事实（WFR-504）：身份与死因对两视角全量公开。
      werewolf = {
        ...werewolf,
        winner,
        roleAssignments: Object.keys(roles).length > 0 ? roles : werewolf.roleAssignments,
        deaths: finalDeaths.length > 0 ? finalDeaths : werewolf.deaths,
      }
      matchComplete = true
      status = 'settled'
      currentActor = null
      break
    }
    case 'sheriffCampaign':
    case 'sheriffBadgeTransfer':
    case 'idiotFlipped':
    case 'selfExplode': {
      // v1-M2 / v2 槽位事件：注册 kind，暂无 view model 槽位。
      break
    }
    default: {
      if (NIGHT_ACTION_KINDS.has(kind) && isGod) {
        // 夜间私密事件（wolves/role-self 受众）→ god 视角旁白；public 隐藏。
        werewolf = appendNarration(werewolf, {
          day,
          phase: werewolf.phase ?? '',
          narration: nightNarrationText(kind, ev, payload, state.players),
        })
      }
      // 其余未知 kind：静默忽略（向前兼容）。
      break
    }
  }

  // werewolf.v2 事件的 day 即分桶键（思考日志按 day/phase 分组沿用同一来源）。
  const handNumber = werewolf.day

  return {
    ...state,
    werewolfV2: v2,
    events: [...state.events, { ...event, handNumberAt: handNumber }],
    handNumber,
    status,
    currentActor,
    matchComplete,
    winnerAgentId,
    werewolf,
  }
}
