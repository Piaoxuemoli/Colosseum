import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keyring, uploadKeysForMatch } from '@/lib/client/keyring'

describe('keyring', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

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

  it('uploads keys to the match-scoped cache endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

    await uploadKeysForMatch('match_1', [
      { profileId: 'prof_1', apiKey: 'sk-1' },
      { profileId: 'prof_2', apiKey: 'sk-2' },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/matches/match_1/keys',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
