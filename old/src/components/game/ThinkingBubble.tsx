import { useState, useEffect, useRef, useMemo } from 'react'
import { useGameStore } from '../../store/game-store'

interface ThinkingBubbleProps {
  content: string
  variant?: 'player' | 'spectator'
  position?: 'left' | 'right'
}

// ── Markdown rendering ──

/** Enhanced markdown → HTML: **bold**, *italic*, `code`, - lists, newlines, keyword highlights */
function renderMarkdown(text: string, highlights?: Set<string>): string {
  let html = text
    // Escape HTML entities
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`(.+?)`/g, '<code class="bg-surface-container-highest/50 px-1 rounded text-primary text-[10px]">$1</code>')

  // Highlight dollar amounts: $123, $1,234
  html = html.replace(/\$[\d,]+/g, '<span class="text-amber-300 font-bold">$&</span>')

  // Highlight percentages: 45%, 67.8%
  html = html.replace(/\d+\.?\d*%/g, '<span class="text-sky-300 font-bold">$&</span>')

  // Highlight player names if provided
  if (highlights && highlights.size > 0) {
    for (const name of highlights) {
      if (name.length < 2) continue // skip very short names to avoid false positives
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      html = html.replace(
        new RegExp(`(?<![\\w>])${escaped}(?![\\w<])`, 'g'),
        `<span class="text-tertiary font-semibold">$&</span>`,
      )
    }
  }

  // Convert markdown-style lists: lines starting with "- " or "• "
  html = html.replace(/^[-•]\s+(.+)$/gm, '<span class="flex gap-1"><span class="text-primary/60 select-none">•</span><span>$1</span></span>')

  // Newlines → <br/>
  html = html.replace(/\n/g, '<br/>')

  return html
}

// ── Thinking timer hook ──

/** Countdown/elapsed hook for LLM thinking */
function useThinkingTimer(): { remainingSeconds: number; elapsedSeconds: number; progress: number; isUnlimited: boolean } | null {
  const thinkingStartTime = useGameStore(s => s.thinkingStartTime)
  const gameState = useGameStore(s => s.gameState)
  const timeoutMs = gameState?.timingConfig?.thinkingTimeout ?? 30000
  const isUnlimited = timeoutMs === 0
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!thinkingStartTime) return
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [thinkingStartTime])

  if (!thinkingStartTime) return null

  const elapsed = now - thinkingStartTime
  const elapsedSeconds = Math.floor(elapsed / 1000)

  if (isUnlimited) {
    return { remainingSeconds: -1, elapsedSeconds, progress: 1, isUnlimited: true }
  }

  const remaining = Math.max(0, timeoutMs - elapsed)
  const remainingSeconds = Math.ceil(remaining / 1000)
  const progress = Math.max(0, Math.min(1, remaining / timeoutMs))

  return { remainingSeconds, elapsedSeconds, progress, isUnlimited: false }
}

// ── Auto-scroll hook ──

function useAutoScroll(dep: string) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUp = useRef(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const handleScroll = () => {
      // If user scrolled up more than 30px from bottom, stop auto-scrolling
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      isUserScrolledUp.current = distFromBottom > 30
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || isUserScrolledUp.current) return
    el.scrollTop = el.scrollHeight
  }, [dep])

  return scrollRef
}

// ── Player name highlights ──

function usePlayerNames(): Set<string> {
  const gameState = useGameStore(s => s.gameState)
  return useMemo(() => {
    if (!gameState) return new Set<string>()
    return new Set(gameState.players.map(p => p.name))
  }, [gameState])
}

// ── Main component ──

export function ThinkingBubble({ content, variant = 'player' }: ThinkingBubbleProps) {
  const timer = useThinkingTimer()
  const playerNames = usePlayerNames()

  // Show streaming thinking indicator (when content is placeholder OR streaming content)
  const isThinkingPlaceholder = content === '思考中...'

  if (isThinkingPlaceholder && !content.includes('\n') && content.length < 20) {
    // Pure "思考中..." placeholder with timer
    const timerDisplay = timer
      ? timer.isUnlimited
        ? ` ${timer.elapsedSeconds}s`
        : timer.remainingSeconds <= 0
          ? ' 超时...'
          : ` ${timer.remainingSeconds}s`
      : ''

    return (
      <div className="thinking-bubble relative bg-surface-container-high px-4 py-2 rounded-full text-xs italic text-primary flex items-center space-x-2 z-50 min-w-[140px]">
        <span className="material-symbols-outlined text-xs animate-spin">sync</span>
        <span className="flex-1">思考中...{timerDisplay}</span>
        {timer && !timer.isUnlimited && timer.remainingSeconds > 0 && (
          <div className="w-12 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-100"
              style={{ width: `${timer.progress * 100}%` }}
            />
          </div>
        )}
        {timer && timer.isUnlimited && (
          <div className="w-12 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div className="h-full bg-primary/50 rounded-full animate-pulse w-full" />
          </div>
        )}
      </div>
    )
  }

  if (variant === 'spectator') {
    return <SpectatorThinking content={content} timer={timer} playerNames={playerNames} />
  }

  return <ExpandableThinking content={content} timer={timer} playerNames={playerNames} />
}

