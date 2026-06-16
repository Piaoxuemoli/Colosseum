import type { PlayerContextBuilder } from '@/platform/core/registry'
import type { ActionSpec } from '@/platform/engine/contracts'
import type { MemoryContextSnapshot } from '@/platform/memory/contracts'
import type { WerewolfAction, WerewolfRole, WerewolfState } from '../engine/types'

const ROLE_ZH: Record<WerewolfRole, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  villager: '平民',
}

/**
 * 每种合法动作的 JSON 范式（供模型照填）。键 = action.type。
 * targetId 必须是「活人列表」里的 agentId；弃票/不解毒用 null。
 */
const ACTION_SCHEMA: Record<string, string> = {
  'day/speak':
    '{"type":"day/speak","content":"你的发言（≤200字）","claimedRole":"werewolf|seer|witch|villager"}',
  'night/werewolfKill':
    '{"type":"night/werewolfKill","targetId":"<活人 agentId>","reasoning":"简短理由"}',
  'night/seerCheck': '{"type":"night/seerCheck","targetId":"<非自身活人 agentId>"}',
  'night/witchSave': '{"type":"night/witchSave"}',
  'night/witchPoison': '{"type":"night/witchPoison","targetId":"<活人 agentId 或 null>"}',
  'day/vote': '{"type":"day/vote","targetId":"<活人 agentId 或 null>","reason":"简短理由"}',
}

/**
 * Builds the werewolf agent prompt. Inputs:
 *   - agent:         who we're prompting (systemPrompt is their personality).
 *   - gameState:     filtered public state (the orchestrator zeroes out info
 *                    the agent shouldn't see, e.g. other seats' roles).
 *   - validActions:  本次合法动作集合（ActionSpec[]）—— 必须注入 prompt，否则
 *                    模型靠猜动作格式 → 频繁 llm-invalid-action。
 *   - memoryContext: pre-formatted memory strings from the memory module.
 *
 * 输出契约（parser 依赖）：
 *   <thinking>简短推理（1-2 句中文）</thinking>
 *   <belief>{...}</belief>     # 可选，保持简短
 *   <action>{...}</action>     # 必需，type 必须是下方「合法动作」之一，JSON 完整、闭合
 */
export class WerewolfPlayerContextBuilder implements PlayerContextBuilder {
  build(input: {
    agent: { id: string; systemPrompt: string }
    gameState: unknown
    validActions: unknown[]
    memoryContext: MemoryContextSnapshot
  }): { systemMessage: string; userMessage: string } {
    const state = input.gameState as WerewolfState
    const selfId = input.agent.id
    const selfRole = state.roleAssignments[selfId] ?? null
    const actions = (input.validActions as ActionSpec<WerewolfAction>[]).filter(Boolean)

    const systemMessage = this.buildSystemMessage(
      input.agent.systemPrompt,
      selfId,
      selfRole,
      state,
      input.memoryContext,
      actions,
    )
    const userMessage = this.buildUserMessage(state, selfRole, actions)
    return { systemMessage, userMessage }
  }

