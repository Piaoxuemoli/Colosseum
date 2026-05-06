/**
 * PluginHistoryPage — 通用游戏历史回顾页壳。
 * 从 plugin registry 加载 plugin.HistoryDetailComponent 渲染回放详情。
 * 德扑走专属的 HistoryPage，其他游戏走这里。
 */

import { useAppStore } from '../store/app-store'
import { Navbar } from '../components/layout/Navbar'
import { getGame } from '../core/registry/game-registry'

export function PluginHistoryPage() {
  const activeGameType = useAppStore((s) => s.activeGameType)

  let plugin
  try {
    plugin = getGame(activeGameType)
  } catch {
    return (
      <div className="ml-20 min-h-screen bg-background flex items-center justify-center">
        <p className="text-on-surface-variant">未知游戏类型: {activeGameType}</p>
      </div>
    )
  }

  const HistoryComponent = plugin.HistoryDetailComponent
  const meta = plugin.meta

  return (
    <div className="ml-20 min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-6xl mx-auto w-full px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold font-headline text-on-surface">
            {meta.displayName} · 对局历史
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">
            回顾过去的 {meta.roundLabel}
          </p>
        </div>

        <div className="bg-surface-container-lowest/50 rounded-2xl p-6">
          <HistoryComponent data={null} />
        </div>
      </main>
    </div>
  )
}
