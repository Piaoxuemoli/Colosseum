interface SpectatorControlsProps {
  handNumber: number
  totalHands: number
  sessionId?: string
}

export function SpectatorControls({ handNumber, totalHands, sessionId }: SpectatorControlsProps) {
  const shortSession = sessionId ? sessionId.slice(0, 8) : undefined

  return (
    <div className="flex items-center bg-surface-container-low px-4 py-1.5 rounded-full space-x-4 mr-4">
      <div className="flex items-center space-x-2 text-[11px] font-bold uppercase tracking-widest">
        {shortSession && (
          <>
            <span className="text-on-surface/40">Session #{shortSession}</span>
            <span className="w-1 h-1 bg-outline-variant rounded-full" />
          </>
        )}
        <span className="text-primary-fixed">Hand #{handNumber}</span>
        <span className="w-1 h-1 bg-outline-variant rounded-full" />
        <span className="text-on-surface/60">共 {totalHands} 手</span>
      </div>
      <div className="h-4 w-px bg-outline-variant/30" />
      <div className="flex items-center space-x-1.5">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-[10px] font-bold text-on-surface/50">LIVE</span>
      </div>
    </div>
  )
}
