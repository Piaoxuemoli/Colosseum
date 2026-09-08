// 事件流重建状态（PFR-405）：事件流是唯一真相来源，快照只是加速优化。
//
// 重放原理：决策事件（match-config / randomness-established / action-made /
// stop-requested / 受控立即终止）驱动核心推进；其余全部事件（发牌、run-out、
// 摊牌、分池、换手等）都是决策的确定性派生结果，由同一核心函数在重放中
// 重新生成（事件被丢弃但状态推进一致），因此重建状态与实时状态逐位一致，
// 且 state.seq 恒等于事件条数。

import { applyNormalizedAction, createMatchFromMaster, requestStopAfterCurrentHand, terminateImmediately } from './engine'
import type { PokerEvent } from './events'
import type { MatchState } from './types'
import { matchConfigSchema } from './types'
import { z } from 'zod'

export type ReplayResult =
  | { ok: true; state: MatchState }
  | { ok: false; reason: 'stream-too-short' | 'missing-header-events' | 'invalid-header' | 'checkpoint-inside-bootstrap' | 'invalid-config' | 'seq-mismatch' }

const randomnessEventSchema = z.object({
  kind: z.literal('randomness-established'),
  masterSeed: z.number(),
})

/**
 * 从（完整或截断的）事件流重建状态。
 * 检查点必须落在稳定状态边界（任一 applyAction/指令返回点之后）；
 * 引导阶段内部（首手发牌完成前）不存在稳定状态，返回 checkpoint-inside-bootstrap。
 */
export function reduceEvents(events: readonly PokerEvent[]): ReplayResult {
  if (events.length < 2) return { ok: false, reason: 'stream-too-short' }
  const [first, second] = events
  if (first.kind !== 'match-config' || second.kind !== 'randomness-established') {
    return { ok: false, reason: 'missing-header-events' }
  }
  const configParsed = matchConfigSchema.safeParse({
    seatIds: first.seatIds,
    startingStack: first.startingStack,
    blinds: first.blinds,
    schedule: first.schedule ?? undefined,
  })
  const seedParsed = randomnessEventSchema.safeParse({ kind: second.kind, masterSeed: second.masterSeed })
  if (!configParsed.success || !seedParsed.success) {
    return { ok: false, reason: 'invalid-header' }
  }

  const created = createMatchFromMaster(configParsed.data, seedParsed.data.masterSeed)
  if (!created.ok) return { ok: false, reason: 'invalid-config' }

  // createMatch 的事件是流的确定前缀；从前缀之后折叠决策事件
  const prefixLen = created.events.length
  if (events.length < prefixLen) return { ok: false, reason: 'checkpoint-inside-bootstrap' }

  let state = created.state
  for (let i = prefixLen; i < events.length; i++) {
    const ev = events[i]
    switch (ev.kind) {
      case 'action-made':
        state = applyNormalizedAction(state, ev.action).state
        break
      case 'stop-requested':
        state = requestStopAfterCurrentHand(state).state
        break
      case 'match-finished':
        if (ev.reason === 'controlled-immediate') {
          const r = terminateImmediately(state)
          if (!r.ok) return { ok: false, reason: 'invalid-header' }
          state = r.state
        }
        break
      default:
        break // 派生事件：重放中由核心函数重新生成，跳过
    }
  }
  if (state.seq !== events.length) return { ok: false, reason: 'seq-mismatch' }
  return { ok: true, state }
}
