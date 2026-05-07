'use client'

import { useEffect } from 'react'
import { FastForward, Pause, Play, Rewind, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useReplayStore } from '@/store/replay-store'

const SPEEDS = [0.5, 1, 2, 4] as const

export function ReplayControls() {
  const cursor = useReplayStore((s) => s.cursor)
  const total = useReplayStore((s) => s.events.length)
  const isPlaying = useReplayStore((s) => s.isPlaying)
  const speed = useReplayStore((s) => s.speed)
  const intervalMs = useReplayStore((s) => s.intervalMs)

  const play = useReplayStore((s) => s.play)
  const pause = useReplayStore((s) => s.pause)
  const stepForward = useReplayStore((s) => s.stepForward)
  const stepBackward = useReplayStore((s) => s.stepBackward)
  const seekTo = useReplayStore((s) => s.seekTo)
  const setSpeed = useReplayStore((s) => s.setSpeed)
  const tickOne = useReplayStore((s) => s.tickOne)

  useEffect(() => {
    if (!isPlaying) return
    const ms = Math.max(40, intervalMs / Math.max(0.1, speed))
    const handle = setInterval(() => tickOne(), ms)
    return () => clearInterval(handle)
  }, [isPlaying, speed, intervalMs, tickOne])

  const pct = total === 0 ? 0 : (cursor / total) * 100

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-950/90 p-3 backdrop-blur"
      data-testid="replay-controls"
    >
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <Button size="icon" variant="ghost" onClick={() => seekTo(0)} aria-label="回到开头">
          <Rewind size={16} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={stepBackward}
          aria-label="上一步"
          disabled={cursor <= 0}
        >
          <SkipBack size={16} />
        </Button>
        <Button
          size="icon"
          variant="default"
          onClick={() => (isPlaying ? pause() : play())}
          aria-label={isPlaying ? '暂停' : '播放'}
          disabled={total === 0}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={stepForward}
          aria-label="下一步"
          disabled={cursor >= total}
        >
          <SkipForward size={16} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => seekTo(total)}
          aria-label="跳到末尾"
        >
          <FastForward size={16} />
        </Button>

        <div className="flex-1">
          <div className="relative h-2 rounded bg-neutral-800">
            <div
              className="absolute inset-y-0 left-0 rounded bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
            <input
              type="range"
              min={0}
              max={total}
              value={cursor}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="回放进度"
            />
          </div>
          <div className="mt-1 text-center font-mono text-[10px] text-neutral-500">
            {cursor} / {total}
          </div>
        </div>

        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
          aria-label="播放速度"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
