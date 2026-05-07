import type { PlayerContextBuilder } from '@/lib/core/registry'
import type { MemoryContextSnapshot } from '@/lib/memory/contracts'
import type { WerewolfRole, WerewolfState } from '../engine/types'

const ROLE_ZH: Record<WerewolfRole, string> = {
  werewolf: '狼人',
  seer: '预言家',
  witch: '女巫',
  villager: '平民',
}

/**
 * Builds the werewolf agent prompt. Inputs:
 *   - agent:         who we're prompting (systemPrompt is their personality).
 *   - gameState:     filtered public state (the orchestrator zeroes out info
 *                    the agent shouldn't see, e.g. other seats' roles).
 *   - memoryContext: pre-formatted memory strings from the memory module.
 *
 * Output format is enforced by the parser contract (Task 3):
 *   <thinking>...</thinking>
 *   <belief>{ "<agentId>": {...BeliefEntry } }</belief>     # optional
 *   <action>{...WerewolfAction}</action>                    # required
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

    const systemMessage = this.buildSystemMessage(
      input.agent.systemPrompt,
      selfId,
      selfRole,
      state,
      input.memoryContext,
    )
    const userMessage = this.buildUserMessage(state, selfRole)
    return { systemMessage, userMessage }
  }

  private buildSystemMessage(
    personaPrompt: string,
    selfId: string,
    selfRole: WerewolfRole | null,
    state: WerewolfState,
    memory: MemoryContextSnapshot,
  ): string {
    const roleText = selfRole ? ROLE_ZH[selfRole] : '未知'
    const hintHeader = `你叫 ${selfId}，真实身份：${roleText}。`
    const privateEvidence = this.formatPrivateEvidence(selfId, selfRole, state)

    return [
      personaPrompt,
      '',
      hintHeader,
      privateEvidence,
      '',
      '输出格式（严格遵守）：',
      '<thinking>你的推理（可多段）</thinking>',
      '<belief>JSON：key=玩家名，value={werewolf,villager,seer,witch,reasoning,lastUpdatedAt}，每行四个身份概率之和等于 1</belief>',
      '<action>JSON：对应当前阶段合法 action</action>',
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

  private buildUserMessage(state: WerewolfState, _selfRole: WerewolfRole | null): string {
    const alive = state.players.filter((p) => p.alive).map((p) => p.name || p.agentId)
    const dead = state.players
      .filter((p) => !p.alive)
      .map((p) => `${p.name || p.agentId}(第${p.deathDay}天 ${p.deathCause ?? '未知'})`)

    const recentSpeeches = state.speechLog
      .slice(-12)
      .map((s) => {
        const who = s.agentId
        const claim = s.claimedRole ? `（自称${ROLE_ZH[s.claimedRole]}）` : ''
        return `- [Day${s.day}] ${who}${claim}：${s.content}`
      })
      .join('\n')

    const recentVotes = state.voteLog
      .slice(-12)
      .map((v) => `- [Day${v.day}] ${v.voter} → ${v.target ?? '弃票'}`)
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
      '请输出本阶段动作。',
    ].join('\n')
  }
}
