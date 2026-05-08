import { describe, expect, it } from 'vitest'
import {
  POKER_PLAYER_PRESETS,
  WEREWOLF_MODERATOR_PRESETS,
  WEREWOLF_PLAYER_PRESETS,
  presetsFor,
} from '@/lib/agent/prompt-presets'

describe('prompt-presets', () => {
  it('poker player presets: 4 archetypes, unique ids, non-empty prompts', () => {
    expect(POKER_PLAYER_PRESETS).toHaveLength(4)
    const ids = new Set(POKER_PLAYER_PRESETS.map((p) => p.id))
    expect(ids.size).toBe(4)
    for (const preset of POKER_PLAYER_PRESETS) {
      expect(preset.prompt.length).toBeGreaterThan(50)
      expect(preset.label.length).toBeGreaterThan(0)
    }
  })

  it('werewolf player presets + moderator preset exist', () => {
    expect(WEREWOLF_PLAYER_PRESETS.length).toBeGreaterThanOrEqual(1)
    expect(WEREWOLF_MODERATOR_PRESETS.length).toBeGreaterThanOrEqual(1)
  })

  it('presetsFor(poker) returns the poker array', () => {
    expect(presetsFor('poker', 'player')).toBe(POKER_PLAYER_PRESETS)
  })

  it('presetsFor(werewolf, moderator) returns the moderator array', () => {
    expect(presetsFor('werewolf', 'moderator')).toBe(WEREWOLF_MODERATOR_PRESETS)
  })

  it('presetsFor(werewolf, player) returns the werewolf player array', () => {
    expect(presetsFor('werewolf', 'player')).toBe(WEREWOLF_PLAYER_PRESETS)
  })
})
