'use client'

import { useEffect } from 'react'

const INITIAL_RECONNECT_MS = 1000
const MAX_RECONNECT_MS = 30000

export function useMatchStream(matchId: string, onMessage: (payload: unknown) => void) {
  useEffect(() => {
    if (!matchId) return

    let source: EventSource | null = null
    let reconnectDelay = INITIAL_RECONNECT_MS
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const connect = () => {
      if (cancelled) return
      source = new EventSource(`/api/matches/${matchId}/stream`)
      source.onopen = () => {
        reconnectDelay = INITIAL_RECONNECT_MS
      }
      source.onmessage = (event) => {
        try {
          onMessage(JSON.parse(event.data) as unknown)
        } catch {
          // Ignore malformed stream chunks; EventSource will keep the connection alive.
        }
      }
      source.onerror = () => {
        if (cancelled) return
        source?.close()
        source = null
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS)
        reconnectTimer = setTimeout(connect, reconnectDelay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      source?.close()
    }
  }, [matchId, onMessage])
}
