'use client'

import { memo } from 'react'
import type { Placement } from '@floating-ui/react'
import { cn } from '@/platform/utils'

function bubblePositionClass(placement: Placement): string {
  if (placement === 'bottom-start') return 'left-0 top-full mt-2'
  if (placement === 'bottom-end') return 'right-0 top-full mt-2'
  if (placement.startsWith('bottom')) return 'left-1/2 top-full mt-2 -translate-x-1/2'
  if (placement === 'left-start') return 'bottom-0 right-full mr-2'
  if (placement === 'left-end') return 'right-full top-0 mr-2'
  if (placement.startsWith('left')) return 'right-full top-1/2 mr-2 -translate-y-1/2'
  if (placement === 'right-start') return 'bottom-0 left-full ml-2'
  if (placement === 'right-end') return 'left-full top-0 ml-2'
  if (placement.startsWith('right')) return 'left-full top-1/2 ml-2 -translate-y-1/2'
  if (placement === 'top-start') return 'bottom-full left-0 mb-2'
  if (placement === 'top-end') return 'bottom-full right-0 mb-2'
  return 'bottom-full left-1/2 mb-2 -translate-x-1/2'
}

export const ThinkingBubble = memo(function ThinkingBubble({
  text,
  visible,
  placement = 'top',
  compact = false,
}: {
  text: string
  visible: boolean
  placement?: Placement
  compact?: boolean
}) {
  if (!visible) return null

  return (
    <div
      className={cn(
        'thin-scrollbar pointer-events-none absolute z-40 max-h-28 overflow-y-auto break-words rounded-lg border border-cyan-200/25 bg-slate-950/95 p-2.5 text-xs leading-5 text-cyan-50 shadow-2xl shadow-cyan-950/40 backdrop-blur xl:max-h-32 xl:text-sm xl:leading-6',
        compact ? 'w-[min(14rem,46vw)]' : 'w-[min(17rem,34vw)] min-w-48 xl:w-[min(18rem,30vw)]',
        bubblePositionClass(placement),
      )}
    >
      {text ? text : <span className="italic text-cyan-100/60">思考中...</span>}
    </div>
  )
})
