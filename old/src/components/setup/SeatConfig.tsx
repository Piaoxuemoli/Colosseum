import type { SessionSeatConfig } from '../../db/database'
import type { APIProfile } from '../../agent/llm-client'

interface SeatConfigCardProps {
  seat: SessionSeatConfig
  profiles: APIProfile[]
  onUpdate: (updates: Partial<SessionSeatConfig>) => void
}

type PlayerTypeOption = 'human' | 'llm' | 'bot' | 'empty'

const typeOptions: { value: PlayerTypeOption; emoji: string; label: string }[] = [
  { value: 'human', emoji: '👤', label: 'Human' },
  { value: 'llm', emoji: '🤖', label: 'LLM' },
  { value: 'bot', emoji: '🎯', label: 'Bot' },
  { value: 'empty', emoji: '⚫', label: 'Empty' },
]

/** Map seat type → Tailwind border color token */
function borderColorClass(type: string): string {
  const map: Record<string, string> = {
    human: 'border-tertiary',
    llm: 'border-on-tertiary-container',
    bot: 'border-secondary',
    empty: 'border-outline-variant',
  }
  return map[type] ?? 'border-outline-variant'
}

function iconColorClass(type: string): string {
  const map: Record<string, string> = {
    human: 'text-tertiary',
    llm: 'text-on-tertiary-container',
    bot: 'text-secondary',
    empty: 'text-outline-variant',
  }
  return map[type] ?? 'text-outline-variant'
}

function typeIcon(type: string): string {
  const map: Record<string, string> = {
    human: 'person',
    llm: 'smart_toy',
    bot: 'target',
    empty: 'block',
  }
  return map[type] ?? 'block'
}

export function SeatConfigCard({ seat, profiles, onUpdate }: SeatConfigCardProps) {
  const isEmpty = seat.type === 'empty'
  const isLLM = seat.type === 'llm'
  const isHuman = seat.type === 'human'

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newType = e.target.value as PlayerTypeOption
    const updates: Partial<SessionSeatConfig> = { type: newType }
    if (newType === 'empty') {
      updates.name = ''
      updates.profileId = undefined
    } else if (newType === 'llm') {
      updates.name = profiles[0]?.name || 'LLM Player'
      updates.profileId = profiles[0]?.id
    } else if (newType === 'bot') {
      updates.name = `Bot ${seat.seatIndex + 1}`
      updates.profileId = undefined
    } else if (newType === 'human') {
      updates.name = 'Player 1'
      updates.profileId = undefined
    }
    onUpdate(updates)
  }

  if (isEmpty) {
    return (
      <div className="bg-transparent rounded-xl p-5 border-2 border-dashed border-outline-variant opacity-50">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-outline-variant">{typeIcon(seat.type)}</span>
            <h4 className="font-bold text-lg text-outline-variant">座位 {seat.seatIndex + 1}</h4>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">
                类型
              </label>
              <select
                value={seat.type}
                onChange={handleTypeChange}
                className="w-full bg-surface-container-high/30 border-none rounded text-sm text-on-surface focus:ring-1 focus:ring-primary py-1.5"
              >
                {typeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.emoji} {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">
                昵称
              </label>
              <input
                type="text"
                disabled
                className="w-full bg-surface-container-high/30 border-none rounded text-sm text-on-surface/30 py-1.5 cursor-not-allowed"
              />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`bg-surface-container-low rounded-xl p-5 border-t-4 ${borderColorClass(seat.type)} relative overflow-hidden`}
    >
      {isHuman && (
        <div className="absolute top-0 right-0 p-2">
          <span className="bg-tertiary/20 text-tertiary text-[10px] font-bold px-2 py-0.5 rounded uppercase">
            Hero
          </span>
        </div>
      )}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className={`material-symbols-outlined ${iconColorClass(seat.type)}`}>
            {typeIcon(seat.type)}
          </span>
          <h4 className="font-bold text-lg">座位 {seat.seatIndex + 1}</h4>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">
              类型
            </label>
            <select
              value={seat.type}
              onChange={handleTypeChange}
              className="w-full bg-surface-container-high border-none rounded text-sm text-on-surface focus:ring-1 focus:ring-primary py-1.5"
            >
              {typeOptions.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.emoji} {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-on-surface-variant">
              {isLLM ? 'API 配置' : '昵称'}
            </label>
            {isLLM ? (
              <select
                value={seat.profileId || ''}
                onChange={e => {
                  const p = profiles.find(p => p.id === e.target.value)
                  onUpdate({ profileId: e.target.value, name: p?.name || seat.name })
                }}
                className="w-full bg-surface-container-high border-none rounded text-sm text-on-surface focus:ring-1 focus:ring-primary py-1.5"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {profiles.length === 0 && (
                  <option value="" disabled>无可用 API</option>
                )}
              </select>
            ) : (
              <input
                type="text"
                value={seat.name}
                onChange={e => onUpdate({ name: e.target.value })}
                className="w-full bg-surface-container-high border-none rounded text-sm text-on-surface focus:ring-1 focus:ring-primary py-1.5"
              />
            )}
          </div>
        </div>
        {isLLM && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={!!seat.useCustomPrompt}
                onClick={() => onUpdate({ useCustomPrompt: !seat.useCustomPrompt })}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${seat.useCustomPrompt ? 'bg-primary' : 'bg-outline-variant'}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${seat.useCustomPrompt ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
                />
              </button>
              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">
                自定义角色描述
              </span>
            </label>
            {seat.useCustomPrompt ? (
              <input
                type="text"
                value={seat.systemPrompt || ''}
                onChange={e => onUpdate({ systemPrompt: e.target.value })}
                placeholder="例: 激进风格的职业玩家"
                className="w-full bg-surface-container-high border-none rounded text-sm text-on-surface focus:ring-1 focus:ring-primary py-1.5"
              />
            ) : (
              <p className="text-[10px] text-on-surface-variant/50 italic">
                将使用统一角色描述
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
