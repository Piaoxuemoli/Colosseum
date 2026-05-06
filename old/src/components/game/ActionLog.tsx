import { useState, useEffect, useRef } from 'react'
import type { ActionLogEntry, PhaseHeader, ProbabilityEntry } from '../../types/ui'
import { LiveRanking } from './LiveRanking'

// ── Thinking chain entry (re-exported for compatibility) ──

export interface ThinkingChainEntry {
  playerId: string
  playerName: string
  content: string
}

// ── Helpers ──

function textColorClass(token: string): string {
  const map: Record<string, string> = {
    secondary: 'text-secondary', tertiary: 'text-tertiary',
    'on-tertiary-container': 'text-on-tertiary-container',
    'on-surface-variant': 'text-on-surface-variant',
    primary: 'text-primary', error: 'text-error',
  }
  return map[token] ?? 'text-on-surface-variant'
}

function dotColorClass(token: string): string {
  const map: Record<string, string> = {
    secondary: 'bg-secondary', tertiary: 'bg-tertiary',
    'on-tertiary-container': 'bg-on-tertiary-container', error: 'bg-error',
  }
  return map[token] ?? 'bg-on-surface-variant'
}

function phaseBgClass(token: string): string {
  const map: Record<string, string> = {
    'surface-container': 'bg-surface-container',
    'primary-container/20': 'bg-primary-container/20',
  }
  return map[token] ?? 'bg-surface-container'
}

function isPhaseHeader(entry: unknown): entry is PhaseHeader {
  return typeof entry === 'object' && entry !== null && 'phase' in entry && !('action' in entry)
}

type TabId = 'log' | 'thinking' | 'data'

// ── Tab Button ──

