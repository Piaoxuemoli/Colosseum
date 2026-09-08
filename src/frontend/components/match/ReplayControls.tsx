'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronsLeft, ChevronsRight, FastForward, Pause, Play, Rewind, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/frontend/components/ui/button'
import { useReplayStore } from '@/frontend/store/replay-store'
import {
  activeBoundaryIndex,
  computeReplayBoundaries,
  nextBoundary,
  prevBoundary,
} from '@/frontend/store/projections/replay-boundaries'

const SPEEDS = [0.5, 1, 2, 4] as const

export function ReplayControls() {
  const cursor = useReplayStore((s) => s.cursor)
  const total = useReplayStore((s) => s.events.length)
  const events = useReplayStore((s) => s.events)
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

  // FR-4.6-02 阶段跳转：扑克按手、狼人杀按昼夜。纯推导，无新请求。
  const boundaries = useMemo(() => computeReplayBoundaries(events), [events])
  const boundaryKindLabel = boundaries[0]?.kind === 'hand' ? '手' : '阶段'
  const activeBoundary = useMemo(() => activeBoundaryIndex(boundaries, cursor), [boundaries, cursor])
  const next = useMemo(() => nextBoundary(boundaries, cursor), [boundaries, cursor])
  const prev = useMemo(() => prevBoundary(boundaries, cursor), [boundaries, cursor])

  // While the user is dragging, `dragging` holds the scrubbing position so we
  // DO NOT replay the event log on every onChange (which is O(target) work per
  // mousemove frame). Commit the seek on pointer/mouse/touch release.
  const [dragging, setDragging] = useState<number | null>(null)
  const sliderValue = dragging ?? cursor

  useEffect(() => {
    if (!isPlaying) return
    const ms = Math.max(40, intervalMs / Math.max(0.1, speed))
    const handle = setInterval(() => tickOne(), ms)
    return () => clearInterval(handle)
  }, [isPlaying, speed, intervalMs, tickOne])

  const pct = total === 0 ? 0 : (sliderValue / total) * 100

  const commitDrag = (raw: number) => {
    seekTo(raw)
    setDragging(null)
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-800 bg-neutral-950/90 p-3 backdrop-blur"
      data-testid="replay-controls"
    >
      {boundaries.length > 0 && (
        <div
          className="mx-auto mb-2 flex max-w-4xl items-center justify-center gap-2"
          data-testid="replay-boundary-jump"
        >
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => prev && seekTo(prev.seekIndex)}
            disabled={!prev}
            aria-label={`上一${boundaryKindLabel}`}
          >
            <ChevronsLeft size={14} />
            上一{boundaryKindLabel}
          </Button>
          <select
            value={activeBoundary}
            onChange={(e) => {
              const index = Number(e.target.value)
              const boundary = boundaries[index]
              if (boundary) seekTo(boundary.seekIndex)
            }}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-200"
            aria-label={`跳转到${boundaryKindLabel}`}
            data-testid="replay-boundary-select"
          >
            {activeBoundary < 0 && (
              <option value={-1} disabled>
                开局前
              </option>
            )}
            {boundaries.map((boundary, index) => (
              <option key={`${boundary.kind}-${boundary.value}-${boundary.seekIndex}`} value={index}>
                {boundary.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => next && seekTo(next.seekIndex)}
            disabled={!next}
            aria-label={`下一${boundaryKindLabel}`}
          >
            下一{boundaryKindLabel}
            <ChevronsRight size={14} />
          </Button>
        </div>
      )}
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
              value={sliderValue}
              onChange={(e) => setDragging(Number(e.target.value))}
              onPointerUp={(e) => commitDrag(Number(e.currentTarget.value))}
              onMouseUp={(e) => commitDrag(Number(e.currentTarget.value))}
              onTouchEnd={(e) => commitDrag(Number(e.currentTarget.value))}
              onKeyUp={(e) => commitDrag(Number(e.currentTarget.value))}
              onBlur={(e) => commitDrag(Number(e.currentTarget.value))}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label="回放进度"
            />
          </div>
          <div className="mt-1 text-center font-mono text-[10px] text-neutral-500">
            {sliderValue} / {total}
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
