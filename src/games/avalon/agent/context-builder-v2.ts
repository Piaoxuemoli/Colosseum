/**
 * 阿瓦隆 agent v2 上下文构建器（spec: docs/specs/engine2-integration.md §4）。
 *
 * prompt 只由 v2 消息构成：可见事件流（visibleEvents 已按玩家视角过滤——
 * 密谋频道/夜间情报/他人任务抉择只出现在有权限者的流里）+ 合法动作 JSON
 * 范式 + decisionContext 机械量。不读引擎状态、不读 DB。
 */

import type { V2AgentDecisionData, V2ActionSpec } from '@/platform/engine/contracts-v2'

export interface V2ContextInput {
  agent: { id: string; systemPrompt: string }
  data: V2AgentDecisionData
}

const ROLE_ZH: Record<string, string> = {
  merlin: '梅林',
  percival: '派西维尔',
  loyalServant: '忠诚仆从',
  assassin: '刺客',
  morgana: '莫甘娜',
  mordred: '莫德雷德',
  oberon: '奥伯伦',
  minion: '爪牙',
}

const PHASE_ZH: Record<string, string> = {
  discussion: '讨论发言',
  proposal: '队伍提名',
  teamVote: '队伍表决',
  quest: '任务执行',
  evilConsultation: '坏人密谋',
  assassination: '刺杀指认',
  ended: '终局',
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

function ids(value: unknown): string {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').join('、') : '?'
}

/** 每种动作的 JSON 范式（键 = action.type；引擎 normalize 后才最终裁决）。 */
function actionSchema(spec: V2ActionSpec, teamSize: number | null): string {
  switch (spec.type) {
    case 'speak':
      return '{"type":"speak","text":"你的公开发言（中文，50-300 字为佳）"}'
    case 'proposeTeam':
      return `{"type":"proposeTeam","targetIds":["<playerId>",…]}（恰好 ${teamSize ?? 'N'} 名互不相同的 playerId，可含你自己）`
    case 'vote':
      return '{"type":"vote","approve":true} 或 {"type":"vote","approve":false}'
    case 'quest':
      return '{"type":"quest","succeed":true}（好人只能 true；坏人可出失败牌）'
    case 'consult':
      return '{"type":"consult","text":"你的密谋发言（仅坏人可见，中文）"}'
    case 'assassinate':
      return '{"type":"assassinate","targetId":"<你指认的 playerId>"}'
    default:
      return `{"type":"${spec.type}"}`
  }
}

/** 从可见事件流重建认知时间线（身份/情报/密谋都来自流本身——受众已过滤）。 */
function renderTimeline(events: readonly Record<string, unknown>[], selfId: string): string[] {
  const lines: string[] = []
  for (const event of events) {
    const payload = asRecord(event.payload) ?? {}
    switch (event.kind) {
      case 'matchStarted':
        lines.push(`开局：${str(payload.boardName)} · 座位 ${Array.isArray(payload.seats) ? payload.seats.length : '?'} 人`)
        break
      case 'rolesAssigned':
        if (event.actorId === selfId) lines.push(`你的身份：${ROLE_ZH[str(payload.role)] ?? str(payload.role)}`)
        break
      case 'knowledgeRevealed': {
        if (event.actorId !== selfId) break
        const insight = str(payload.insight)
        const zh =
          insight === 'merlin' ? '你（梅林）看到的坏人' : insight === 'percival' ? '你（派西维尔）看到的梅林候选（真假难辨）' : '你的坏人同伙'
        lines.push(`${zh}：${ids(payload.playerIds)}`)
        break
      }
      case 'phaseEntered':
        lines.push(`—— 进入阶段 ${PHASE_ZH[str(payload.phase)] ?? str(payload.phase)}`)
        break
      case 'leaderAssigned':
        lines.push(`轮值队长：${str(payload.leaderId)}（第 ${num(payload.round)} 轮 第 ${num(payload.attempt)} 次提案）`)
        break
      case 'statementIssued':
        lines.push(`发言 ${str(payload.speakerId)}：${str(payload.text) || '（沉默）'}`)
        break
      case 'evilConsulted':
        lines.push(`密谋 ${str(payload.speakerId)}：${str(payload.text) || '（沉默）'}`)
        break
      case 'teamProposed':
        lines.push(`${str(payload.leaderId)} 提名队伍：${ids(payload.teamIds)}`)
        break
      case 'voteCast':
        lines.push(`表决 ${str(payload.voterId)}：${payload.approve === true ? '赞成' : '反对'}`)
        break
      case 'voteResult':
        lines.push(`计票：${num(payload.approvals)} 赞成 / ${num(payload.rejections)} 反对 → ${payload.outcome === 'approved' ? '通过' : '否决'}`)
        break
      case 'questChoice':
        if (event.actorId === selfId) lines.push(`你在本任务出了${payload.succeed === true ? '成功' : '失败'}牌`)
        break
      case 'questResult':
        lines.push(
          `任务 ${num(payload.round)}：${payload.outcome === 'success' ? '成功' : '失败'}（${num(payload.failVotes)} 张失败牌 / 需 ${num(payload.requiredFails)} 张判失败）`,
        )
        break
      case 'assassinationDeclared':
        lines.push(`刺杀：${str(payload.assassinId)} 指认 ${str(payload.targetId)}！`)
        break
      case 'gameEnded':
        lines.push(`终局：${payload.winner === 'good' ? '好人胜' : payload.winner === 'evil' ? '坏人胜' : '平局'}（${str(payload.basis)}）`)
        break
      default:
        break
    }
  }
  return lines
}

export class AvalonContextBuilderV2 {
  build(input: V2ContextInput): { systemMessage: string; userMessage: string } {
    const { agent, data } = input
    const ctx = data.decisionContext
    const actions = data.legalActions
    const legalTypes = actions.map((action) => `"${action.type}"`).join('、')
    const phase = str(ctx.phase)
    const scoreboard = asRecord(ctx.scoreboard)
    const board = asRecord(ctx.board)
    const role = str(ctx.yourRole)

    const systemMessage = `${agent.systemPrompt}

你是阿瓦隆玩家 ${agent.id}（真实身份见下方事件流与机械量）。

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
- targetIds/targetId 必须使用 playerId（不是名字/座位号）。
- 发言类动作（speak/consult）的 text 字段就是你的发言全文，直接写在 JSON 里。
- 若你的模型原生输出自己的推理标签（如 <think>...</think>），可以保留，但仍必须在最后输出完整的 <action>。
- 思考尽量精炼，避免冗长——输出过长会被截断导致没有 <action>。`

    const timeline = renderTimeline(data.events, agent.id).slice(-80).join('\n')
    const knowledge = Array.isArray(ctx.knowledge)
      ? ctx.knowledge
          .map((entry) => {
            const record = asRecord(entry)
            return record ? `${record.insight === 'evil' ? '同伙' : '情报'}：${ids(record.playerIds)}` : ''
          })
          .filter(Boolean)
          .join('；')
      : ''
    const score = scoreboard
      ? `好人成功 ${num(scoreboard.successes)} / 坏人失败 ${num(scoreboard.fails)}（先到 3 定胜负，好人到 3 后还有刺杀环节）`
      : ''
    const voteProgress = asRecord(ctx.currentVotes)

    const userMessage = `## 对局信息
${Object.entries(data.gameInfo)
  .map(([key, value]) => `- ${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
  .join('\n')}

## 机械量（引擎派生）
- 第 ${num(ctx.round)} 轮 · 第 ${num(ctx.attempt)} 次提案 · 阶段 ${PHASE_ZH[phase] ?? phase} · 你是 ${num(ctx.yourSeat)} 号位
- 你的身份：${ROLE_ZH[role] ?? role}（${ctx.yourFaction === 'good' ? '好人' : ctx.yourFaction === 'evil' ? '坏人' : '?'}阵营）
- 轮值队长：${str(ctx.leaderId)}；本轮任务需 ${num(ctx.teamSize)} 人${ctx.isDoubleFailRound === true ? '（双失败轮：需 2 张失败牌才判失败）' : ''}
- 战绩：${score}
- 连坐警示：同一轮第 5 次提案被拒 = 坏人直接获胜${typeof ctx.rejectionsRemaining === 'number' ? `（还剩 ${ctx.rejectionsRemaining} 次机会）` : ''}
${knowledge ? `- 你的夜间情报：${knowledge}` : ''}
${Array.isArray(ctx.discussionQueue) && ctx.discussionQueue.length > 0 ? `- 待发言（座位序）：${ids(ctx.discussionQueue)}` : ''}
${Array.isArray(ctx.consultationQueue) && ctx.consultationQueue.length > 0 ? `- 密谋待言（座位序）：${ids(ctx.consultationQueue)}` : ''}
${voteProgress ? `- 本轮已投：${(Array.isArray(voteProgress.cast) ? voteProgress.cast : [])
      .map((entry) => {
        const record = asRecord(entry)
        return record ? `${str(record.voterId)}${record.approve === true ? '✓' : '✗'}` : ''
      })
      .filter(Boolean)
      .join('、') || '（无人）'}；当前待投：${str(voteProgress.pendingVoterId)}` : ''}
${
  Array.isArray(ctx.voteHistory) && ctx.voteHistory.length > 0
    ? `- 历轮记名投票：${ctx.voteHistory
        .map((entry) => {
          const record = asRecord(entry)
          if (!record) return ''
          const cast = (Array.isArray(record.cast) ? record.cast : [])
            .map((vote) => {
              const v = asRecord(vote)
              return v ? `${str(v.voterId)}${v.approve === true ? '✓' : '✗'}` : ''
            })
            .filter(Boolean)
            .join('')
          return `第${num(record.round)}轮:${cast}`
        })
        .filter(Boolean)
        .join(' ')}`
    : ''
}
${board ? `- 板子：${str(board.boardName)} · 任务人数表 ${Array.isArray(board.teamSizes) ? board.teamSizes.join('/') : '?'}` : ''}

## 你可见的事件时间线
${timeline || '（开局）'}

## 本阶段合法动作（<action> 的 type 只能从中选择）
${actions.map((action) => `- ${action.type}${action.label ? `（${action.label}）` : ''}：${actionSchema(action, typeof ctx.teamSize === 'number' ? ctx.teamSize : null)}`).join('\n') || '（无合法动作）'}

请输出本阶段动作。`

    return { systemMessage, userMessage }
  }
}
