/**
 * Redis key namespace from the storage spec. All business Redis access should
 * go through these helpers instead of hand-written string concatenation.
 */
export const keys = {
  matchState: (matchId: string) => `match:${matchId}:state`,
  matchToken: (matchId: string) => `match:${matchId}:token`,
  matchKeyring: (matchId: string) => `match:${matchId}:keyring`,
  matchWorkingMemory: (matchId: string, agentId: string) => `match:${matchId}:memory:${agentId}:working`,
  matchChannel: (matchId: string) => `channel:match:${matchId}`,
  matchLock: (matchId: string) => `lock:match:${matchId}`,
} as const
