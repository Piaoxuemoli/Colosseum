// Werewolf engine v2 — board parsing, semantic validation and built-in presets
// (WFR-101 / WFR-601 / WFR-602).
//
// Milestone gating lives here: guard / idiot / sheriff / v2 slots are
// registered as config fields, but boards that try to enable them are
// rejected with a structured, machine-readable issue — never silently wrong.

import type { BoardConfigInput, BoardIssue, ResolvedBoard, RoleId } from './types'
import { M1_ROLES, M2_ROLES, V2_ROLES, boardConfigSchema } from './types'
import { countByCamp, nightRolesInBoard } from './roles'

export type BoardParseResult =
  | { ok: true; board: ResolvedBoard }
  | { ok: false; issues: BoardIssue[] }

function milestoneOf(role: RoleId): string {
  if ((M2_ROLES as readonly string[]).includes(role)) return 'v1-M2'
  if ((V2_ROLES as readonly string[]).includes(role)) return 'v2'
  return 'v1-M1'
}

/**
 * Parse + semantically validate a board config (WFR-101 acceptance):
 * domain errors from zod and cross-field conflicts both come back as
 * structured issues naming the offending field.
 */
export function parseBoard(input: unknown): BoardParseResult {
  const parsed = boardConfigSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        code: issue.code,
        message: issue.message,
      })),
    }
  }
  const board = parsed.data
  const issues = validateBoardSemantics(board)
  return issues.length === 0 ? { ok: true, board } : { ok: false, issues }
}

function validateBoardSemantics(board: ResolvedBoard): BoardIssue[] {
  const issues: BoardIssue[] = []

  // --- milestone gating (WFR-103): unsupported roles / features -----------
  for (const [role, count] of Object.entries(board.roles) as Array<[RoleId, number]>) {
    if (count > 0 && !(M1_ROLES as readonly string[]).includes(role)) {
      issues.push({
        field: `roles.${role}`,
        code: 'unsupported-role',
        message: `role "${role}" is not supported until ${milestoneOf(role)} (WFR-103); v1-M1 boards may only use: ${M1_ROLES.join(', ')}`,
      })
    }
  }
  if (board.sheriffEnabled) {
    issues.push({
      field: 'sheriffEnabled',
      code: 'unsupported-feature',
      message: 'sheriff system ships with v1-M2 (WOD-2); v1-M1 boards must keep sheriffEnabled=false',
    })
  }
  if (board.speechOrderPolicy === 'sheriff-decides') {
    issues.push({
      field: 'speechOrderPolicy',
      code: 'unsupported-feature',
      message: 'speechOrderPolicy "sheriff-decides" requires the sheriff system (v1-M2)',
    })
  }
  if (board.roleMode !== 'hidden') {
    issues.push({
      field: 'roleMode',
      code: 'unsupported-feature',
      message: 'open-role mode is a v2 slot (param 25); only "hidden" is supported in v1-M1',
    })
  }
  for (const role of board.extendedRoles) {
    issues.push({
      field: `extendedRoles.${role}`,
      code: 'unsupported-role',
      message: `extended role "${role}" is a v2 slot (param 26) and cannot be enabled in v1-M1`,
    })
  }

  // --- composition sanity ---------------------------------------------------
  const wolves = board.roles.werewolf ?? 0
  const gods = countByCamp(board, 'god')
  const villagers = countByCamp(board, 'villager')
  const good = gods + villagers
  if (wolves === 0) {
    issues.push({ field: 'roles.werewolf', code: 'empty-faction', message: 'board needs at least one werewolf' })
  }
  if (good === 0) {
    issues.push({ field: 'roles', code: 'empty-faction', message: 'board needs at least one good player' })
  }
  if (board.winCondition === 'kill-side') {
    if (gods === 0) {
      issues.push({
        field: 'roles',
        code: 'degenerate-side',
        message: 'kill-side (屠边) board with zero gods would be terminal at start',
      })
    }
    if (villagers === 0) {
      issues.push({
        field: 'roles',
        code: 'degenerate-side',
        message: 'kill-side (屠边) board with zero villagers would be terminal at start',
      })
    }
  }
  if (board.winCondition === 'kill-all-parity' && wolves >= good && wolves > 0 && good > 0) {
    issues.push({
      field: 'winCondition',
      code: 'terminal-at-start',
      message: `kill-all-parity board starts settled (wolves ${wolves} >= good ${good})`,
    })
  }

  // --- night action order (param 15 / WFR-102 / AC-3) ----------------------
  const present = nightRolesInBoard(board)
  const declared = board.nightActionOrder
  const seen = new Set<string>()
  for (const step of declared) {
    if (seen.has(step)) {
      issues.push({ field: `nightActionOrder.${step}`, code: 'duplicate-step', message: `night step "${step}" declared twice` })
    }
    seen.add(step)
    // WFR-102-2: steps for roles absent from the board are silently skipped
    // (the default order always lists guard) — declaring them is legal.
  }
  for (const role of present) {
    if (!declared.includes(role)) {
      issues.push({
        field: `nightActionOrder.${role}`,
        code: 'missing-step',
        message: `board contains night role "${role}" but nightActionOrder does not declare it`,
      })
    }
  }
  // The witch must act after the wolves: she cannot answer the save question
  // before the knife target exists (WFR-203-2 / AC-3).
  if (present.includes('werewolf') && present.includes('witch')) {
    const wolfIdx = declared.indexOf('werewolf')
    const witchIdx = declared.indexOf('witch')
    if (wolfIdx > witchIdx) {
      issues.push({
        field: 'nightActionOrder',
        code: 'param-conflict',
        message: 'witch must act after werewolves in nightActionOrder (WFR-203-2: the knife target must be revealed to the witch before her save decision)',
      })
    }
  }

  return issues
}