function TabButton({ id, active, label, icon, badge, highlight, onClick }: {
  id: TabId; active: boolean; label: string; icon: string
  badge?: number; highlight?: boolean; onClick: (id: TabId) => void
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex-1 flex items-center justify-center gap-1 py-2.5
        text-[9px] font-bold tracking-wide transition-colors
        ${active
          ? 'text-primary border-b-2 border-primary'
          : 'text-on-surface-variant/35 hover:text-on-surface-variant/60'}`}
    >
      <span className="material-symbols-outlined text-xs">{icon}</span>
      {label}
      {badge != null && badge > 0 && (
        <span className={`text-[7px] px-1.5 py-0.5 rounded-full font-bold
          ${highlight ? 'bg-primary text-on-primary animate-pulse' : 'bg-primary/20 text-primary'}`}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ── Log Tab Content ──

function LogTab({ entries }: { entries: (ActionLogEntry | PhaseHeader)[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
      {entries.map((entry, i) => {
        if (isPhaseHeader(entry)) {
          return (
            <div key={i}>
              {i > 0 && <div className="h-px bg-outline-variant/10 my-3" />}
              <div className={`text-[8px] font-label font-bold ${textColorClass(entry.phaseColor)}
                uppercase tracking-widest ${phaseBgClass(entry.phaseBg)} px-2 py-0.5 rounded inline-block`}>
                {entry.phase}
              </div>
            </div>
          )
        }
        const logEntry = entry as ActionLogEntry
        return (
          <div key={i} className={`flex items-start gap-2 text-xs
            ${logEntry.highlight ? 'p-1.5 bg-primary/5 rounded border-l-2 border-primary' : ''}`}
            style={{ opacity: logEntry.opacity ?? 1 }}>
            <div className={`w-[5px] h-[5px] mt-1 rounded-full flex-shrink-0 ${dotColorClass(logEntry.playerColor)}`} />
            <p className="text-on-surface-variant">
              <span className={`${textColorClass(logEntry.playerColor)} font-bold`}>{logEntry.playerName}</span>
              {' '}{logEntry.action}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Thinking Tab Content ──

function ThinkingTab({ thinkingChain, onThinkingClick }: {
  thinkingChain: ThinkingChainEntry[]
  onThinkingClick?: (entry: ThinkingChainEntry) => void
}) {
  const [collapsedIndices, setCollapsedIndices] = useState<Set<number>>(new Set())

  const toggleCollapse = (index: number) => {
    setCollapsedIndices(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index); else next.add(index)
      return next
    })
  }

  if (thinkingChain.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface-variant/30 text-xs">
        暂无思考记录
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
      {thinkingChain.map((entry, i) => {
        const isCollapsed = collapsedIndices.has(i)
        return (
          <div
            key={i}
            className="bg-surface-container-lowest p-3 rounded-lg border-l-2 border-primary cursor-pointer hover:bg-surface-container transition-colors"
            onClick={() => onThinkingClick?.(entry)}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-primary/60 font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">psychology</span>
                #{i + 1} {entry.playerName}
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); toggleCollapse(i) }}
                className="p-0.5 hover:bg-surface-container-high rounded transition-colors"
              >
                <span className="material-symbols-outlined text-[10px] text-on-surface-variant">
                  {isCollapsed ? 'expand_more' : 'expand_less'}
                </span>
              </button>
            </div>
            {!isCollapsed && (
              <p className="text-[11px] leading-relaxed text-on-surface-variant italic line-clamp-4">
                {entry.content}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Data Tab Content ──

function DataTab({ probabilityMatrix }: {
  probabilityMatrix?: ProbabilityEntry[]
}) {
  if (!probabilityMatrix || probabilityMatrix.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface-variant/30 text-xs">
        等待数据...
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 min-h-0">
      <div className="text-[9px] font-bold uppercase tracking-widest text-on-surface/40 mb-3 flex items-center gap-1">
        <span className="material-symbols-outlined text-xs">bar_chart</span>
        Probability Matrix
      </div>
      <div className="space-y-2">
        {probabilityMatrix.map((entry) => (
          <div key={entry.name}>
            <div className="flex justify-between text-[10px]">
              <span>{entry.name} (Win%)</span>
              <span className={textColorClass(entry.color)}>{entry.winPercent}%</span>
            </div>
            <div className="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
              <div
                className={`h-full ${entry.color === 'primary' ? 'bg-primary' : 'bg-tertiary'}`}
                style={{ width: `${entry.winPercent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Player View Action Log (with tabs) ──

interface PlayerActionLogProps {
  entries: (ActionLogEntry | PhaseHeader)[]
  thinkingChain?: ThinkingChainEntry[]
  onThinkingClick?: (entry: ThinkingChainEntry) => void
}

export function PlayerActionLog({ entries, thinkingChain, onThinkingClick }: PlayerActionLogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('log')
  const [thinkingHighlight, setThinkingHighlight] = useState(false)
  const prevThinkingCount = useRef(thinkingChain?.length ?? 0)

  // Flash thinking badge when new entry arrives
  useEffect(() => {
    const count = thinkingChain?.length ?? 0
    if (count > prevThinkingCount.current && activeTab !== 'thinking') {
      setThinkingHighlight(true)
      const timer = setTimeout(() => setThinkingHighlight(false), 1000)
      prevThinkingCount.current = count
      return () => clearTimeout(timer)
    }
    prevThinkingCount.current = count
  }, [thinkingChain?.length, activeTab])

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-outline-variant/10">
        <TabButton id="log" active={activeTab === 'log'} label="日志" icon="history" onClick={setActiveTab} />
        <TabButton id="thinking" active={activeTab === 'thinking'} label="思考链" icon="psychology"
          badge={thinkingChain?.length} highlight={thinkingHighlight} onClick={setActiveTab} />
      </div>

      {/* Tab content */}
      {activeTab === 'log' && <LogTab entries={entries} />}
      {activeTab === 'thinking' && (
        <ThinkingTab thinkingChain={thinkingChain ?? []} onThinkingClick={onThinkingClick} />
      )}
    </div>
  )
}

// ── Spectator Action Log (with tabs + ranking) ──

interface SpectatorActionLogProps {
  entries: (ActionLogEntry | PhaseHeader)[]
  probabilityMatrix?: ProbabilityEntry[]
  thinkingChain?: ThinkingChainEntry[]
  onThinkingClick?: (entry: ThinkingChainEntry) => void
  rankingPlayers?: { id: string; name: string; type: string; chips: number }[]
  prevHandRanks?: Record<string, number>
  firstPlaceStreak?: number
  firstPlacePlayerId?: string | null
}

export function SpectatorActionLog({
  entries, probabilityMatrix, thinkingChain, onThinkingClick,
  rankingPlayers, prevHandRanks, firstPlaceStreak, firstPlacePlayerId,
}: SpectatorActionLogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('log')
  const [thinkingHighlight, setThinkingHighlight] = useState(false)
  const prevThinkingCount = useRef(thinkingChain?.length ?? 0)

  useEffect(() => {
    const count = thinkingChain?.length ?? 0
    if (count > prevThinkingCount.current && activeTab !== 'thinking') {
      setThinkingHighlight(true)
      const timer = setTimeout(() => setThinkingHighlight(false), 1000)
      prevThinkingCount.current = count
      return () => clearTimeout(timer)
    }
    prevThinkingCount.current = count
  }, [thinkingChain?.length, activeTab])

  return (
    <aside className="w-80 bg-surface-container-low border-l border-outline-variant/10 flex flex-col z-30">
      {/* Tab bar */}
      <div className="flex border-b border-outline-variant/10">
        <TabButton id="log" active={activeTab === 'log'} label="日志" icon="history" onClick={setActiveTab} />
        <TabButton id="thinking" active={activeTab === 'thinking'} label="思考链" icon="psychology"
          badge={thinkingChain?.length} highlight={thinkingHighlight} onClick={setActiveTab} />
        <TabButton id="data" active={activeTab === 'data'} label="数据" icon="bar_chart" onClick={setActiveTab} />
      </div>

      {/* Tab content */}
      {activeTab === 'log' && <LogTab entries={entries} />}
      {activeTab === 'thinking' && (
        <ThinkingTab thinkingChain={thinkingChain ?? []} onThinkingClick={onThinkingClick} />
      )}
      {activeTab === 'data' && <DataTab probabilityMatrix={probabilityMatrix} />}

      {/* Fixed bottom: live ranking (always visible) */}
      {rankingPlayers && rankingPlayers.length > 0 && (
        <LiveRanking
          players={rankingPlayers}
          prevRanks={prevHandRanks || {}}
          firstPlaceStreak={firstPlaceStreak || 0}
          firstPlacePlayerId={firstPlacePlayerId || null}
        />
      )}
    </aside>
  )
}
