'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  forwardRef,
  useEffect,
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

    useEffect(() => {
      setPending(false)
    }, [pathname])

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
          if (nextPath !== pathname) setPending(true)
        }}
        {...props}
      />
    )
  },
)
PendingLink.displayName = 'PendingLink'
