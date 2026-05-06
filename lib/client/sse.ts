'use client'

import { useEffect } from 'react'

export function useMatchStream(matchId: string, onMessage: (payload: unknown) => void) {
  useEffect(() => {
    if (!matchId) return

    const source = new EventSource(`/api/matches/${matchId}/stream`)
    source.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as unknown)
      } catch {
        // Ignore malformed stream chunks; EventSource will keep the connection alive.
      }
    }
    source.onerror = () => {
      // Native EventSource reconnects automatically.
    }

    return () => source.close()
  }, [matchId, onMessage])
}
