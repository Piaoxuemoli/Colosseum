export type LlmErrorKind = 'timeout' | 'api_error' | 'parse_fail' | 'abort'

export class LlmError extends Error {
  constructor(
    public kind: LlmErrorKind,
    message: string,
    public cause?: unknown,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
