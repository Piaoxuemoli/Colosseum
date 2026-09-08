/**
 * agent endpoint 的 v2 分支装配（spec §4）。
 *
 * 按 gameType 选择各游戏 agent 目录下的 v2 上下文构建器与响应解析器。
 * 路由层不直接 import 游戏模块（依赖方向：backend → games）。
 * v2 消息自带全部决策输入（events/legalActions/decisionContext/gameInfo），
 * 构建器不读 Redis 状态——「prompt 只由 data.events 构成」。
 */

import type { V2AgentDecisionData } from '@/platform/engine/contracts-v2'
import { PokerContextBuilderV2 } from '@/games/poker/agent/context-builder-v2'
import { PokerResponseParserV2 } from '@/games/poker/agent/response-parser-v2'
import { WerewolfContextBuilderV2 } from '@/games/werewolf/agent/context-builder-v2'
import { WerewolfResponseParserV2 } from '@/games/werewolf/agent/response-parser-v2'

export interface V2ContextBuilder {
  build(input: {
    agent: { id: string; systemPrompt: string }
    data: V2AgentDecisionData
  }): { systemMessage: string; userMessage: string }
}

export interface V2ResponseParser {
  parse(rawText: string): { action: Record<string, unknown> | null; thinking: string; fallbackUsed: boolean }
}

export function getV2ContextBuilder(gameType: string): V2ContextBuilder {
  if (gameType === 'poker') return new PokerContextBuilderV2()
  if (gameType === 'werewolf') return new WerewolfContextBuilderV2()
  throw new Error(`no v2 context builder for gameType: ${gameType}`)
}

export function getV2ResponseParser(gameType: string): V2ResponseParser {
  if (gameType === 'poker') return new PokerResponseParserV2()
  if (gameType === 'werewolf') return new WerewolfResponseParserV2()
  throw new Error(`no v2 response parser for gameType: ${gameType}`)
}

/** GM → agent 消息 parts[0].data 的 v2 判别（spec §4）。 */
export function isV2DecisionData(
  data: Record<string, unknown> | undefined | null,
): data is Record<string, unknown> {
  return data?.engineVersion === 2
}
