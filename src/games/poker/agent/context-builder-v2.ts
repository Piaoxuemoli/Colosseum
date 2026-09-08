/**
 * 德扑 agent v2 上下文构建器（spec: docs/specs/engine2-integration.md §4）。
 *
 * prompt 只由 v2 消息构成：可见事件流（visibleEvents 已过滤）+ 合法动作
 * JSON 范式 + decisionContext 机械量（PFR-501）。不读引擎状态、不读 DB。
 * 输出纪律沿用 v1 的 <thinking>/<action> 标签（GM 侧 normalizeAction 容错）。
 */

import type { V2AgentDecisionData, V2ActionSpec } from '@/platform/engine/contracts-v2'

export interface V2ContextInput {
  agent: { id: string; systemPrompt: string }
  data: V2AgentDecisionData
}

/** 每种动作的 JSON 范式（供模型照填）。 */
function actionSchema(spec: V2ActionSpec): string {
  switch (spec.type) {
    case 'fold':
      return '{"type":"fold"}'
    case 'check':
      return '{"type":"check"}'
    case 'call':
      return '{"type":"call"}'
    case 'bet':
      return `{"type":"bet","amount":<${spec.minAmount ?? 1}~${spec.maxAmount ?? 1} 的整数>}`
    case 'raise':
      return `{"type":"raise","toAmount":<加注到的总额 ${spec.minAmount ?? 1}~${spec.maxAmount ?? 1}>}`
    case 'all-in':
      return '{"type":"all-in"}'
    default:
      return `{"type":"${spec.type}"}`
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function num(value: unknown): string {
  return typeof value === 'number' ? String(value) : '?'
}

function cards(value: unknown): string {
  return Array.isArray(value) ? value.map((card) => (typeof card === 'string' ? card : JSON.stringify(card))).join(' ') : '?'
}

/** 从可见事件流渲染：本手我的底牌 / 公共牌 / 本手动作时间线。 */
function renderEventTimeline(events: readonly Record<string, unknown>[], selfId: string): string[] {
  const lines: string[] = []
  for (const event of events) {
    const kind = event.kind
    switch (kind) {
      case 'hand-started': {
        const blinds = asRecord(event.blinds) ?? {}
        lines.push(
          `# 第 ${num(event.handNumber)} 手开始（按钮位 seat=${num(event.buttonSeat)}，盲注 ${num(blinds.sb)}/${num(blinds.bb)}）`,
        )
        break
      }
      case 'hole-cards-dealt':
        if (event.seatId === selfId) lines.push(`你的底牌: ${cards(event.cards)}`)
        break
      case 'street-dealt':
        lines.push(`${String(event.street)} 发牌: ${cards(event.cards)}`)
        break
      case 'blinds-posted':
        lines.push('盲注已提交')
        break
      case 'action-made': {
        const action = asRecord(event.action)
        const detail = action
          ? `${String(action.type)}${action.to !== undefined ? ` 到 ${num(action.to)}` : action.paid !== undefined ? ` ${num(action.paid)}` : ''}`
          : '?'
        lines.push(`  ${String(event.seatId)}: ${detail}`)
        break
      }
      case 'cards-revealed':
        lines.push(`${String(event.seatId)} 亮牌: ${cards(event.cards)}`)
        break
      case 'pot-awarded':
        lines.push(`底池 ${num(event.potIndex)} (${num(event.amount)}) 判给获胜方`)
        break
      case 'hand-ended': {
        const results = Array.isArray(event.results) ? event.results : []
        const summary = results
          .map((row) => {
            const record = asRecord(row)
            if (!record) return null
            return `${String(record.seatId)} ${num(record.startStack)}→${num(record.endStack)} (${num(record.delta)})${record.eliminated === true ? ' 出局' : ''}`
          })
          .filter((line): line is string => line !== null)
          .join('；')
        lines.push(`第 ${num(event.handNumber)} 手结束：${summary || '无结算'}`)
        break
      }
      case 'player-eliminated':
        lines.push(`${String(event.seatId)} 被淘汰（第 ${num(event.rank)} 名）`)
        break
      case 'blind-level-raised':
        lines.push(`盲注升级至 L${num(event.level)}`)
        break
      default:
        break
    }
  }
  return lines
}

export class PokerContextBuilderV2 {
  build(input: V2ContextInput): { systemMessage: string; userMessage: string } {
    const { agent, data } = input
    const ctx = data.decisionContext
    const actions = data.legalActions.length > 0 ? data.legalActions : [{ type: 'fold' } as V2ActionSpec]
    const legalTypes = actions.map((action) => `"${action.type}"`).join('、')

    const systemMessage = `${agent.systemPrompt}

Game: no-limit Texas hold'em (engine2).
玩家 id 即座位 id；你是 ${agent.id}。

输出格式（严格遵守，解析器依赖此格式）：
<thinking>
简短推理，1-2 句中文
</thinking>
<action>
{"type":"fold|check|call|bet|raise|all-in", ...}
</action>

## 关键纪律（违反会导致动作被丢弃）
- <action> 的 "type" 必须且只能是下列之一：${legalTypes}。
- <action> 必须是完整、合法的 JSON 对象，且 </action> 标签必须闭合；把 <action> 放在最后输出。
- bet 用 "amount"；raise 用 "toAmount"（加注后的总额，即你面前筹码目标值）；fold/check/call/all-in 不带金额。
- 若 "check" 合法，不要因为牌弱就弃牌——过牌是免费的合法动作。
- 若你的模型原生输出自己的推理标签（如 <think>...</think>），可以保留，但仍必须在最后输出完整的 <action>。`

    const timeline = renderEventTimeline(data.events, agent.id).slice(-60).join('\n')
    const odds = asRecord(ctx.potOdds)
    const userMessage = `## 对局信息
${Object.entries(data.gameInfo)
  .map(([key, value]) => `- ${key}: ${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
  .join('\n')}

## 机械量（引擎派生，PFR-501）
- 第 ${num(ctx.hand)} 手 · 街道 ${String(ctx.street ?? '?')} · 你的位置 ${String(ctx.position ?? '?')}
- 你的底牌: ${cards(ctx.actorHoleCards)}
- 公共牌: ${cards(ctx.board) || '（未发）'}
- 你的筹码: ${num(ctx.actorStack)} · 有效筹码: ${num(ctx.effectiveStack)}
- 底池: ${num(ctx.potTotal)} · 需跟注: ${num(ctx.toCall)} · 底池赔率 ${num(odds?.ratio)}
- 最小加注到: ${ctx.minRaiseTo === null || ctx.minRaiseTo === undefined ? '（无加注权）' : num(ctx.minRaiseTo)} · 最大（全下）到: ${num(ctx.maxRaiseTo)}

## 事件时间线（你可见的全部信息）
${timeline || '（开局）'}

## 本回合合法动作（<action> 的 type 只能从中选择）
${actions.map((action) => `- ${action.type}${action.label ? `（${action.label}）` : ''}：${actionSchema(action)}`).join('\n')}

请输出你的动作。`

    return { systemMessage, userMessage }
  }
}
