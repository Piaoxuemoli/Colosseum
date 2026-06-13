import { create } from 'zustand'

/** 游戏类型标识，由 plugin registry 动态注册 */
export type GameType = string

/** 简化的页面路由：lobby + 3 个游戏子页面（由 activeGameType + plugin 动态渲染） */
export type PageId = 'lobby' | 'setup' | 'game' | 'history'

export type GameMode = 'player' | 'spectator'

interface AppState {
  currentPage: PageId
  activeGameType: GameType
  gameMode: GameMode
  setCurrentPage: (page: PageId) => void
  navigateToGame: (gameType: GameType, subPage: 'setup' | 'game' | 'history') => void
  toggleGameMode: () => void
  setGameMode: (mode: GameMode) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'lobby',
  activeGameType: 'poker',
  gameMode: 'player',
  setCurrentPage: (page) => set({ currentPage: page }),
  navigateToGame: (gameType, subPage) =>
    set({ currentPage: subPage, activeGameType: gameType }),
  toggleGameMode: () =>
    set((state) => ({
      gameMode: state.gameMode === 'player' ? 'spectator' : 'player',
    })),
  setGameMode: (mode) => set({ gameMode: mode }),
}))
