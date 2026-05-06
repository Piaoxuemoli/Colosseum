import { describe, expect, it } from 'vitest'
import { keys } from '@/lib/redis/keys'

describe('lib/redis/keys', () => {
  it('generates expected key patterns', () => {
    expect(keys.matchState('m1')).toBe('match:m1:state')
    expect(keys.matchToken('m1')).toBe('match:m1:token')
    expect(keys.matchKeyring('m1')).toBe('match:m1:keyring')
    expect(keys.matchWorkingMemory('m1', 'agt_1')).toBe('match:m1:memory:agt_1:working')
    expect(keys.matchChannel('m1')).toBe('channel:match:m1')
    expect(keys.matchLock('m1')).toBe('lock:match:m1')
  })
})
