// 主持人旁白（R3-3 / FR-4.7-01）测试脚手架：WerewolfEvent → V2Event 信封
// 映射（与 plugin-v2.toV2Event 同口径），供触发判定与 backend 编排测试共用。

import type { V2Event } from '@/platform/engine/contracts-v2'
import type { WerewolfEvent } from '@/games/werewolf/engine2'

export function toV2Event(event: WerewolfEvent): V2Event {
  const audience = event.audience
  switch (audience.kind) {
    case 'public':
      return envelope(event, { kind: 'public' })
    case 'wolves':
      return envelope(event, { kind: 'wolves' })
    case 'moderator':
      return envelope(event, { kind: 'moderator' })
    case 'sheriff':
      return envelope(event, { kind: 'sheriff' })
    case 'role-self':
      return envelope(event, { kind: 'self', scope: 'role-self', agentId: audience.playerId })
  }
}

function envelope(event: WerewolfEvent, audience: V2Event['audience']): V2Event {
  return {
    kind: event.kind,
    seq: event.seq,
    actorAgentId: event.actorId,
    isDefault: event.isDefault === true,
    audience,
    raw: { ...event },
  }
}
