type Level = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function minLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info') as Level
  return LEVEL_RANK[raw] ?? LEVEL_RANK.info
}

function emit(level: Level, msg: string, fields?: LogFields) {
  if (LEVEL_RANK[level] < minLevel()) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  })
  console.log(line)
}

type Logger = {
  debug: (msg: string, fields?: LogFields) => void
  info: (msg: string, fields?: LogFields) => void
  warn: (msg: string, fields?: LogFields) => void
  error: (msg: string, fields?: LogFields) => void
  withFields: (extra: LogFields) => Logger
  withMatch: (matchId: string, extra?: LogFields) => Logger
}

function build(extra: LogFields = {}): Logger {
  return {
    debug: (msg, fields) => emit('debug', msg, { ...extra, ...(fields ?? {}) }),
    info: (msg, fields) => emit('info', msg, { ...extra, ...(fields ?? {}) }),
    warn: (msg, fields) => emit('warn', msg, { ...extra, ...(fields ?? {}) }),
    error: (msg, fields) => emit('error', msg, { ...extra, ...(fields ?? {}) }),
    withFields: (more) => build({ ...extra, ...more }),
    withMatch: (matchId, more) => build({ ...extra, matchId, ...(more ?? {}) }),
  }
}

/**
 * Structured JSON logger. Business events go to stdout so Docker and hosting
 * log drivers can collect them without parsing ad hoc text. Errors are
 * written to stderr. Use `.withMatch(matchId)` for scoped loggers.
 */
export const log: Logger = build()
