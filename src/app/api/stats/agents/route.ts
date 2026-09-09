// FR-4.6-05（R3-5 观众面）：GET /api/stats/agents —— 跨已结束对局的选手
// 聚合排行（场次 / 胜场 / 胜率 / 平均名次 / 生存 / 最近参战）。
//
// 查询参数：gameType?（poker|werewolf）/ limit?（1-200，默认 50）。

import { db } from '@/platform/db/client'
import { getAgentLeaderboard } from '@/platform/db/queries/stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseGameType(value: string | null): 'poker' | 'werewolf' | undefined {
  if (value === 'poker' || value === 'werewolf') return value
  return undefined
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) return undefined
  return limit
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  const rows = await getAgentLeaderboard(db, {
    gameType: parseGameType(params.get('gameType')),
    limit: parseLimit(params.get('limit')),
  })
  return Response.json({ rows })
}