  private buildSystemMessage(
    personaPrompt: string,
    selfId: string,
    selfRole: WerewolfRole | null,
    state: WerewolfState,
    memory: MemoryContextSnapshot,
    actions: ActionSpec<WerewolfAction>[],
  ): string {
    const roleText = selfRole ? ROLE_ZH[selfRole] : '未知'
    const hintHeader = `你叫 ${selfId}，真实身份：${roleText}。`
    const privateEvidence = this.formatPrivateEvidence(selfId, selfRole, state)
    const legalTypes = actions.map((a) => a.type)

    return [
      personaPrompt,
      '',
      hintHeader,
      privateEvidence,
      '',
      '输出格式（严格遵守，解析器依赖此格式）：',
      '<thinking>简短推理，1-2 句中文即可</thinking>',
      '<belief>JSON：key=玩家 agentId，value={werewolf,villager,seer,witch 概率(和为1),reasoning}。可选，保持简短</belief>',
      '<action>JSON：对应当前阶段合法动作</action>',
      '',
      '## 关键纪律（违反会导致动作被丢弃）',
      `- <action> 的 "type" 必须且只能是下列之一：${legalTypes.map((t) => `"${t}"`).join('、')}。`,
      '- <action> 必须是完整、合法的 JSON 对象，且 `</action>` 标签必须闭合。',
      '- 把 <action> 放在最后输出；先闭合 <thinking>/<belief> 再开 <action>。',
      '- targetId 必须使用「活人列表」里的 agentId（不是名字/序号）；弃票、不解毒填 null。',
      '- 若你的模型原生会输出自己的推理标签（如 <think>...</think>），可以保留，但仍必须在最后输出完整的 <action>。',
      '- 思考尽量精炼，避免冗长——输出过长会被截断导致没有 <action>。',
      '',
      '## 对其他玩家的长期画像',
      memory.semanticSection || '（无历史）',
      '',
      '## 过往复盘（最近几局）',
      memory.episodicSection || '（无历史）',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private formatPrivateEvidence(
    selfId: string,
    selfRole: WerewolfRole | null,
    state: WerewolfState,
  ): string {
    if (selfRole === 'werewolf') {
      const teammates = Object.entries(state.roleAssignments)
        .filter(([id, role]) => id !== selfId && role === 'werewolf')
        .map(([id]) => id)
      return `你的狼队友：${teammates.join(', ') || '无'}`
    }
    if (selfRole === 'seer') {
      const checks = state.seerCheckResults
        .map((c) => `第${c.day}天查 ${c.targetId} = ${ROLE_ZH[c.role]}`)
        .join('; ')
      return `你历次验人结果：${checks || '暂无'}`
    }
    if (selfRole === 'witch') {
      const p = state.witchPotions
      return `你的药剂：救药 ${p.save ? '剩' : '已用'}，毒药 ${p.poison ? '剩' : '已用'}。`
    }
    return '你是平民，无特殊能力。'
  }

  private buildUserMessage(
    state: WerewolfState,
    _selfRole: WerewolfRole | null,
    actions: ActionSpec<WerewolfAction>[],
  ): string {
    // 活人用 agentId + 名字列出，便于模型在 targetId 中直接引用 agentId。
    const alive = state.players
      .filter((p) => p.alive)
      .map((p) => `${p.agentId}(${p.name || p.agentId})`)
    const dead = state.players
      .filter((p) => !p.alive)
      .map((p) => `${p.agentId}(第${p.deathDay}天 ${p.deathCause ?? '未知'})`)

    const recentSpeeches = state.speechLog
      .slice(-12)
      .map((s) => {
        const claim = s.claimedRole ? `（自称${ROLE_ZH[s.claimedRole]}）` : ''
        return `- [Day${s.day}] ${s.agentId}${claim}：${s.content}`
      })
      .join('\n')

    const recentVotes = state.voteLog
      .slice(-12)
      .map((v) => `- [Day${v.day}] ${v.voter} → ${v.target ?? '弃票'}`)
      .join('\n')

    const legalBlock = actions
      .map((a) => {
        const schema = ACTION_SCHEMA[a.type] ?? `{"type":"${a.type}"}`
        return `- ${a.type}${a.label ? `（${a.label}）` : ''}：${schema}`
      })
      .join('\n')

    return [
      '## 本局状态',
      `第 ${state.day} 天 · 阶段 ${state.phase}`,
      `活人：${alive.join(', ') || '（无）'}`,
      `死亡：${dead.join(', ') || '（无）'}`,
      '',
      '## 最近发言（时间序）',
      recentSpeeches || '（无）',
      '',
      '## 历次投票',
      recentVotes || '（无）',
      '',
      '## 本阶段合法动作（只能选其中之一填入 <action>）',
      legalBlock || '（无）',
      '',
      '请输出本阶段动作：<action> 的 type 必须是上面列出的合法动作之一。',
    ].join('\n')
  }
}
