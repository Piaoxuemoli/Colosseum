// FR-4.8-03 / NFR-06（R3-6）：GET /api/stats/usage —— 持久化 LLM 用量聚合。
//
// 查询参数：matchId? / agentId? / purpose? / groupBy（agent|purpose|day，默认 agent）。
// 返回分组行 + 全量总计。token 为 null 的调用只计 calls（供应方未上报）。

import { db } from '@/platform/db/client'
import {
  getUsageAggregates,
  parseUsageGroupBy,
  parseUsagePurposeFilter,
  UsageQueryError,
} from '@/platform/db/queries/stats'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function pickOne(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  try {
    const aggregates = await getUsageAggregates(db, {
      groupBy: parseUsageGroupBy(pickOne(params, 'groupBy')),
      matchId: pickOne(params, 'matchId'),
      agentId: pickOne(params, 'agentId'),
      purpose: parseUsagePurposeFilter(pickOne(params, 'purpose')),
    })
    return Response.json(aggregates)
  } catch (err) {
    if (err instanceof UsageQueryError) {
      return Response.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
