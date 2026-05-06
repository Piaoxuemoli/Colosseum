/**
 * PluginSetupPage — 通用游戏配置页。
 *
 * 共享平台级配置（API / 座位 / 时序参数）+ 游戏特定参数（plugin.SetupComponent）。
 * 德扑走专属 SetupPage，其他游戏走这里。
 */

import { useEffect, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { useProfileStore } from '../store/profile-store'
import { useSessionStore } from '../store/session-store'
import { Navbar } from '../components/layout/Navbar'
import { ApiConfigCard, ApiConfigPlaceholder, ApiConfigModal } from '../components/setup/ApiConfigCard'
import { SeatConfigCard } from '../components/setup/SeatConfig'
import { TimingParamsSection } from '../components/setup/TimingParams'
import { getGame } from '../core/registry/game-registry'
import { useDdzGameStore } from '../games/doudizhu/store/ddz-game-store'
import type { APIProfile } from '../agent/llm-client'

export function PluginSetupPage() {
  const activeGameType = useAppStore((s) => s.activeGameType)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)

  const { profiles, loadProfiles, addProfile, updateProfile, removeProfile } = useProfileStore()
  const { config, updateSeat, updateParams, createSession, loadConfigForGame } = useSessionStore()
  const ddzIsRunning = useDdzGameStore(s => s.isRunning)

  const [showApiModal, setShowApiModal] = useState(false)
  const [editingProfile, setEditingProfile] = useState<APIProfile | null>(null)
  const [gameSpecificConfig, setGameSpecificConfig] = useState<Record<string, unknown>>({})
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // 获取 plugin
  let plugin: ReturnType<typeof getGame> | null = null
  try {
    plugin = getGame(activeGameType)
  } catch {
    // handled below
  }

  const meta = plugin?.meta
  const seatCount = meta?.maxPlayers ?? 3

  // 加载 config (per game type)
  useEffect(() => {
    loadProfiles()
    loadConfigForGame(activeGameType, seatCount)
  }, [loadProfiles, loadConfigForGame, activeGameType, seatCount])

  // ---- API 管理 ----
  function handleAddApi() {
    setEditingProfile(null)
    setShowApiModal(true)
  }
  function handleEditApi(profile: APIProfile) {
    setEditingProfile(profile)
    setShowApiModal(true)
  }
  async function handleSaveApi(profile: APIProfile) {
    if (editingProfile) {
      await updateProfile(profile)
    } else {
      await addProfile(profile)
    }
    setShowApiModal(false)
    setEditingProfile(null)
  }
  async function handleDeleteApi(id: string) {
    await removeProfile(id)
  }

  // ---- 开始游戏 ----
  function handleStartGame() {
    if (!plugin) return

    // 验证至少2个非空座位
    const nonEmpty = config.seats.filter(s => s.type !== 'empty')
    if (nonEmpty.length < meta!.minPlayers) {
      alert(`至少需要 ${meta!.minPlayers} 个非空座位才能开始游戏`)
      return
    }

    const sessionId = createSession()
    const getProfile = useProfileStore.getState().getProfile

    // 构建座位
    const seats = config.seats.filter(s => s.type !== 'empty').map(s => ({
      type: s.type,
      name: s.name,
      profileId: s.profileId,
      systemPrompt: (s.useCustomPrompt && s.systemPrompt)
        ? s.systemPrompt
        : config.defaultSystemPrompt || undefined,
    }))

    const timingConfig = {
      minActionInterval: config.minActionInterval,
      thinkingTimeout: config.thinkingTimeout,
    }

    // 每个游戏调自己的 store
    if (activeGameType === 'doudizhu') {
      const baseScore = (gameSpecificConfig.baseScore as number) || 1
      useDdzGameStore.getState().initGame(seats, timingConfig, { baseScore, sessionId }, getProfile)
    }
    // 其他游戏在此扩展

    setCurrentPage('game')
  }

  // ---- 错误状态 ----
  if (!plugin || !meta) {
    return (
      <div className="ml-20 min-h-screen bg-background flex items-center justify-center">
        <p className="text-on-surface-variant">未知游戏类型: {activeGameType}</p>
      </div>
    )
  }

  const SetupComponent = plugin.SetupComponent
  const hasGameSpecificSetup = SetupComponent && SetupComponent.name && SetupComponent.name !== 'PlaceholderComponent'

  return (
    <div className="ml-20 bg-background text-on-surface font-body min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow max-w-7xl mx-auto w-full px-8 py-8 space-y-12">
        {/* Section 1: API 配置 */}
        <section className="bg-surface-container-lowest/50 rounded-2xl p-6 space-y-6">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
                API 配置
              </h2>
              <p className="text-on-surface-variant text-sm mt-1">
                管理用于 LLM 对局者的 API 服务端点
              </p>
            </div>
            <button
              onClick={handleAddApi}
              className="bg-primary hover:bg-primary-container text-on-primary font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all duration-200 active:scale-95"
            >
              <span className="material-symbols-outlined text-lg">add</span>
              <span>添加 API</span>
            </button>
          </div>
          <div className="flex flex-wrap gap-4 pb-4">
            {profiles.map((profile) => (
              <ApiConfigCard
                key={profile.id}
                profile={profile}
                onEdit={() => handleEditApi(profile)}
                onDelete={() => handleDeleteApi(profile.id)}
              />
            ))}
            <ApiConfigPlaceholder onClick={handleAddApi} />
          </div>
        </section>

        {/* Section 2: 座位配置 */}
        <section className="bg-surface-container-lowest/50 rounded-2xl p-6 space-y-6">
          <div>
            <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
              座位配置
            </h2>
            <p className="text-on-surface-variant text-sm mt-1">
              设置 {meta.displayName} 的参与角色
            </p>
          </div>
          <div className={`grid gap-6 ${seatCount <= 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-3'}`}>
            {config.seats.map((seat) => (
              <SeatConfigCard
                key={seat.seatIndex}
                seat={seat}
                profiles={profiles}
                onUpdate={(updates) => updateSeat(seat.seatIndex, updates)}
              />
            ))}
          </div>
        </section>

        {/* Section 3: 游戏特定参数 (由 plugin 提供) */}
        {hasGameSpecificSetup && (
          <section className="bg-surface-container-lowest/50 rounded-2xl p-6 space-y-6">
            <div>
              <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
                {meta.displayName} 参数
              </h2>
              <p className="text-on-surface-variant text-sm mt-1">
                游戏特有规则设置
              </p>
            </div>
            <SetupComponent config={{ ...plugin.defaultConfig, ...gameSpecificConfig }} onChange={(cfg: Record<string, unknown>) => setGameSpecificConfig(prev => ({ ...prev, ...cfg }))} />
          </section>
        )}

        {/* Section 4: 平台参数 (动作间隔 / LLM超时 / 角色描述) */}
        <section className="bg-surface-container-lowest/50 rounded-2xl p-6 space-y-6">
          <div>
            <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
              平台参数
            </h2>
            <p className="text-on-surface-variant text-sm mt-1">
              LLM 运行参数与角色描述设置
            </p>
          </div>
          <TimingParamsSection
            config={config}
            onUpdate={updateParams}
          />
        </section>
      </main>

      {/* Bottom Action Bar */}
      <footer className="bg-surface-container-low border-t border-outline-variant/10 p-6 flex justify-center items-center sticky bottom-0 z-50 shadow-[0_-10px_30px_rgba(0,0,0,0.3)]">
        {ddzIsRunning ? (
          <div className="flex gap-4 w-full max-w-md">
            <button
              onClick={() => setCurrentPage('game')}
              className="flex-1 bg-secondary hover:bg-secondary-container text-on-secondary text-lg font-headline font-black py-4 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 transform active:scale-95 shadow-xl"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                play_circle
              </span>
              继续本场
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex-1 bg-primary hover:bg-primary-container text-on-primary text-lg font-headline font-black py-4 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 transform active:scale-95 shadow-xl shadow-primary/20"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                add_circle
              </span>
              开始新场
            </button>
          </div>
        ) : (
          <button
            onClick={handleStartGame}
            className="w-full max-w-md bg-primary hover:bg-primary-container text-on-primary text-xl font-headline font-black py-4 rounded-xl flex items-center justify-center gap-3 transition-all duration-300 transform active:scale-95 shadow-xl shadow-primary/20"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              play_arrow
            </span>
            开始游戏
          </button>
        )}
      </footer>

      {/* API Config Modal */}
      {showApiModal && (
        <ApiConfigModal
          profile={editingProfile}
          onSave={handleSaveApi}
          onClose={() => { setShowApiModal(false); setEditingProfile(null) }}
        />
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-low rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl space-y-6">
            <div className="text-center">
              <div className="text-4xl mb-2">⚠️</div>
              <h2 className="text-xl font-black font-headline text-on-surface">
                确认开始新场
              </h2>
              <p className="text-sm text-on-surface-variant mt-2">
                这将重置当前游戏并开始一个全新的对局。所有进度将丢失。
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 bg-surface-container text-on-surface-variant font-bold rounded-xl hover:bg-surface-container-high transition-all active:scale-95"
              >
                取消
              </button>
              <button
                onClick={() => { useDdzGameStore.getState().resetGame(); setShowResetConfirm(false); handleStartGame() }}
                className="flex-1 py-3 bg-error text-on-error font-bold rounded-xl hover:bg-error-container transition-all active:scale-95"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
