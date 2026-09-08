/**
 * 狼人杀 agent v2 上下文构建器（spec: docs/specs/engine2-integration.md §4）。
 *
 * prompt 只由 v2 消息构成：可见事件流（visibleEvents 已按玩家视角过滤——
 * 狼队频道/查验结果/刀口信息只出现在有权限者的流里）+ 合法动作 JSON
 * 范式 + decisionContext 机械量。不读引擎状态、不读 DB。
 */

import type { V2AgentDecisionData, V2ActionSpec } from '@/platform/engine/contracts-v2'

export interface V2ContextInput {
  agent: { id: string; systemPrompt: string }
  data: V2AgentDecisionData
}

const ROLE_ZH: Record<string, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  villager: '平民',
  guard: '守卫',
  idiot: '白痴',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '?'
}

function num(value: unknown): string {
  return typeof value === 'number' ? String(value) : '?'
}

/** 每种动作的 JSON 范式（键 = action.type，targetId 必须来自目标列表）。 */
function actionSchema(spec: V2ActionSpec): string {
  const targets = spec.targetIds && spec.targetIds.length > 0 ? '<目标 playerId>' : null
  switch (spec.type) {
    case 'kill':
      return `{"type":"kill","targetId":${targets ?? 'null'}}（空刀填 null；自刀需板子允许）`
    case 'seerCheck':
      return `{"type":"seerCheck","targetId":${targets ?? '<非自身活人 playerId>'}}`
    case 'seerPass':
      return '{"type":"seerPass"}'
    case 'witchSave':
      return '{"type":"witchSave","targetId":"<今晚刀口 playerId>"}'
    case 'witchSavePass':
      return '{"type":"witchSavePass"}'
    case 'witchPoison':
      return `{"type":"witchPoison","targetId":${targets ?? '<非自身活人 playerId>'}}`
    case 'witchPoisonPass':
      return '{"type":"witchPoisonPass"}'
    case 'speak':
      return '{"type":"speak","content":"你的发言（遵守字数上限）"}'
    case 'vote':
      return `{"type":"vote","targetId":${targets ?? '<活人 playerId>'} }（弃票填 null）`
    case 'lastWords':
      return '{"type":"lastWords","content":"你的遗言"}'
    case 'lastWordsPass':
      return '{"type":"lastWordsPass"}'
    case 'hunterShoot':
      return `{"type":"hunterShoot","targetId":${targets ?? '<非自身活人 playerId>'}}`
    case 'hunterPass':
      return '{"type":"hunterPass"}'
    default:
      return `{"type":"${spec.type}"}`
  }
}

/** 从可见事件流重建认知时间线（角色/狼队/查验等都来自流本身）。 */
function renderTimeline(events: readonly Record<string, unknown>[], selfId: string): string[] {
  const lines: string[] = []
  for (const event of events) {
    const payload = asRecord(event.payload) ?? {}
    switch (event.kind) {
      case 'matchStarted': {
        const board = asRecord(payload.board)
        const roles = board ? (asRecord(board.roles) ?? {}) : {}
        lines.push(
          `开局：${Object.entries(roles)
            .filter(([, count]) => typeof count === 'number' && count > 0)
            .map(([role, count]) => `${ROLE_ZH[role] ?? role}×${count}`)
            .join('、')}；座位 ${Array.isArray(payload.seats) ? payload.seats.length : '?'} 人`,
        )
        break
      }
      case 'rolesAssigned':
        if (event.actorId === selfId) lines.push(`你的身份：${ROLE_ZH[str(payload.role)] ?? str(payload.role)}`)
        break
      case 'teammatesRevealed': {
        const wolves = Array.isArray(payload.wolfIds) ? payload.wolfIds.filter((id): id is string => typeof id === 'string') : []
        lines.push(`你的狼队友：${wolves.filter((id) => id !== selfId).join('、') || '无'}`)
        break
      }
      case 'phaseEntered':
        lines.push(`—— 进入阶段 ${str(payload.phase)}`)
        break
      case 'wolfKillVote':
        lines.push(`狼队投票：${str(event.actorId)} → ${payload.targetId === null ? '空刀' : str(payload.targetId)}`)
        break
      case 'wolfKillAgreed':
        lines.push(`狼队刀口商定：${payload.targetId === null ? '空刀' : str(payload.targetId)}`)
        break
      case 'knifeTargetRevealed':
        lines.push(`今晚刀口：${payload.targetId === null ? '空刀' : str(payload.targetId)}`)
        break
      case 'witchSaveDecision':
        if (event.actorId === selfId) lines.push(`解药${payload.used === true ? '已用于' : '未用于'} ${str(payload.targetId)}`)
        break
      case 'witchPoisonDecision':
        if (event.actorId === selfId) lines.push(`毒药${payload.used === true ? `已用于 ${str(payload.targetId)}` : '未使用'}`)
        break
      case 'seerChecked':
        if (event.actorId === selfId) lines.push(`你的查验：${str(payload.targetId)} = ${str(payload.result) === 'werewolf' ? '狼人' : '好人'}`)
        break
      case 'seerSkipped':
        if (event.actorId === selfId) lines.push(`第 ${num(payload.nightNumber)} 夜你选择不查验`)
        break
      case 'deathsAnnounced': {
        const seats = Array.isArray(payload.seatNumbers) ? payload.seatNumbers.join('、') : ''
        lines.push(
          payload.kind === 'peaceful' ? '天亮：平安夜' : `天亮：死亡座位 ${seats}`,
        )
        break
      }
      case 'lastWords':
        lines.push(
          payload.content === null || payload.content === undefined
            ? `${str(payload.playerId)} 未留遗言`
            : `遗言 ${str(payload.playerId)}：${str(payload.content)}`,
        )
        break
      case 'speech':
        lines.push(`发言 ${str(payload.playerId)}：${str(payload.content) || '（沉默）'}`)
        break
      case 'voteCast':
        lines.push(`投票 ${str(payload.voterId)} → ${payload.targetId === null ? '弃票' : str(payload.targetId)}`)
        break
      case 'voteResult': {
        const tally = Array.isArray(payload.tally)
          ? payload.tally
              .map((row) => {
                const record = asRecord(row)
                return record ? `${record.targetId === null ? '弃票' : str(record.targetId)}×${num(record.votes)}` : ''
              })
              .filter(Boolean)
              .join('、')
          : ''
        lines.push(`计票（${str(payload.round)}）：${tally} → ${str(payload.outcome)}`)
        break
      }
      case 'hunterShot':
        lines.push(`猎人 ${str(payload.hunterId)} 开枪带走 ${str(payload.targetId)}`)
        break
      case 'gameEnded':
        lines.push(`终局：${str(payload.winner)}（${str(payload.basis)}）`)
        break
      default:
        break
    }
  }
  return lines
}

