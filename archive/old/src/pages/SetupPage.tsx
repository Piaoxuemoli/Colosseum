import { useEffect, useState } from 'react'
import { useAppStore } from '../store/app-store'
import { useProfileStore } from '../store/profile-store'
import { useSessionStore } from '../store/session-store'
import { useGameStore } from '../store/game-store'
import { loadLatestSnapshot, deleteGameSnapshot } from '../db/snapshot-service'
import type { GameSnapshotRecord } from '../db/database'
import { Navbar } from '../components/layout/Navbar'
import { ApiConfigCard, ApiConfigPlaceholder, ApiConfigModal } from '../components/setup/ApiConfigCard'
import { SeatConfigCard } from '../components/setup/SeatConfig'
import { GameParamsSection } from '../components/setup/GameParams'
import type { APIProfile } from '../agent/llm-client'
import type { SeatSetup } from '../games/poker/engine/poker-engine'

export function SetupPage() {
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)
  const { profiles, loadProfiles, addProfile, updateProfile, removeProfile } = useProfileStore()
  const { config, updateSeat, updateParams, createSession, loadConfig } = useSessionStore()
  const { initGame, isRunning, resetGame, restoreGame } = useGameStore()

  const [showApiModal, setShowApiModal] = useState(false)
  const [editingProfile, setEditingProfile] = useState<APIProfile | null>(null)
  const [pendingSnapshot, setPendingSnapshot] = useState<GameSnapshotRecord | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  useEffect(() => {
    loadProfiles()
    loadConfig()
    // 检测未完成对局快照
    if (!isRunning) {
      loadLatestSnapshot().then(snapshot => {
        if (snapshot) setPendingSnapshot(snapshot)
      }).catch(console.error)
    }
  }, [loadProfiles, loadConfig, isRunning])

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

  function handleStartGame() {
    // Validate: at least 2 non-empty seats
    const nonEmpty = config.seats.filter(s => s.type !== 'empty')
    if (nonEmpty.length < 2) {
      alert('至少需要 2 个非空座位才能开始游戏')
      return
    }

    // Create session
    const sessionId = createSession()

    // Build game config
    const seats: SeatSetup[] = config.seats.map(s => ({
      type: s.type,
      name: s.name,
      chips: config.defaultChips,
      profileId: s.profileId,
      systemPrompt: (s.useCustomPrompt && s.systemPrompt)
        ? s.systemPrompt
        : config.defaultSystemPrompt || undefined,
    }))

    const getProfile = useProfileStore.getState().getProfile

    initGame({
      seats,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      sessionId,
      timingConfig: {
        minActionInterval: config.minActionInterval,
        thinkingTimeout: config.thinkingTimeout,
      },
    }, getProfile)

    setCurrentPage('game')
  }

  async function handleRestore() {
    if (!pendingSnapshot) return
    setIsRestoring(true)
    try {
      const getProfile = useProfileStore.getState().getProfile
      const ok = await restoreGame(getProfile)
      if (ok) {
        setPendingSnapshot(null)
        setCurrentPage('game')
      }
    } finally {
      setIsRestoring(false)
    }
  }

  async function handleDiscardSnapshot() {
    if (!pendingSnapshot) return
    await deleteGameSnapshot(pendingSnapshot.sessionId)
    setPendingSnapshot(null)
  }

  return (
    <div className="bg-background text-on-surface font-body min-h-screen flex flex-col">
      <Navbar />

      {/* 断线重连提示 */}
      {pendingSnapshot && !isRunning && (
        <div className="bg-tertiary-container text-on-tertiary-container px-6 py-4 flex items-center justify-between gap-4 shadow-md">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              restore
            </span>
            <div>
              <p className="font-headline font-bold">检测到未完成的对局</p>
              <p className="text-sm opacity-80">
                第 {pendingSnapshot.engineData.state.handNumber} 手 · {new Date(pendingSnapshot.timestamp).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleDiscardSnapshot}
              className="px-4 py-2 rounded-lg bg-surface-container text-on-surface hover:bg-surface-container-high transition-colors"
            >
              放弃
            </button>
            <button
              onClick={handleRestore}
              disabled={isRestoring}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary font-bold hover:bg-primary-container transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isRestoring ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                  恢复中…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                    play_circle
                  </span>
                  恢复对局
                </>
              )}
            </button>
          </div>
        </div>
      )}

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
              设置本局游戏的参与角色与初始筹码
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

        {/* Section 3: 游戏参数 */}
        <section className="bg-surface-container-lowest/50 rounded-2xl p-6 space-y-6">
          <div>
            <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">
              游戏参数
            </h2>
            <p className="text-on-surface-variant text-sm mt-1">
              微调竞技场的核心规则与运行逻辑
            </p>
          </div>
          <GameParamsSection
            config={config}
            onUpdate={updateParams}
          />
        </section>
      </main>

      {/* Bottom Action Bar */}
      <footer className="bg-surface-container-low border-t border-outline-variant/10 p-6 flex justify-center items-center sticky bottom-0 z-50 shadow-[0_-10px_30px_rgba(0,0,0,0.3)]">
        {isRunning ? (
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
              onClick={() => { resetGame(); handleStartGame() }}
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
    </div>
  )
}
