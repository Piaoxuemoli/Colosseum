import type { ModeratorContextBuilder } from '@/lib/core/registry'
import type { WerewolfState } from '../engine/types'

/**
 * Builds the prompt for a werewolf Moderator agent. Moderators don't decide
 * gameplay, so we don't feed them memory or belief state — just enough
 * public context to narrate the transition into the next phase.
 *
 * Output contract (enforced by `ModeratorResponseParser`):
 *   <narration>...≤80 汉字...</narration>
 */
export class WerewolfModeratorContextBuilder implements ModeratorContextBuilder {
  build(input: {
    agent: { id: string; systemPrompt: string }
    gameState: unknown
    recentEvents: unknown[]
  }): { systemMessage: string; userMessage: string } {
    const state = input.gameState as WerewolfState
    const upcomingPhase = state.phase
    const recent = (input.recentEvents as Array<{ kind: string }>).slice(-8)

    const systemMessage = [
      input.agent.systemPrompt,
      '',
      `你是狼人杀主持人 ${input.agent.id}，不参与决策。`,
      '你的职责：为每次阶段转换生成一句主持词（不超过 80 字），要克制、庄重、点到为止。',
      '输出格式（严格遵守）：',
      '<narration>主持词</narration>',
    ].join('\n')

    const aliveCount = state.players.filter((p) => p.alive).length
    const userMessage = [
      `当前状态：第 ${state.day} 天 · 即将进入 ${upcomingPhase}`,
      `活人数：${aliveCount}`,
      '',
      '最近公共事件（按时间序）：',
      recent.length === 0 ? '（无）' : recent.map((e) => `- ${e.kind}`).join('\n'),
      '',
      `请为"即将进入 ${upcomingPhase}"生成主持词（≤80 字）。`,
    ].join('\n')

    return { systemMessage, userMessage }
  }
}
