'use client'

import { memo } from 'react'
import type { Placement } from '@floating-ui/react'
import { cn } from '@/platform/utils'

function bubblePositionClass(placement: Placement): string {
  if (placement.startsWith('bottom')) return 'left-1/2 top-full mt-2 -translate-x-1/2'
  if (placement.startsWith('left')) return 'right-full top-1/2 mr-2 -translate-y-1/2'
  if (placement.startsWith('right')) return 'left-full top-1/2 ml-2 -translate-y-1/2'
  return 'bottom-full left-1/2 mb-2 -translate-x-1/2'
}

export const ThinkingBubble = memo(function ThinkingBubble({
  text,
  visible,
  placement = 'top',
}: {
  text: string
  visible: boolean
  placement?: Placement
}) {
  if (!visible) return null

  return (
    <div
      className={cn(
        'thin-scrollbar absolute z-40 max-h-36 w-[min(20rem,42vw)] overflow-y-auto rounded-lg border border-cyan-200/25 bg-slate-950/95 p-3 text-sm leading-6 text-cyan-50 shadow-2xl shadow-cyan-950/40 backdrop-blur',
        bubblePositionClass(placement),
      )}
    >
      {text ? text : <span className="italic text-cyan-100/60">思考中...</span>}
    </div>
  )
})
