import { useAppStore } from '../../store/app-store'
import { useGameStore } from '../../store/game-store'
import { useDdzGameStore } from '../../games/doudizhu/store/ddz-game-store'

/** 游戏内导航项 */
const gameNavItems: { icon: string; label: string; subPage: 'setup' | 'game' | 'history' }[] = [
  { icon: 'tune', label: 'Setup', subPage: 'setup' },
  { icon: 'leaderboard', label: 'Game', subPage: 'game' },
  { icon: 'analytics', label: 'Stats', subPage: 'history' },
]

export function Sidebar() {
  const { currentPage, setCurrentPage, activeGameType, navigateToGame } = useAppStore()
  const pokerIsRunning = useGameStore((s) => s.isRunning)
  const ddzIsRunning = useDdzGameStore((s) => s.isRunning)

  // FIX 4.1: Check both game stores, not just poker
  const isRunning = activeGameType === 'doudizhu' ? ddzIsRunning : pokerIsRunning

  const isLobby = currentPage === 'lobby'
  const currentSubPage = currentPage !== 'lobby' ? currentPage : null

  const handleGameNav = (subPage: 'setup' | 'game' | 'history') => {
    // 对局进行中，禁止进配置页
    if (isRunning && subPage === 'setup') return
    navigateToGame(activeGameType, subPage)
  }

  const handleBackToLobby = () => {
    if (isRunning) return // 对局进行中不允许回大厅
    setCurrentPage('lobby')
  }

  const handleHelp = () => {
    // TODO: Implement help modal/page
    console.log('Help clicked')
  }

  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-64px)] w-20 flex flex-col items-center py-6 space-y-4 bg-surface-container-lowest border-r border-on-surface/10 shadow-[4px_0px_24px_rgba(0,0,0,0.5)] z-40">
      {/* 大厅按钮 (始终显示) */}
      <div className="relative group">
        <button
          onClick={handleBackToLobby}
          disabled={isRunning}
          className={`flex flex-col items-center space-y-1 transition-all p-2 ${
            isRunning
              ? 'text-on-surface/35 cursor-not-allowed'
              : isLobby
                ? 'text-primary bg-surface-container-high rounded-lg cursor-pointer'
                : 'text-on-surface/40 hover:text-on-surface cursor-pointer'
          }`}
        >
          <span className="material-symbols-outlined">grid_view</span>
          <span className="font-headline text-[10px] uppercase tracking-widest">
            Lobby
          </span>
        </button>
        {isRunning && (
          <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-surface-container-highest text-on-surface text-xs py-1 px-2 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
            对局进行中，请先结束
          </div>
        )}
      </div>

      {/* 分隔线 */}
      {!isLobby && (
        <div className="w-8 border-t border-on-surface/10" />
      )}

      {/* 游戏内导航 (非大厅时显示) */}
      {!isLobby && gameNavItems.map((item) => {
        const isActive = currentSubPage === item.subPage
        const isDisabled = isRunning && item.subPage === 'setup'
        return (
          <div key={item.subPage} className="relative group">
            <button
              onClick={() => handleGameNav(item.subPage)}
              disabled={isDisabled}
              className={`flex flex-col items-center space-y-1 transition-all p-2 ${
                isDisabled
                  ? 'text-on-surface/35 cursor-not-allowed'
                  : isActive
                    ? 'text-primary bg-surface-container-high rounded-lg cursor-pointer'
                    : 'text-on-surface/40 hover:text-on-surface cursor-pointer'
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="font-headline text-[10px] uppercase tracking-widest">
                {item.label}
              </span>
            </button>
            {isDisabled && (
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-surface-container-highest text-on-surface text-xs py-1 px-2 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                对局进行中，请先结束
              </div>
            )}
          </div>
        )
      })}

      {/* 底部 Help */}
      <div className="relative group mt-auto">
        <button
          onClick={handleHelp}
          className="flex flex-col items-center space-y-1 text-on-surface/40 hover:text-on-surface cursor-pointer transition-all p-2 pb-4 hover:bg-surface-container-high rounded-lg"
          title="Help"
        >
          <span className="material-symbols-outlined">help_outline</span>
          <span className="font-headline text-[10px] uppercase tracking-widest">Help</span>
        </button>
      </div>
    </aside>
  )
}
