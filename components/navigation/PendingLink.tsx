'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react'
import { cn } from '@/lib/utils'

type PendingLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string
  pendingClassName?: string
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
}

export const PendingLink = forwardRef<HTMLAnchorElement, PendingLinkProps>(
  ({ href, className, pendingClassName, onClick, target, ...props }, ref) => {
    const pathname = usePathname()
    const [pending, setPending] = useState(false)
    const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
      setPending(false)
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current)
        pendingTimer.current = null
      }
    }, [pathname])

    useEffect(() => {
      return () => {
        if (pendingTimer.current) clearTimeout(pendingTimer.current)
      }
    }, [])

    return (
      <Link
        ref={ref}
        href={href}
        target={target}
        aria-busy={pending}
        data-pending={pending ? 'true' : undefined}
        className={cn(className, pending && pendingClassName)}
        onClick={(event) => {
          onClick?.(event)
          if (event.defaultPrevented || isModifiedClick(event) || target === '_blank') return
          const nextPath = href.split(/[?#]/, 1)[0]
          if (nextPath !== pathname) {
            setPending(true)
            if (pendingTimer.current) clearTimeout(pendingTimer.current)
            pendingTimer.current = setTimeout(() => setPending(false), 6_000)
          }
        }}
        {...props}
      />
    )
  },
)
PendingLink.displayName = 'PendingLink'
