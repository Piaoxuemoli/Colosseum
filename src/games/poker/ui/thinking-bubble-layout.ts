import type { Placement } from '@floating-ui/react'

export const THINKING_BUBBLE_VISIBLE_MS = 4500

export function bubblePlacementForSeat(seatIndex: number, compact = false): Placement {
  if (compact) return 'top'

  switch (seatIndex) {
    case 0:
      return 'top'
    case 1:
      return 'top-start'
    case 2:
      return 'bottom-start'
    case 3:
      return 'bottom'
    case 4:
      return 'bottom-end'
    case 5:
      return 'top-end'
    default:
      return 'top'
  }
}

export function shouldKeepBubbleOpen({
  text,
  visible,
  lastUpdatedAt,
  now,
  maxAgeMs = THINKING_BUBBLE_VISIBLE_MS,
}: {
  text: string
  visible: boolean
  lastUpdatedAt: number
  now: number
  maxAgeMs?: number
}): boolean {
  if (!visible) return false
  if (text.trim().length === 0) return false
  return now - lastUpdatedAt < maxAgeMs
}