// ---------------------------------------------------------------------------
// Built-in presets (WFR-601)
// ---------------------------------------------------------------------------

/** Presets may declare only the roles they seat (absent roles count 0). */
export type BoardPreset = Omit<BoardConfigInput, 'roles'> & {
  roles: Partial<Record<RoleId, number>>
}

/** 板子 A：6 人基础板（新手局，屠城 + parity）. */
export const BOARD_PRESET_6P_BASE: BoardPreset = {
  roles: { werewolf: 2, seer: 1, witch: 1, villager: 2 },
  winCondition: 'kill-all-parity',
  sheriffEnabled: false,
  lastWordsPolicy: 'first-night-and-day',
  witchSelfSavePolicy: 'first-night-only',
  deathCauseRevealed: false,
  roleRevealedOnDeath: false,
  voteTiePolicy: 'pk-revote-then-nobody',
  speechOrderPolicy: 'from-dead-next',
  emptyKillAllowed: true,
  selfKillAllowed: true,
  maxDays: 40,
  nightActionOrder: ['guard', 'werewolf', 'witch', 'seer'],
  speechMaxLength: 200,
  lastWordsMaxLength: 200,
}

/** 板子 B：9 人 333 标准板（预女猎，屠边；警长为 M2 插槽，默认关）. */
export const BOARD_PRESET_9P_333: BoardPreset = {
  roles: { seer: 1, witch: 1, hunter: 1, villager: 3, werewolf: 3 },
  winCondition: 'kill-side',
  sheriffEnabled: false,
  lastWordsPolicy: 'first-night-and-day',
  witchSelfSavePolicy: 'first-night-only',
  deathCauseRevealed: false,
  roleRevealedOnDeath: false,
  voteTiePolicy: 'pk-revote-then-nobody',
  speechOrderPolicy: 'from-dead-next',
  emptyKillAllowed: true,
  selfKillAllowed: true,
  maxDays: 40,
  nightActionOrder: ['guard', 'werewolf', 'witch', 'seer'],
  speechMaxLength: 300,
  lastWordsMaxLength: 300,
}

/**
 * Reference a preset with parameter overrides (WFR-602). Parameters merge
 * shallowly; `roles` merges per-role so a single count can be tweaked.
 * The result is fully revalidated, so out-of-domain or milestone-gated
 * overrides fail loudly with structured issues.
 */
export function presetBoard(
  preset: BoardPreset,
  overrides: Partial<BoardPreset> = {},
): BoardParseResult {
  const { roles: presetRoles, ...rest } = preset
  const { roles: overrideRoles, ...restOverrides } = overrides
  return parseBoard({
    ...rest,
    ...restOverrides,
    roles: { ...presetRoles, ...overrideRoles },
  })
}
