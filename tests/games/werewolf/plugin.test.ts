import { describe, expect, it } from 'vitest'
import { werewolfPlugin } from '@/games/werewolf/werewolf-plugin'
import { clearRegistry, getGame, hasGame } from '@/lib/core/registry'
import { registerAllGames } from '@/lib/core/register-games'

describe('werewolf plugin', () => {
  it('exposes engine / memory / player + moderator context / parser / bot', () => {
    expect(werewolfPlugin.gameType).toBe('werewolf')
    expect(werewolfPlugin.engine).toBeTruthy()
    expect(werewolfPlugin.memory).toBeTruthy()
    expect(werewolfPlugin.playerContextBuilder).toBeTruthy()
    expect(werewolfPlugin.moderatorContextBuilder).toBeTruthy()
    expect(werewolfPlugin.responseParser).toBeTruthy()
    expect(werewolfPlugin.botStrategy).toBeTruthy()
  })

  it('registerAllGames wires werewolf into the shared registry', () => {
    clearRegistry()
    registerAllGames()
    expect(hasGame('werewolf')).toBe(true)
    expect(hasGame('poker')).toBe(true)
    const retrieved = getGame('werewolf')
    expect(retrieved.gameType).toBe('werewolf')
  })
})
