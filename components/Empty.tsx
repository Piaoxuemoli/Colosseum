import type { ReactNode } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Button } from './ui/button'

/**
 * Shared empty-state card used by Lobby, Agents, Profiles, etc.
 *
 * Renders in server components because the CTA is a plain anchor (`href`) or
 * an explicit React node. For callers that need a client-side onClick, pass
 * a `<Button onClick=…>` as `cta={{ node: … }}`.
 */
export type EmptyProps = {
  title: string
  description: string
  cta?:
    | { label: string; href: string }
    | { node: ReactNode }
  icon?: ReactNode
}

export function Empty({ title, description, cta, icon }: EmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-neutral-950/30 px-6 py-12 text-center">
      <div className="mb-3 text-cyan-200/80">{icon ?? <Sparkles size={32} />}</div>
      <div className="mb-1 text-lg font-semibold text-white">{title}</div>
      <div className="mb-4 max-w-md text-sm leading-6 text-muted-foreground">{description}</div>
      {cta ? (
        'node' in cta ? (
          cta.node
        ) : (
          <Button asChild>
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        )
      ) : null}
    </div>
  )
}
