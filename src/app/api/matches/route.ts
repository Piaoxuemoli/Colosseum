import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { gameTypeSchema } from '@/platform/core/types'
import { db } from '@/platform/db/client'
import { matches } from '@/platform/db/schema.sqlite'
import { loadEnv } from '@/platform/env'
import { ensureGamesRegistered } from '@/platform/instrument'
import { createAndStartMatch } from '@/backend/orchestrator/match-lifecycle'
import { MatchCreateValidationError } from '@/backend/orchestrator/match-lifecycle-validation'
import { ensureWerewolfModerator } from '@/backend/match/ensure-system-moderator'
import { log } from '@/platform/telemetry/logger'

export const runtime = 'nodejs'

const createSchema = z.object({
  gameType: gameTypeSchema,
  agentIds: z.array(z.string()).min(2).max(10),
  moderatorAgentId: z.string().nullable().optional(),
  // FR-4.7-01 解说旁白总闸：缺省 = 开启（向后兼容）。顶层与 config 内
  // 均可传，顶层优先；最终持久化在 matches.config JSON 列（见
  // backend/match/narration-gate.ts）。
  narrationEnabled: z.boolean().optional(),
  config: z
    .object({
      agentTimeoutMs: z.number().int().nonnegative().optional(),
      minActionIntervalMs: z.number().int().nonnegative().optional(),
      tickConcurrencyLockMs: z.number().int().positive().optional(),
      maxConsecutiveErrors: z.number().int().positive().optional(),
      narrationEnabled: z.boolean().optional(),
    })
    .optional(),
  engineConfig: z.record(z.string(), z.unknown()).optional(),
  keyring: z.record(z.string(), z.string()).optional(),
})

export async function GET(): Promise<Response> {
  const rows = await db.select().from(matches).orderBy(desc(matches.startedAt)).limit(50)
  return Response.json({ matches: rows })
}

export async function POST(req: Request): Promise<Response> {
  ensureGamesRegistered()

  const json = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'validation', details: parsed.error.flatten() }, { status: 400 })
  }

  // R2-2 / FR-4.2-02：狼人杀对局开箱即有主持人 —— 没带 moderatorAgentId
  // 且库中不存在任何 werewolf 主持人时，按需播种「系统主持人」。幂等：
  // 已有主持人（自建或历史种子）直接复用，不重复创建。
  const moderator = await ensureWerewolfModerator({
    gameType: parsed.data.gameType,
    moderatorAgentId: parsed.data.moderatorAgentId ?? null,
  })

  // FR-4.7-01：解说旁白开关，随 config 一起持久化进 matches 表 JSON 列。
  // 顶层 narrationEnabled 优先于 config.narrationEnabled；缺省不写入，
  // 由 GM 侧默认视为开启（向后兼容存量对局）。
  const narrationOverride =
    parsed.data.narrationEnabled === undefined
      ? {}
      : { narrationEnabled: parsed.data.narrationEnabled }

  const createInput = {
    ...parsed.data,
    moderatorAgentId: moderator.agentId,
    config: { ...parsed.data.config, ...narrationOverride },
  }

  let matchId: string
  try {
    const result = await createAndStartMatch(createInput)
    matchId = result.matchId
  } catch (err) {
    if (err instanceof MatchCreateValidationError) {
      return Response.json(
        { error: 'validation', details: { message: err.message } },
        { status: 400 },
      )
    }
    // Infra failures (DB / Redis / etc) — let Next surface a 500 instead of
    // mislabelling them as validation errors.
    throw err
  }
  log.info('match created via api', { matchId })

  const env = loadEnv()
  fetch(`${env.BASE_URL}/api/matches/${matchId}/tick`, { method: 'POST' }).catch(() => {})

  return Response.json(
    {
      matchId,
      streamUrl: `/api/matches/${matchId}/stream`,
      // 播种动作可观测：seeded=true 表示本次调用新创建了系统主持人。
      moderatorAgentId: moderator.agentId,
      moderatorSeeded: moderator.seeded,
    },
    { status: 201 },
  )
}
