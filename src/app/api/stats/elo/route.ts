/**
 * FR-4.9-01 ELO 天梯读取：GET /api/stats/elo?gameType=poker —— 按品类
 * 读取天梯（评分降序）。
 */

import { getEloLadder } from '@/platform/db/queries/elo'
import { db } from '@/platform/db/client'
import { gameTypeSchema } from '@/platform/core/types'

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const raw = url.searchParams.get('gameType') ?? 'poker'
  const parsed = gameTypeSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: { message: `unknown gameType: ${raw}` } }, { status: 400 })
  }
  const rows = await getEloLadder(db, parsed.data)
  return Response.json({ gameType: parsed.data, ladder: rows })
}