// ── Spectator variant ──

function SpectatorThinking({ content, timer, playerNames }: {
  content: string
  timer: ReturnType<typeof useThinkingTimer>
  playerNames: Set<string>
}) {
  const scrollRef = useAutoScroll(content)

  return (
    <div className="w-56 glass-panel p-3 rounded-xl border border-primary/20 z-50">
      <div className="flex items-center space-x-1 mb-1">
        <span className="w-1 h-1 bg-primary rounded-full" />
        <span className="w-1 h-1 bg-primary rounded-full" />
        <span className="w-1 h-1 bg-primary rounded-full" />
        <span className="text-[9px] font-bold uppercase ml-2 text-primary">
          Thinking
          {timer && (
            <span className="ml-1 text-on-surface-variant font-normal">
              {timer.isUnlimited ? `${timer.elapsedSeconds}s` : timer.remainingSeconds <= 0 ? '超时...' : `${timer.remainingSeconds}s`}
            </span>
          )}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="text-[10px] italic leading-tight text-on-surface/80 max-h-40 overflow-y-auto scroll-smooth"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content, playerNames) }}
      />
    </div>
  )
}

// ── Expandable player variant ──

function ExpandableThinking({ content, timer, playerNames }: {
  content: string
  timer: ReturnType<typeof useThinkingTimer>
  playerNames: Set<string>
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = content.length > 100
  const scrollRef = useAutoScroll(content)

  // Auto-expand when streaming (content is growing), collapse when not thinking
  const thinkingBotId = useGameStore(s => s.thinkingBotId)
  const isStreaming = !!thinkingBotId

  useEffect(() => {
    // When streaming starts, auto-expand so user sees full content
    if (isStreaming && isLong) {
      setExpanded(true)
    }
  }, [isStreaming, isLong])

  const displayContent = expanded ? content : content.slice(0, 150) + (isLong && !expanded ? '…' : '')

  return (
    <div
      className="thinking-bubble relative bg-surface-container-high p-3 rounded-2xl w-64 text-xs text-on-surface-variant border border-outline-variant shadow-xl cursor-pointer z-50"
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <span className="font-bold text-primary block mb-1 flex items-center gap-1">
        <span className="material-symbols-outlined text-xs">psychology</span>
        思考链 (CoT)
        {timer && (
          <span className="text-[10px] font-normal text-on-surface-variant ml-1">
            {timer.isUnlimited ? `${timer.elapsedSeconds}s` : timer.remainingSeconds <= 0 ? '超时...' : `${timer.remainingSeconds}s`}
          </span>
        )}
        {isStreaming && (
          <span className="ml-1 w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
        )}
        {isLong && (
          <span className="material-symbols-outlined text-[10px] ml-auto">
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        )}
      </span>
      <div
        ref={scrollRef}
        className={`leading-relaxed ${expanded ? 'max-h-60 overflow-y-auto scroll-smooth' : 'line-clamp-3'}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(displayContent, playerNames) }}
      />
    </div>
  )
}

// ---------- Top-level thinking overlay ----------

interface ThinkingOverlayProps {
  playerName: string
  content: string
  onClose: () => void
}

export function ThinkingOverlay({ playerName, content, onClose }: ThinkingOverlayProps) {
  const playerNames = usePlayerNames()
  const scrollRef = useAutoScroll(content)

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-24 pointer-events-none">
      <div className="bg-surface-container-low/95 backdrop-blur-xl border border-primary/30 rounded-2xl shadow-2xl p-6 max-w-2xl w-full mx-8 pointer-events-auto max-h-[60vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">psychology</span>
            <span className="font-headline font-bold text-sm">{playerName} 的思考</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-container-high rounded-lg transition-colors">
            <span className="material-symbols-outlined text-sm text-on-surface-variant">close</span>
          </button>
        </div>
        <div
          ref={scrollRef}
          className="overflow-y-auto text-sm leading-relaxed text-on-surface/90 scroll-smooth"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content, playerNames) }}
        />
      </div>
    </div>
  )
}
