import { useAppStore } from '../../store/app-store'
import { getGame } from '../../core/registry/game-registry'

const subPageLabels: Record<string, string> = {
  setup: '配置',
  game: '对局',
  history: '历史',
}

function usePageLabel(): string {
  const { currentPage, activeGameType } = useAppStore()
  if (currentPage === 'lobby') return '游戏大厅'
  // 从 plugin registry 获取游戏显示名
  let gameName = activeGameType
  try {
    const plugin = getGame(activeGameType)
    gameName = plugin.meta.displayName
  } catch { /* registry 未初始化 */ }
  const subLabel = subPageLabels[currentPage] || ''
  return `${gameName} · ${subLabel}`
}

interface NavbarProps {
  rightSlot?: React.ReactNode
}

export function Navbar({ rightSlot }: NavbarProps) {
  const label = usePageLabel()

  const handleSettings = () => {
    // TODO: Implement settings modal/page
    console.log('Settings clicked')
  }

  const handleAccount = () => {
    // TODO: Implement account modal/page
    console.log('Account clicked')
  }

  return (
    <header className="bg-background flex justify-between items-center w-full px-8 py-4 max-w-full sticky top-0 z-50">
      <div className="flex items-center gap-8">
        <span className="text-xl font-black tracking-tighter text-on-surface font-headline">
          LLM Game Arena
        </span>
        <span className="text-sm font-headline font-bold text-primary border-b-2 border-primary pb-1">
          {label}
        </span>
      </div>
      <div className="flex items-center gap-4">
        {rightSlot}
        <button 
          onClick={handleSettings}
          className="p-2 rounded-full hover:bg-surface-container-high transition-all duration-200 text-on-surface/60 hover:text-on-surface"
          title="Settings"
        >
          <span className="material-symbols-outlined">settings</span>
        </button>
        <button 
          onClick={handleAccount}
          className="p-2 rounded-full hover:bg-surface-container-high transition-all duration-200 text-on-surface/60 hover:text-on-surface"
          title="Account"
        >
          <span className="material-symbols-outlined">account_circle</span>
        </button>
      </div>
    </header>
  )
}
