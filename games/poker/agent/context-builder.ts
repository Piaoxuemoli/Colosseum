import type { PlayerContextBuilder } from '@/lib/core/registry'
import type { ActionSpec } from '@/lib/engine/contracts'
import type { MemoryContextSnapshot } from '@/lib/memory/contracts'
import { cardToString } from '../engine/card'
import type { PokerAction, PokerState } from '../engine/poker-types'

export class PokerPlayerContextBuilder implements PlayerContextBuilder {
  build(input: {
    agent: { id: string; systemPrompt: string }
    gameState: unknown
    validActions: unknown[]
    memoryContext: MemoryContextSnapshot
  }): { systemMessage: string; userMessage: string } {
    const state = input.gameState as PokerState
    const actions = input.validActions as ActionSpec<PokerAction>[]
    const player = state.players.find((candidate) => candidate.id === input.agent.id)

    const systemMessage = `${input.agent.systemPrompt}

Game: 6-max fixed-limit Texas hold'em.
Small blind: ${state.smallBlind}; big blind: ${state.bigBlind}.

Output format (STRICT — the parser depends on this):

  <thinking>
  brief reasoning in Chinese, any length you like
  </thinking>
  <action>
  {"type":"fold|check|call|bet|raise|allIn","amount":0}
  </action>

Your final <action> block MUST be a valid JSON object with a string "type"
field matching one of the legal actions listed below. "amount" is optional
for fold/check/call and required for bet/raise/allIn.

If your model natively emits its own reasoning tag (e.g. <think>...</think>),
that is fine — the parser accepts both <think> and <thinking>. But you
MUST still emit an action decision at the end. The cleanest way is to
always close the reasoning tag and then open <action>.

${input.memoryContext.semanticSection}
${input.memoryContext.episodicSection}`

    const userMessage = `## Hand #${state.handNumber}
Phase: ${state.phase}
Your hole cards: ${player ? player.holeCards.map(cardToString).join(' ') : 'unknown'}
Your chips: ${player?.chips ?? 'unknown'}
Community cards: ${state.communityCards.length > 0 ? state.communityCards.map(cardToString).join(' ') : 'none'}
Current bet: ${Math.max(...state.players.map((candidate) => candidate.currentBet))}

Legal actions:
${actions.map((action) => `- ${action.type}${action.minAmount ? ` ${action.minAmount}` : ''}`).join('\n')}

${input.memoryContext.workingSummary}

Choose one legal action.`

    return { systemMessage, userMessage }
  }
}
