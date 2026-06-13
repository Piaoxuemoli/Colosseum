import { useState } from 'react'
import type { ImpressionsMap, ImpressionHistoryEntry } from '../../store/game-store'
import type { StructuredImpression } from '../../types/player'

interface ImpressionPanelProps {
  impressions: ImpressionsMap
  players: { id: string; name: string; type: string }[]
  sessionId: string
  handNumber: number
  impressionHistory: ImpressionHistoryEntry[]
}

/**
 * ImpressionPanel — shows each LLM player's structured 4-dimension impressions.
 * Grouped by LLM player, each row shows L/A/S/H scores + note.
 * Highlights impressions that were updated in the current hand.
 */
export function ImpressionPanel({ impressions, players, sessionId, handNumber, impressionHistory }: ImpressionPanelProps) {
  const llmPlayers = players.filter(p => p.type === 'llm')

  if (llmPlayers.length === 0) {
    return (
      <div className="p-6 text-center text-on-surface-variant text-xs">
        <span className="material-symbols-outlined text-3xl mb-2 block">psychology</span>
        当前对局没有 LLM 玩家
      </div>
    )
  }

  const hasAnyImpressions = llmPlayers.some(p => impressions[p.id] && Object.keys(impressions[p.id]).length > 0)

  if (!hasAnyImpressions) {
    return (
      <div className="p-6 text-center text-on-surface-variant text-xs">
        <span className="material-symbols-outlined text-3xl mb-2 block">hourglass_empty</span>
        <p>印象将在第一手牌结束后生成</p>
        <p className="mt-1 text-on-surface-variant/50">
          Session: {sessionId.slice(0, 8)}… · 手牌 #{handNumber}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="text-[10px] text-on-surface-variant/50 text-right">
        Session {sessionId.slice(0, 8)}… · 手牌 #{handNumber}
      </div>
      {llmPlayers.map(llm => {
        const llmImpressions = impressions[llm.id]
        if (!llmImpressions || Object.keys(llmImpressions).length === 0) return null

        return (
          <ImpressionCard
            key={llm.id}
            llmId={llm.id}
            llmName={llm.name}
            impressions={llmImpressions}
            players={players}
            handNumber={handNumber}
            impressionHistory={impressionHistory}
          />
        )
      })}
    </div>
  )
}

// ---------- Dimension Badge ----------

function DimensionBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${color}`}>
      {label}={value.toFixed(1)}
    </span>
  )
}

// ---------- Sub-components ----------

interface ImpressionCardProps {
  llmId: string
  llmName: string
  impressions: Record<string, StructuredImpression>
  players: { id: string; name: string; type: string }[]
  handNumber: number
  impressionHistory: ImpressionHistoryEntry[]
}

function ImpressionCard({ llmId, llmName, impressions, players, handNumber, impressionHistory }: ImpressionCardProps) {
  const [expanded, setExpanded] = useState(true)

  // Find the latest hand number each impression was updated
  const getLastUpdateHand = (targetId: string): number | null => {
    const entries = impressionHistory.filter(e => e.playerId === llmId && e.targetId === targetId)
    if (entries.length === 0) return null
    return entries[entries.length - 1].handNumber
  }

  const entries = Object.entries(impressions).map(([targetId, imp]) => {
    const target = players.find(p => p.id === targetId)
    const lastUpdateHand = getLastUpdateHand(targetId)
    const isRecentlyUpdated = lastUpdateHand === handNumber
    return { targetId, targetName: target?.name || targetId, targetType: target?.type || 'bot', imp, lastUpdateHand, isRecentlyUpdated }
  })

  if (entries.length === 0) return null

  const typeIcon: Record<string, string> = {
    human: 'person', llm: 'smart_toy', bot: 'target',
  }
  const typeColor: Record<string, string> = {
    human: 'text-tertiary', llm: 'text-on-tertiary-container', bot: 'text-secondary',
  }

  const recentCount = entries.filter(e => e.isRecentlyUpdated).length

  return (
    <div className="bg-surface-container rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-container-high transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-on-tertiary-container text-sm">smart_toy</span>
          <span className="text-xs font-bold text-on-surface">{llmName}</span>
          <span className="text-[10px] text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded">
            {entries.length} 条印象
          </span>
          {recentCount > 0 && (
            <span className="text-[10px] text-primary bg-primary/15 px-1.5 py-0.5 rounded font-bold animate-pulse">
              {recentCount} 条更新
            </span>
          )}
        </div>
        <span className="material-symbols-outlined text-on-surface-variant text-sm transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : '' }}>
          expand_more
        </span>
      </button>

      {/* Entries */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {entries.map(({ targetId, targetName, targetType, imp, lastUpdateHand, isRecentlyUpdated }) => (
            <div
              key={targetId}
              className={`rounded-lg px-2 py-1.5 transition-colors ${isRecentlyUpdated ? 'bg-primary/10 border border-primary/20' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`material-symbols-outlined text-xs ${typeColor[targetType] || 'text-on-surface-variant'}`}>
                  {typeIcon[targetType] || 'person'}
                </span>
                <span className="text-[10px] font-bold text-on-surface-variant">{targetName}</span>
                <span className="text-[9px] text-on-surface-variant/60">({imp.handCount}手)</span>
                {lastUpdateHand != null && (
                  <span className={`text-[9px] px-1 py-0.5 rounded ${isRecentlyUpdated ? 'bg-primary/20 text-primary font-bold' : 'bg-surface-container-high text-on-surface-variant/60'}`}>
                    第{lastUpdateHand}手更新
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1 ml-5">
                <DimensionBadge label="L" value={imp.looseness} color="bg-blue-500/15 text-blue-300" />
                <DimensionBadge label="A" value={imp.aggression} color="bg-red-500/15 text-red-300" />
                <DimensionBadge label="S" value={imp.stickiness} color="bg-amber-500/15 text-amber-300" />
                <DimensionBadge label="H" value={imp.honesty} color="bg-green-500/15 text-green-300" />
              </div>
              {imp.note && (
                <p className="text-[11px] text-on-surface leading-snug mt-1 ml-5">
                  "{imp.note}"
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Toggle Button ----------

interface ImpressionToggleProps {
  isOpen: boolean
  onToggle: () => void
  count: number
}

export function ImpressionToggle({ isOpen, onToggle, count }: ImpressionToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center space-x-2 glass-panel px-4 py-2 rounded-full hover:bg-surface-container-highest transition-all group z-10 ${isOpen ? 'bg-primary/10 border border-primary/30' : ''}`}
      title="查看 LLM 印象"
    >
      <span className={`material-symbols-outlined ${isOpen ? 'text-primary' : 'text-on-surface-variant'} group-hover:scale-110 transition-transform`}>
        psychology
      </span>
      <span className="text-xs font-label uppercase tracking-wider font-semibold">
        印象
      </span>
      {count > 0 && (
        <span className="text-[10px] bg-primary/20 text-primary font-bold px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </button>
  )
}

// ---------- Slide-over Drawer ----------

interface ImpressionDrawerProps {
  isOpen: boolean
  onClose: () => void
  impressions: ImpressionsMap
  players: { id: string; name: string; type: string }[]
  sessionId: string
  handNumber: number
  impressionHistory: ImpressionHistoryEntry[]
}

export function ImpressionDrawer({ isOpen, onClose, impressions, players, sessionId, handNumber, impressionHistory }: ImpressionDrawerProps) {
  if (!isOpen) return null

  return (
    <div className="absolute top-0 right-80 bottom-0 w-72 bg-surface-container-low border-r border-outline-variant/10 shadow-2xl z-20 flex flex-col animate-slide-in">
      {/* Header */}
      <div className="p-4 border-b border-outline-variant/10 flex items-center justify-between">
        <h3 className="font-headline font-bold text-sm tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-sm">psychology</span>
          LLM 印象系统
        </h3>
        <button onClick={onClose} className="p-1 hover:bg-surface-container-high rounded transition-colors">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">close</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <ImpressionPanel
          impressions={impressions}
          players={players}
          sessionId={sessionId}
          handNumber={handNumber}
          impressionHistory={impressionHistory}
        />
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-outline-variant/10 text-[10px] text-on-surface-variant/50 text-center">
        印象跨对局累积（EMA α=0.3），每手结束后更新
      </div>
    </div>
  )
}
