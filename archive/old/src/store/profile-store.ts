import { create } from 'zustand'
import type { APIProfile } from '../agent/llm-client'
import { testConnection } from '../agent/llm-client'
import { getAllProfiles, saveProfile, deleteProfile as dbDeleteProfile } from '../db/profile-service'

/** 预置 API 配置，IndexedDB 为空时自动写入 */
const SEED_PROFILES: APIProfile[] = [
  {
    id: 'seed-doubao',
    name: 'Doubao-Seed-2.0-pro',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'e8c26bb1-e4a8-4e7e-afed-f54cf9f0b53a',
    model: 'doubao-seed-2-0-pro-260215',
  },
  {
    id: 'seed-kimi',
    name: 'Kimi-K2.5',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKey: 'sk-p0Cag8L4Ih7GsYurXnsCsMwBwEH8pCABXp1QQlYa3y6kOJbJ',
    model: 'kimi-k2.5',
  },
  {
    id: 'seed-deepseek',
    name: 'DeepSeek-V3.2-Thinking',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: 'sk-4c8d2d5a8caa4102a69f992dd47c8410',
    model: 'deepseek-reasoner',
  },
  {
    id: 'seed-glm',
    name: 'GLM-5',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: 'ecc68ec129924cdb8e8ae51b02ca1649.y28GtMBln9SmoiYM',
    model: 'glm-5',
  },
  {
    id: 'seed-qwen',
    name: 'Qwen3.6-plus',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-b49bdad6c27148a9b7646a4c978049f0',
    model: 'qwen3.6-plus',
  },
  {
    id: 'seed-minimax',
    name: 'MiniMax-M2.7',
    baseURL: 'https://api.minimaxi.com/v1',
    apiKey: 'sk-cp-mN-hcUhNqWLlk6mzG3IXFF9XazebxC0kVtCiNxIbsUZMSi4OZ3U5dUVvW-GCs-XRZ9ZblNpkcI7Twy_bPPN83O-nkJe43F6tZtpp0_7guMRU8XixrdR7VNU',
    model: 'MiniMax-M2.7',
  },
]

interface ProfileStore {
  profiles: APIProfile[]
  isLoading: boolean

  loadProfiles: () => Promise<void>
  addProfile: (profile: APIProfile) => Promise<void>
  updateProfile: (profile: APIProfile) => Promise<void>
  removeProfile: (id: string) => Promise<void>
  getProfile: (id: string) => APIProfile | undefined
  testConnection: (profile: APIProfile) => Promise<{ ok: boolean; error?: string }>
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profiles: [],
  isLoading: false,

  loadProfiles: async () => {
    set({ isLoading: true })
    try {
      let profiles = await getAllProfiles()
      // Seed default profiles on first launch (empty DB)
      if (profiles.length === 0) {
        for (const seed of SEED_PROFILES) {
          await saveProfile(seed)
        }
        profiles = await getAllProfiles()
      }
      set({ profiles })
    } catch (err) {
      console.error('Failed to load profiles:', err)
    } finally {
      set({ isLoading: false })
    }
  },

  addProfile: async (profile: APIProfile) => {
    await saveProfile(profile)
    set(state => ({ profiles: [...state.profiles, profile] }))
  },

  updateProfile: async (profile: APIProfile) => {
    await saveProfile(profile)
    set(state => ({
      profiles: state.profiles.map(p => p.id === profile.id ? profile : p),
    }))
  },

  removeProfile: async (id: string) => {
    await dbDeleteProfile(id)
    set(state => ({
      profiles: state.profiles.filter(p => p.id !== id),
    }))
  },

  getProfile: (id: string) => {
    return get().profiles.find(p => p.id === id)
  },

  testConnection: async (profile: APIProfile) => {
    return testConnection(profile)
  },
}))
