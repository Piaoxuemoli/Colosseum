import { useEffect, useState } from 'react'
import { useHistoryStore } from '../store/history-store'
import { Navbar } from '../components/layout/Navbar'
import { HandList } from '../components/history/HandList'
import { HandDetail } from '../components/history/HandDetail'
import { ChipChart } from '../components/history/ChipChart'
import type { HandHistoryEntry, SessionSummary } from '../types/ui'
import type { HandHistory } from '../types/history'

// Convert real HandHistory to mock HandHistoryEntry for HandList component
function historyToMock(h: HandHistory): HandHistoryEntry {
  const steps: HandHistoryEntry['steps'] = []

  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    const streetData = h.streets[street]
    for (const action of streetData.actions) {
      const player = h.players.find(p => p.id === action.playerId)
      const actionNames: Record<string, string> = {
        postSmallBlind: `posted SB $${action.amount}`,
        postBigBlind: `posted BB $${action.amount}`,
        fold: 'folded', check: 'checked',
        call: `called $${action.amount}`,
        bet: `bet $${action.amount}`,
        raise: `raised to $${action.amount}`,
        allIn: `all-in $${action.amount}`,
      }
      steps.push({
        phase: street,
        action: `${player?.name || action.playerId} ${actionNames[action.type] || action.type}`,
        communityCards: [null, null, null, null, null],
      })
    }
  }

  const winnerPlayer = h.winners[0]
    ? h.players.find(p => p.id === h.winners[0].playerId)?.name || h.winners[0].playerId
    : 'Unknown'

  return {
    id: h.id,
    handNumber: h.handNumber,
    date: new Date(h.timestamp).toLocaleString('zh-CN'),
    participants: h.players.map(p => p.name),
    winner: winnerPlayer,
    winAmount: h.winners.reduce((sum, w) => sum + w.amount, 0),
    steps,
  }
}

// ---------- Session List ----------

