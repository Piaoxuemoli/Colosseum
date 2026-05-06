type Level = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

function emit(level: Level, msg: string, fields?: LogFields) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  })
  console.log(line)
}

/**
 * Structured JSON logger. Business events go to stdout so Docker and hosting
 * log drivers can collect them without parsing ad hoc text.
 */
export const log = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
}
