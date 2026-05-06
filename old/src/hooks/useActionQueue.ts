import { useCallback, useRef, useEffect } from 'react'
import { useGameStore } from '../store/game-store'

/**
 * Hook that manages the async action queue for bot/LLM actions.
 * Watches for isBotActing state and processes actions via the store.
 *
 * The actual action processing logic is in game-store.processNextAction().
 * This hook primarily handles cleanup on unmount.
 */
export function useActionQueue() {
  const isProcessingRef = useRef(false)
  const isBotActing = useGameStore(s => s.isBotActing)

  const startProcessing = useCallback(() => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    // The store handles the actual processing loop
    useGameStore.getState().processNextAction().finally(() => {
      isProcessingRef.current = false
    })
  }, [])

  // Auto-start processing when isBotActing changes to true
  useEffect(() => {
    if (isBotActing && !isProcessingRef.current) {
      startProcessing()
    }
  }, [isBotActing, startProcessing])

  const cancelQueue = useCallback(() => {
    isProcessingRef.current = false
    useGameStore.getState().setThinkingBotId(null)
    useGameStore.getState().setThinkingContent(null)
    useGameStore.getState().clearLastBotAction()
  }, [])

  return { startProcessing, cancelQueue, isProcessingRef }
}
