'use client'

import { create } from 'zustand'

/**
 * Minimal toast store. Zero external deps; mounts once via `<Toaster />` in
 * the root layout and is callable from any client code via `toast.error(...)`.
 *
 * Keep the surface intentionally tiny — just `push` (returns an id) and
 * `dismiss(id)` — so we're not reimplementing sonner/shadcn-toast.
 */
export type ToastKind = 'error' | 'info' | 'success'
export type Toast = {
  id: number
  kind: ToastKind
  title: string
  description?: string
  createdAt: number
}

type ToastState = {
  items: Toast[]
  push(input: Omit<Toast, 'id' | 'createdAt'>): number
  dismiss(id: number): void
}

const DEFAULT_TTL_MS = 5000
let _seq = 1

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],

  push(input) {
    const id = _seq++
    const toast: Toast = { ...input, id, createdAt: Date.now() }
    set((s) => ({ items: [...s.items, toast] }))
    // Auto-dismiss — rely on a timeout rather than subscribing to RAF so
    // tests with fake timers can advance deterministically.
    setTimeout(() => {
      get().dismiss(id)
    }, DEFAULT_TTL_MS)
    return id
  },

  dismiss(id) {
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
  },
}))

export const toast = {
  error(title: string, description?: string): number {
    return useToastStore.getState().push({ kind: 'error', title, description })
  },
  info(title: string, description?: string): number {
    return useToastStore.getState().push({ kind: 'info', title, description })
  },
  success(title: string, description?: string): number {
    return useToastStore.getState().push({ kind: 'success', title, description })
  },
}