export class WerewolfContextBuilderV2 {
  build(input: V2ContextInput): { systemMessage: string; userMessage: string } {
    const { agent, data } = input
    const ctx = data.decisionContext
    const actions = data.legalActions
    const legalTypes = actions.map((action) => `"${action.type}"`).join('、')
    const alive = Array.isArray(ctx.alivePlayers)
      ? ctx.alivePlayers.map((player) => str(asRecord(player)?.playerId)).filter((id) => id !== '?')
      : []
    const dead = Array.isArray(ctx.deadPlayers)
      ? ctx.deadPlayers.map((player) => str(asRecord(player)?.playerId)).filter((id) => id !== '?')
      : []

    const systemMessage = `${agent.systemPrompt}

你是狼人杀玩家 ${agent.id}（真实身份见下方事件流与机械量）。

输出格式（严格遵守，解析器依赖此格式）：
<thinking>
简短推理，1-2 句中文
</thinking>
<action>
{"type":"<合法动作 type>", ...}
</action>

## 关键纪律（违反会导致动作被丢弃）
- <action> 的 "type" 必须且只能是下列之一：${legalTypes || '（无）'}。
- <action> 必须是完整、合法的 JSON 对象，且 </action> 标签必须闭合；把 <action> 放在最后输出。
- targetId 必须使用「活人列表」中的 playerId（不是名字/座位号）；弃票、空刀、跳过填 null。
- 若你的模型原生输出自己的推理标签（如 <think>...</think>），可以保留，但仍必须在最后输出完整的 <action>。
- 思考尽量精炼，避免冗长——输出过长会被截断导致没有 <action>。`

    const timeline = renderTimeline(data.events, agent.id).slice(-80).join('\n')
    const potions = asRecord(ctx.witchPotions)
    const userMessage = `## 对局信息
${Object.entries(data.gameInfo)
  .map(([key, value]) => `- ${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
  .join('\n')}

## 机械量（引擎派生）
- 第 ${num(ctx.day)} 天/夜 · 阶段 ${String(ctx.phase ?? '?')} · 你是 ${num(ctx.yourSeat)} 号位
- 活人：${alive.join('、') || '（无）'}
- 死亡：${dead.join('、') || '（无）'}
${potions ? `- 你的药剂：解药 ${potions.save === true ? '剩' : '已用'}，毒药 ${potions.poison === true ? '剩' : '已用'}` : ''}
${Array.isArray(ctx.remainingSpeakers) && ctx.remainingSpeakers.length > 0 ? `- 待发言：${ctx.remainingSpeakers.map((id) => str(id)).join('、')}` : ''}

## 你可见的事件时间线
${timeline || '（开局）'}

## 本阶段合法动作（<action> 的 type 只能从中选择）
${actions.map((action) => `- ${action.type}${action.label ? `（${action.label}）` : ''}：${actionSchema(action)}`).join('\n') || '（无合法动作）'}

请输出本阶段动作。`

    return { systemMessage, userMessage }
  }
}
