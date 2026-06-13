import { useAppStore } from '../../store/app-store'

interface GameFooterProps {
  handNumber: number
  totalHands: number
  mode: string
  sessionId?: string
}

export function GameFooter({ handNumber, totalHands, mode, sessionId }: GameFooterProps) {
  const setGameMode = useAppStore((s) => s.setGameMode)

  // Show short session ID
  const shortSession = sessionId ? sessionId.slice(0, 8) : undefined

  return (
    <footer className="h-12 bg-surface-container-lowest border-t border-outline-variant/10 px-8 flex items-center justify-between z-50">
      <div className="flex items-center space-x-8 text-[11px] font-bold uppercase tracking-widest text-on-surface/60">
        <div className="flex items-center space-x-2">
          {shortSession && (
            <>
              <span className="text-on-surface/40">Session #{shortSession}</span>
              <span className="w-1 h-1 bg-outline-variant rounded-full" />
            </>
          )}
          <span className="text-primary-fixed">Hand #{handNumber}</span>
          <span className="w-1 h-1 bg-outline-variant rounded-full" />
          <span>{mode}</span>
        </div>
        <div className="flex items-center space-x-2">
          <span>Total Hands:</span>
          <span className="text-on-surface font-mono">{totalHands}</span>
        </div>
      </div>
      <button
        onClick={() => setGameMode('player')}
        className="bg-surface-container-high px-4 py-1 rounded text-[10px] font-bold hover:bg-surface-bright transition-colors"
      >
        EXIT SPECTATOR
      </button>
    </footer>
  )
}
