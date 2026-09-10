/**
 * FR-4.9-01 ELO 天梯全量幂等重建（存量回填 / 对账）：清空后按时间升序
 * 重放全部 completed 对局（口径 7：同一批输入重放任意次结果逐分一致）。
 */

import { rebuildEloFromHistory } from '@/platform/db/queries/elo'
import { db } from '@/platform/db/client'
import { log } from '@/platform/telemetry/logger'

export async function POST(): Promise<Response> {
  try {
    const result = await rebuildEloFromHistory(db)
    log.info('elo ladder rebuilt', result)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    log.error('elo rebuild failed', { err: String(err) })
    return Response.json({ error: 'rebuild-failed' }, { status: 500 })
  }
}
