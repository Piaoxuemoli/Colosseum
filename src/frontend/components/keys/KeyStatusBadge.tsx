'use client'

import { Badge } from '@/frontend/components/ui/badge'
import type { KeyStatus } from '@/frontend/lib/client/keyring'
import { cn } from '@/platform/utils'

/**
 * 密钥健康状态徽章（FR-4.1-03）。
 * 语义色对齐 design-system：success=emerald / warning=amber / danger=red。
 */

export const KEY_STATUS_LABELS: Record<KeyStatus, string> = {
  ok: '可用',
  expiring: '即将过期',
  expired: '已过期',
  missing: '未配置',
}

const KEY_STATUS_CLASSNAMES: Record<KeyStatus, string> = {
  ok: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  expiring: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  expired: 'border-red-400/30 bg-red-500/10 text-red-200',
  missing: 'border-red-400/30 bg-red-500/10 text-red-200',
}

export function KeyStatusBadge({ status, className }: { status: KeyStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(KEY_STATUS_CLASSNAMES[status], className)}>
      {KEY_STATUS_LABELS[status]}
    </Badge>
  )
}
