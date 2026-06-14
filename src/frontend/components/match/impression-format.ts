export function observedCountLabel(
  gameType: 'poker' | 'werewolf',
  profile: Record<string, unknown>,
  fallbackCount: number,
): string {
  if (gameType === 'poker') {
    const handCount = profile.handCount
    const count = typeof handCount === 'number' && Number.isFinite(handCount) ? handCount : fallbackCount
    return `${count} 手`
  }
  return `${fallbackCount} 局`
}
