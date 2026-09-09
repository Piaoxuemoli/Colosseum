/**
 * 游戏品类展示标签（前端共享文案层）。
 *
 * 只做 gameType → 中文标签 / 阶段进度文案的映射——纯文案，不含任何
 * 游戏规则逻辑（红线：游戏逻辑归 games/*，此处仅渲染层词汇表）。
 */

export const GAME_LABELS: Record<string, string> = {
  poker: '德州扑克',
  werewolf: '狼人杀',
  avalon: '阿瓦隆',
}

export function gameLabel(gameType: string): string {
  return GAME_LABELS[gameType] ?? gameType
}

/** 直播卡片 / 列表行的阶段进度文案（来自引擎 stateSummary 的机械量）。 */
export function phaseProgressText(
  gameType: string,
  summary: { handNumber: number; day: number; phase: string } | null | undefined,
): string | null {
  if (!summary) return null
  if (gameType === 'poker') {
    if (summary.handNumber > 0) return summary.phase ? `第 ${summary.handNumber} 手 · ${summary.phase}` : `第 ${summary.handNumber} 手`
    return summary.phase || null
  }
  if (gameType === 'werewolf') {
    const isNight = summary.phase.startsWith('night')
    return `第 ${isNight ? summary.day + 1 : summary.day} ${isNight ? '夜' : '天'}`
  }
  if (gameType === 'avalon') {
    const phaseZh: Record<string, string> = {
      discussion: '讨论',
      proposal: '提名',
      teamVote: '表决',
      quest: '任务',
      evilConsultation: '密谋',
      assassination: '刺杀',
      ended: '终局',
    }
    return `第 ${summary.day} 轮 · ${phaseZh[summary.phase] ?? summary.phase}`
  }
  return summary.phase
}
