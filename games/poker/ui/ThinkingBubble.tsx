'use client'

import { useEffect, type RefObject } from 'react'
import { autoPlacement, offset, shift, useFloating, useTransitionStyles } from '@floating-ui/react'

export function ThinkingBubble({
  anchorRef,
  text,
  visible,
}: {
  anchorRef: RefObject<HTMLElement | null>
  text: string
  visible: boolean
}) {
  const { refs, floatingStyles, context } = useFloating({
    open: visible,
    middleware: [autoPlacement({ allowedPlacements: ['top', 'bottom', 'left', 'right'] }), offset(10), shift({ padding: 8 })],
  })

  useEffect(() => {
    refs.setReference(anchorRef.current)
  }, [anchorRef, refs])

  const { isMounted, styles } = useTransitionStyles(context, {
    duration: 150,
    initial: { opacity: 0, transform: 'scale(0.95)' },
    open: { opacity: 1, transform: 'scale(1)' },
  })

  if (!isMounted) return null

  return (
    <div
      ref={refs.setFloating}
      style={{ ...floatingStyles, ...styles }}
      className="z-50 max-w-xs rounded-2xl border border-cyan-200/25 bg-slate-950/90 p-3 text-sm leading-6 text-cyan-50 shadow-2xl shadow-cyan-950/40 backdrop-blur"
    >
      {text ? text : <span className="italic text-cyan-100/60">思考中...</span>}
    </div>
  )
}
