import { beforeEach, describe, expect, it } from 'vitest'
import { keyring } from '@/lib/client/keyring'

describe('keyring', () => {
  beforeEach(() => localStorage.clear())

  it('set + get round trip', () => {
    keyring.set('prof_1', 'sk-abc')
    expect(keyring.get('prof_1')).toBe('sk-abc')
    expect(keyring.has('prof_1')).toBe(true)
  })

  it('remove deletes key', () => {
    keyring.set('prof_1', 'sk-abc')
    keyring.remove('prof_1')
    expect(keyring.get('prof_1')).toBeUndefined()
    expect(keyring.has('prof_1')).toBe(false)
  })

  it('all returns full map', () => {
    keyring.set('a', '1')
    keyring.set('b', '2')
    expect(keyring.all()).toEqual({ a: '1', b: '2' })
  })
})
