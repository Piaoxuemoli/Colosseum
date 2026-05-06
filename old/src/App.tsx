import { useAppStore } from './store/app-store'
import { SetupPage } from './pages/SetupPage'
import { GamePage } from './pages/GamePage'
import { HistoryPage } from './pages/HistoryPage'
import { LobbyPage } from './pages/LobbyPage'
import { PluginSetupPage } from './pages/PluginSetupPage'
import { PluginGamePage } from './pages/PluginGamePage'
import { PluginHistoryPage } from './pages/PluginHistoryPage'
import { Sidebar } from './components/layout/Sidebar'

export default function App() {
  const currentPage = useAppStore((s) => s.currentPage)
  const activeGameType = useAppStore((s) => s.activeGameType)

  // 德扑走专属页面（保留全部现有功能），其他游戏走通用 Plugin 壳
  const isPoker = activeGameType === 'poker'

  function renderPage() {
    switch (currentPage) {
      case 'lobby':
        return <LobbyPage />
      case 'setup':
        return isPoker ? <SetupPage /> : <PluginSetupPage />
      case 'game':
        return isPoker ? <GamePage /> : <PluginGamePage />
      case 'history':
        return isPoker ? <HistoryPage /> : <PluginHistoryPage />
      default:
        return <LobbyPage />
    }
  }

  return (
    <div className="relative bg-background min-h-screen">
      <Sidebar />
      {renderPage()}
    </div>
  )
}
