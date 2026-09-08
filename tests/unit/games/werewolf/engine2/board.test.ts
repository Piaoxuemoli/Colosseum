// Board config validation + presets (WFR-101, WFR-601, WFR-602).

import { describe, expect, it } from 'vitest'
import {
  BOARD_PRESET_6P_BASE,
  BOARD_PRESET_9P_333,
  createMatch,
  createMatchFromSeating,
  parseBoard,
  presetBoard,
} from '@/games/werewolf/engine2'

const issueFields = (result: { ok: boolean; issues?: Array<{ field: string; code: string }> }): string[] =>
  result.ok ? [] : (result.issues ?? []).map((i) => `${i.field}:${i.code}`)

describe('built-in presets (WFR-601)', () => {
  it('board A: 6-player base parses with the PRD-mandated parameters', () => {
    const result = parseBoard(BOARD_PRESET_6P_BASE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.roles).toEqual({ werewolf: 2, seer: 1, witch: 1, villager: 2 })
    expect(result.board.winCondition).toBe('kill-all-parity')
    expect(result.board.witchSelfSavePolicy).toBe('first-night-only')
    expect(result.board.lastWordsPolicy).toBe('first-night-and-day')
    expect(result.board.voteTiePolicy).toBe('pk-revote-then-nobody')
    expect(result.board.deathCauseRevealed).toBe(false)
    expect(result.board.roleRevealedOnDeath).toBe(false)
    expect(result.board.sheriffEnabled).toBe(false)
    expect(result.board.maxDays).toBe(40)
  })

  it('board B: 9-player 333 board parses with 屠边 and the hunter seated', () => {
    const result = parseBoard(BOARD_PRESET_9P_333)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.roles).toEqual({ seer: 1, witch: 1, hunter: 1, villager: 3, werewolf: 3 })
    expect(result.board.winCondition).toBe('kill-side')
    expect(result.board.sheriffEnabled).toBe(false)
  })

  it('both presets create a match for matching player counts (config-driven, no board-specific branches)', () => {
    for (const [board, count] of [
      [BOARD_PRESET_6P_BASE, 6],
      [BOARD_PRESET_9P_333, 9],
    ] as const) {
      const created = createMatch({
        board,
        playerIds: Array.from({ length: count }, (_, i) => `a${i + 1}`),
        seed: 7,
      })
      expect(created.status).toBe('created')
      if (created.status === 'created') {
        expect(created.state.players).toHaveLength(count)
        expect(created.state.phase).toBe('night.wolves')
        expect(created.state.pendingActor).not.toBeNull()
      }
    }
  })
})