function SessionList({ sessions, selectedSessionId, onSelect }: {
  sessions: SessionSummary[]
  selectedSessionId: string | null
  onSelect: (sessionId: string) => void
}) {
  return (
    <div className="w-72 bg-surface-container border-r border-outline-variant/10 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-outline-variant/10">
        <h3 className="font-headline font-bold text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-sm text-primary">folder</span>
          场次列表
        </h3>
        <p className="text-[10px] text-on-surface-variant mt-1">共 {sessions.length} 场</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map(session => {
          const isSelected = session.sessionId === selectedSessionId
          return (
            <button
              key={session.sessionId}
              onClick={() => onSelect(session.sessionId)}
              className={`w-full text-left px-4 py-3 border-b border-outline-variant/5 transition-colors ${isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-surface-container-high'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-on-surface">
                  Session #{session.sessionId.slice(0, 8)}
                </span>
                <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-bold">
                  {session.handCount} 局
                </span>
              </div>
              <div className="text-[10px] text-on-surface-variant">
                {new Date(session.startTime).toLocaleString('zh-CN')}
              </div>
              <div className="text-[10px] text-on-surface-variant mt-0.5 truncate">
                参与者: {session.playerNames.join(', ')}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function HistoryPage() {
  const {
    histories, selectedHistory,
    sessions, selectedSessionId, filteredHistories,
    loadHistories, selectHistory, selectSession, clearHistories,
  } = useHistoryStore()
  const [tab, setTab] = useState<'log' | 'chart'>('log')
  const [chartSessionId, setChartSessionId] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  useEffect(() => {
    loadHistories()
  }, [loadHistories])

  // When a session is selected, show its hands; otherwise show session list
  const handsToShow = selectedSessionId ? filteredHistories : histories
  const mockHands = handsToShow.map(historyToMock)
  const selectedHandId = selectedHistory?.id || mockHands[0]?.id

  function handleSelectHand(id: string) {
    const history = (selectedSessionId ? filteredHistories : histories).find(h => h.id === id)
    selectHistory(history || null)
  }

  function handleBackToSessions() {
    selectSession(null)
  }

  function handleClearAll() {
    clearHistories()
    setShowClearConfirm(false)
  }

  if (histories.length === 0) {
    return (
      <div className="bg-background text-on-surface font-body h-screen flex flex-col overflow-hidden">
        <Navbar />
        <div className="flex-1 flex relative overflow-hidden">
          <div className="ml-20 flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <span className="material-symbols-outlined text-6xl text-on-surface-variant">history</span>
              <h2 className="font-headline text-2xl font-bold">暂无对局记录</h2>
              <p className="text-on-surface-variant">完成一局游戏后，记录将显示在这里</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background text-on-surface font-body h-screen flex flex-col overflow-hidden">
      <Navbar />
      <div className="flex-1 flex relative overflow-hidden">
        <div className="ml-20 flex-1 flex flex-col">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-0">
            <button
              onClick={() => setTab('log')}
              className={`px-4 py-2 rounded-t-lg text-sm font-label font-semibold transition-colors ${tab === 'log' ? 'bg-surface-container text-on-surface' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}`}
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">list_alt</span>
              对局日志
            </button>
            <button
              onClick={() => setTab('chart')}
              className={`px-4 py-2 rounded-t-lg text-sm font-label font-semibold transition-colors ${tab === 'chart' ? 'bg-surface-container text-on-surface' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container/50'}`}
            >
              <span className="material-symbols-outlined text-sm align-middle mr-1">show_chart</span>
              分数图
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Clear history */}
            {!showClearConfirm ? (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-3 py-1.5 text-[10px] text-on-surface-variant hover:text-error hover:bg-error/10 rounded-lg transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-xs">delete</span>
                清空记录
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-on-surface-variant">确定清空所有记录？</span>
                <button onClick={handleClearAll} className="text-[10px] bg-error text-on-error px-2 py-1 rounded font-bold">确定</button>
                <button onClick={() => setShowClearConfirm(false)} className="text-[10px] bg-surface-container-high text-on-surface-variant px-2 py-1 rounded font-bold">取消</button>
              </div>
            )}
          </div>

          {tab === 'log' ? (
            <div className="flex-1 flex overflow-hidden">
              {/* Left panel: Session list or Hand list */}
              {!selectedSessionId ? (
                <SessionList
                  sessions={sessions}
                  selectedSessionId={selectedSessionId}
                  onSelect={(sid) => selectSession(sid)}
                />
              ) : (
                <div className="w-72 bg-surface-container border-r border-outline-variant/10 flex flex-col overflow-hidden">
                  {/* Back to sessions */}
                  <button
                    onClick={handleBackToSessions}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-primary hover:bg-surface-container-high transition-colors border-b border-outline-variant/10"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                    <span className="font-bold">返回场次列表</span>
                    <span className="text-[10px] text-on-surface-variant ml-auto">
                      Session #{selectedSessionId.slice(0, 8)}
                    </span>
                  </button>
                  <HandList
                    hands={mockHands}
                    selectedHandId={selectedHandId}
                    onSelect={handleSelectHand}
                  />
                </div>
              )}

              {/* Main area: Hand detail */}
              {selectedHistory && selectedSessionId ? (
                <HandDetail hand={selectedHistory} />
              ) : selectedSessionId && mockHands.length > 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">list_alt</span>
                    <p className="text-on-surface-variant text-sm">选择一手牌查看详细日志</p>
                  </div>
                </div>
              ) : !selectedSessionId ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">folder_open</span>
                    <p className="text-on-surface-variant text-sm">选择一个场次查看对局记录</p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">history</span>
                    <p className="text-on-surface-variant text-sm">该场次暂无记录</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <ChipChart
              histories={histories}
              sessions={sessions}
              selectedSessionId={chartSessionId}
              onSelectSession={(sid) => setChartSessionId(sid || null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
