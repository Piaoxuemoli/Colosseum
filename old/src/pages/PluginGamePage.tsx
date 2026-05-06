/**
 * PluginGamePage — 通用游戏页壳。
 * 根据 activeGameType 路由到对应游戏的 GamePage。
 * 德扑走专属 GamePage，斗地主走 DdzGamePage，其他游戏待扩展。
 */

import { useAppStore } from '../store/app-store'
import { Navbar } from '../components/layout/Navbar'
import { DdzGamePage } from '../games/doudizhu/ui/DdzGamePage'

export function PluginGamePage() {
  const activeGameType = useAppStore((s) => s.activeGameType)

  // 每个游戏有自己的 GamePage
  switch (activeGameType) {
    case 'doudizhu':
      return <DdzGamePage />
    default:
      return (
        <div className="ml-20 min-h-screen bg-background flex flex-col">
          <Navbar />
          <div className="flex-1 flex items-center justify-center">
            <p className="text-on-surface-variant">游戏 "{activeGameType}" 尚未实现</p>
          </div>
        </div>
      )
  }
}
