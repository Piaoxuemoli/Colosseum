'use client'

import { memo, useEffect, type RefObject } from 'react'
import {
  FloatingPortal,
  flip,
  offset,
  shift,
  size,
  useFloating,
  useTransitionStyles,
} from '@floating-ui/react'
import { autoUpdate } from '@floating-ui/react-dom'

export const ThinkingBubble = memo(function ThinkingBubble({
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
    strategy: 'fixed',
    placement: 'top',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({ fallbackPlacements: ['bottom'], padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, availableHeight, elements }) {
          elements.floating.style.maxWidth = `${Math.min(320, Math.max(200, availableWidth - 16))}px`
          elements.floating.style.maxHeight = `${Math.min(240, Math.max(120, availableHeight - 16))}px`
        },
      }),
    ],
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
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, ...styles }}
        className="thin-scrollbar z-50 max-w-xs overflow-y-auto rounded-lg border border-cyan-200/25 bg-slate-950/95 p-3 text-sm leading-6 text-cyan-50 shadow-2xl shadow-cyan-950/40 backdrop-blur"
      >
        {text ? text : <span className="italic text-cyan-100/60">思考中...</span>}
      </div>
    </FloatingPortal>
  )
})