describe('WFR-101: structured rejection of illegal configs', () => {
  it('rejects boards seating M2 roles (guard) with a milestone-gated issue', () => {
    const result = presetBoard(BOARD_PRESET_9P_333, { roles: { hunter: 0, guard: 1 } })
    expect(result.ok).toBe(false)
    expect(issueFields(result)).toContain('roles.guard:unsupported-role')
  })

  it('rejects idiot boards until v1-M2', () => {
    const result = presetBoard(BOARD_PRESET_9P_333, { roles: { hunter: 0, idiot: 1 } })
    expect(issueFields(result)).toContain('roles.idiot:unsupported-role')
  })

  it('rejects v2 roles (cupid/elder/…) from the roles map', () => {
    const result = presetBoard(BOARD_PRESET_6P_BASE, { roles: { villager: 1, cupid: 1 } })
    expect(issueFields(result)).toContain('roles.cupid:unsupported-role')
  })

  it('rejects unknown role names at the schema layer', () => {
    const result = parseBoard({ ...BOARD_PRESET_6P_BASE, roles: { werewolf: 2, seer: 1, witch: 1, villager: 1, wizard: 1 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.some((i) => i.field.startsWith('roles'))).toBe(true)
  })

  it('rejects sheriffEnabled=true until v1-M2 (clean error, not silently wrong)', () => {
    const result = presetBoard(BOARD_PRESET_9P_333, { sheriffEnabled: true })
    expect(issueFields(result)).toContain('sheriffEnabled:unsupported-feature')
  })

  it('rejects sheriff-decides speech order (depends on the M2 sheriff)', () => {
    const result = presetBoard(BOARD_PRESET_9P_333, { speechOrderPolicy: 'sheriff-decides' })
    expect(issueFields(result)).toContain('speechOrderPolicy:unsupported-feature')
  })

  it('rejects open-role mode (v2 slot)', () => {
    const result = presetBoard(BOARD_PRESET_6P_BASE, { roleMode: 'open' })
    expect(issueFields(result)).toContain('roleMode:unsupported-feature')
  })

  it('rejects extendedRoles entries (v2 slot)', () => {
    const result = presetBoard(BOARD_PRESET_6P_BASE, { extendedRoles: ['knight'] })
    expect(issueFields(result)).toContain('extendedRoles.knight:unsupported-role')
  })

  it('rejects out-of-domain parameter values (maxDays=0, speech too long)', () => {
    expect(parseBoard({ ...BOARD_PRESET_6P_BASE, maxDays: 0 }).ok).toBe(false)
    expect(parseBoard({ ...BOARD_PRESET_6P_BASE, speechMaxLength: 9999 }).ok).toBe(false)
  })

  it('rejects compositions with no wolves / no good players', () => {
    const noWolves = parseBoard({ ...BOARD_PRESET_6P_BASE, roles: { seer: 2, witch: 1, villager: 3, werewolf: 0 } })
    expect(issueFields(noWolves)).toContain('roles.werewolf:empty-faction')
    const noGood = parseBoard({ ...BOARD_PRESET_6P_BASE, roles: { werewolf: 6 } })
    expect(issueFields(noGood)).toContain('roles:empty-faction')
  })

  it('rejects kill-side boards missing an edge (no villagers / no gods)', () => {
    const noVillagers = parseBoard({
      ...BOARD_PRESET_9P_333,
      roles: { seer: 1, witch: 1, hunter: 1, werewolf: 3, villager: 0 },
    })
    expect(issueFields(noVillagers)).toContain('roles:degenerate-side')
  })

  it('rejects parity boards that are terminal at start (wolves >= good)', () => {
    const result = parseBoard({
      ...BOARD_PRESET_6P_BASE,
      roles: { werewolf: 3, seer: 1, witch: 1, villager: 1 },
    })
    expect(issueFields(result)).toContain('winCondition:terminal-at-start')
  })

  it('rejects witch-before-wolves night order (knife reveal must precede the save question)', () => {
    const result = parseBoard({ ...BOARD_PRESET_6P_BASE, nightActionOrder: ['witch', 'werewolf', 'seer'] })
    expect(issueFields(result)).toContain('nightActionOrder:param-conflict')
  })

  it('rejects a night order that omits a seated night role', () => {
    const result = parseBoard({ ...BOARD_PRESET_6P_BASE, nightActionOrder: ['werewolf', 'witch'] })
    expect(issueFields(result)).toContain('nightActionOrder.seer:missing-step')
  })

  it('rejects duplicate night steps', () => {
    const result = parseBoard({
      ...BOARD_PRESET_6P_BASE,
      nightActionOrder: ['werewolf', 'werewolf', 'witch', 'seer'],
    })
    expect(issueFields(result)).toContain('nightActionOrder.werewolf:duplicate-step')
  })

  it('accepts night orders that declare roles absent from the board (skipped silently, WFR-102-2)', () => {
    expect(parseBoard({ ...BOARD_PRESET_6P_BASE, nightActionOrder: ['guard', 'werewolf', 'witch', 'seer'] }).ok).toBe(true)
    expect(parseBoard({ ...BOARD_PRESET_6P_BASE, nightActionOrder: ['werewolf', 'seer', 'witch'] }).ok).toBe(true)
  })

  it('createMatch rejects player-count mismatches and duplicate ids', () => {
    const short = createMatch({ board: BOARD_PRESET_6P_BASE, playerIds: ['a', 'b', 'c'], seed: 1 })
    expect(short.status).toBe('invalid')
    if (short.status === 'invalid') {
      expect(short.issues[0].code).toBe('count-mismatch')
    }
    const dup = createMatch({ board: BOARD_PRESET_6P_BASE, playerIds: ['a', 'b', 'c', 'd', 'e', 'a'], seed: 1 })
    expect(dup.status).toBe('invalid')
    if (dup.status === 'invalid') {
      expect(dup.issues[0].code).toBe('duplicate-player')
    }
  })

  it('createMatchFromSeating rejects seatings that do not match the board counts', () => {
    const parsed = parseBoard(BOARD_PRESET_6P_BASE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const result = createMatchFromSeating({
      board: parsed.board,
      seating: ['werewolf', 'werewolf', 'seer', 'witch', 'villager', 'werewolf'],
      playerIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      seed: 1,
    })
    expect(result.status).toBe('invalid')
  })
})

describe('WFR-602: preset reference + override', () => {
  it('merges scalar overrides and per-role count overrides, keeps the rest', () => {
    const result = presetBoard(BOARD_PRESET_9P_333, {
      maxDays: 12,
      roles: { villager: 2, hunter: 0, guard: 0 },
    })
    // hunter 0 + guard 0 → 8-player 预女 3狼 2民 board: legal M1 shape.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.board.maxDays).toBe(12)
    expect(result.board.roles.hunter).toBe(0)
    expect(result.board.roles.villager).toBe(2)
    expect(result.board.winCondition).toBe('kill-side')
  })

  it('re-validators reject overrides that break milestone gating', () => {
    const result = presetBoard(BOARD_PRESET_9P_333, { sheriffEnabled: true })
    expect(result.ok).toBe(false)
  })
})
