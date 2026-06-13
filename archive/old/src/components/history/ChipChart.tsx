import { useState, useMemo, useCallback } from 'react'
import type { HandHistory } from '../../types/history'
import type { SessionSummary } from '../../types/ui'
import { useGameStore } from '../../store/game-store'

interface ChipChartProps {
  histories: HandHistory[]
  sessions: SessionSummary[]
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
}

// Distinct colors for up to 6 players — vibrant, high-contrast palette
const PLAYER_PALETTE = [
  '#7FCFFF',  // sky blue
  '#A1D494',  // mint green
  '#FFB74D',  // amber
  '#CE93D8',  // lavender
  '#FF8A80',  // coral red
  '#80CBC4',  // teal
]

const PLAYER_PALETTE_DIM = [
  'rgba(127,207,255,0.12)',
  'rgba(161,212,148,0.12)',
  'rgba(255,183,77,0.12)',
  'rgba(206,147,216,0.12)',
  'rgba(255,138,128,0.12)',
  'rgba(128,203,196,0.12)',
]

/**
 * Monotone cubic Hermite interpolation — smooth curves that pass through
 * every data point without overshoot (like loss curves / TensorBoard style).
 * Based on Fritsch–Carlson method.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M${points[0].x},${points[0].y}`
  if (points.length === 2) return `M${points[0].x},${points[0].y}L${points[1].x},${points[1].y}`

  const n = points.length

  // 1. Compute slopes of secant lines
  const deltas: number[] = []
  const h: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x
    h.push(dx)
    deltas.push(dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx)
  }

  // 2. Compute tangent slopes using Fritsch–Carlson monotone method
  const m: number[] = new Array(n)
  m[0] = deltas[0]
  m[n - 1] = deltas[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (deltas[i - 1] * deltas[i] <= 0) {
      m[i] = 0
    } else {
      m[i] = (deltas[i - 1] + deltas[i]) / 2
    }
  }

  // 3. Enforce monotonicity constraints
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(deltas[i]) < 1e-12) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const alpha = m[i] / deltas[i]
      const beta = m[i + 1] / deltas[i]
      const s = alpha * alpha + beta * beta
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * alpha * deltas[i]
        m[i + 1] = t * beta * deltas[i]
      }
    }
  }

  // 4. Build cubic bezier segments
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const dx = h[i] / 3
    const cp1x = points[i].x + dx
    const cp1y = points[i].y + m[i] * dx
    const cp2x = points[i + 1].x - dx
    const cp2y = points[i + 1].y - m[i + 1] * dx
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${points[i + 1].x},${points[i + 1].y}`
  }

  return d
}

/** Build a closed area path from a smooth line path */
function smoothAreaPath(points: { x: number; y: number }[], baseY: number): string {
  if (points.length < 2) return ''
  const linePart = smoothPath(points)
  return `${linePart} L${points[points.length - 1].x},${baseY} L${points[0].x},${baseY} Z`
}

/**
 * Build robust per-player chip series from hand histories.
 *
 * Fixes applied:
 * 1. Dedup: if multiple records share a handNumber for the same player,
 *    keep only the latest (by array position = timestamp order).
 * 2. Carry-forward: if a player is missing from a hand (sittingOut etc.),
 *    carry forward the last known value so the curve stays continuous.
 * 3. Initial point: always prepend a hand-0 point from the first hand's
 *    starting chips to anchor the curve origin.
 * 4. Monotone hand axis: sort and dedup hand numbers globally so every
 *    player's data is aligned to the same x-axis.
 * 5. Filter out sittingOut players who never played (0 chips throughout).
 */
function buildPlayerSeries(sorted: HandHistory[]) {
  if (sorted.length === 0) return { playerList: [], allHandNumbers: [] }

  // Collect unique hand numbers (sorted)
  const handNumberSet = new Set<number>()
  handNumberSet.add(0) // always include the initial state
  for (const h of sorted) handNumberSet.add(h.handNumber)
  const allHandNumbers = Array.from(handNumberSet).sort((a, b) => a - b)

  // Build per-player raw data: playerId → Map<handNumber, chips>
  // Using Map ensures dedup — later entries overwrite earlier for same handNumber
  const playerMeta = new Map<string, { name: string; type: string; colorIndex: number }>()
  const playerRaw = new Map<string, Map<number, number>>()
  // Also store the initial chips (hand-0) from each player's first appearance
  const playerInitialChips = new Map<string, number>()

  let colorIdx = 0
  for (const h of sorted) {
    for (const p of h.players) {
      if (!playerMeta.has(p.id)) {
        playerMeta.set(p.id, { name: p.name, type: p.type, colorIndex: colorIdx % PLAYER_PALETTE.length })
        playerRaw.set(p.id, new Map())
        colorIdx++
      }
      // Record initial chips from first appearance
      if (!playerInitialChips.has(p.id)) {
        playerInitialChips.set(p.id, p.chips)
      }
      // Always overwrite with latest value for this handNumber (dedup)
      playerRaw.get(p.id)!.set(h.handNumber, p.chipsAfter)
    }
  }

  // Build final series with carry-forward for missing hands
  const playerList: [string, { name: string; type: string; colorIndex: number; data: { hand: number; chips: number }[] }][] = []

  for (const [id, meta] of playerMeta) {
    const raw = playerRaw.get(id)!
    const initialChips = playerInitialChips.get(id) ?? 0
    const data: { hand: number; chips: number }[] = []
    let lastKnown = initialChips

    for (const hand of allHandNumbers) {
      if (hand === 0) {
        // Initial state
        data.push({ hand: 0, chips: initialChips })
        lastKnown = initialChips
      } else if (raw.has(hand)) {
        const chips = raw.get(hand)!
        data.push({ hand, chips })
        lastKnown = chips
      } else {
        // Player missing from this hand → carry forward
        data.push({ hand, chips: lastKnown })
      }
    }

    // Filter out players who were always at 0 (never played)
    const hasNonZero = data.some(d => d.chips > 0)
    if (hasNonZero) {
      playerList.push([id, { ...meta, data }])
    }
  }

  return { playerList, allHandNumbers }
}

/** Tooltip data for crosshair: all players' chips at a given hand number */
interface CrosshairData {
  handNumber: number
  handX: number
  /** All players' data at this hand, sorted by chips descending */
  players: { name: string; chips: number; color: string; y: number }[]
  /** The nearest player to the cursor (for highlight) */
  nearestPlayerId: string
  nearestY: number
}

export function ChipChart({ histories, sessions, selectedSessionId, onSelectSession }: ChipChartProps) {
  const [crosshair, setCrosshair] = useState<CrosshairData | null>(null)

  // Filter histories by selected session
  const sessionHistories = useMemo(() => {
    if (!selectedSessionId) return []
    return histories.filter(h => h.sessionId === selectedSessionId)
  }, [histories, selectedSessionId])

  const { sorted, playerList, allHandNumbers, minChips, maxChips } = useMemo(() => {
    const sorted = [...sessionHistories].sort((a, b) => a.handNumber - b.handNumber)

    const { playerList, allHandNumbers } = buildPlayerSeries(sorted)

    const allChips = playerList.flatMap(([, p]) => p.data.map(d => d.chips))
    const minChips = allChips.length > 0 ? Math.min(...allChips) : 0
    const maxChips = allChips.length > 0 ? Math.max(...allChips) : 1000

    return { sorted, playerList, allHandNumbers, minChips, maxChips }
  }, [sessionHistories])

  // SVG dimensions
  const W = 800
  const H = 400
  const PAD = { top: 20, right: 30, bottom: 40, left: 60 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const handMin = allHandNumbers[0] ?? 0
  const handMax = allHandNumbers[allHandNumbers.length - 1] ?? 1
  const handRange = handMax - handMin || 1
  const chipRange = maxChips - minChips || 1
  const chipPad = chipRange * 0.1
  // Clamp Y-axis minimum to 0 — chips can never go negative
  const yMin = Math.max(0, minChips - chipPad)
  const yMax = maxChips + chipPad
  const yRange = yMax - yMin || 1

  const toX = useCallback((hand: number) => PAD.left + ((hand - handMin) / handRange) * plotW, [handMin, handRange, plotW])
  const toY = useCallback((chips: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, chips))
    return PAD.top + plotH - ((clamped - yMin) / yRange) * plotH
  }, [yMin, yMax, yRange, plotH])

  /** Handle mouse move over the entire plot area — find nearest hand + nearest player */
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg || playerList.length === 0) return

    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse())

    // Find nearest hand number by x position
    let nearestHandIdx = 0
    let nearestHandDist = Infinity
    for (let i = 0; i < allHandNumbers.length; i++) {
      const hx = toX(allHandNumbers[i])
      const dist = Math.abs(svgPt.x - hx)
      if (dist < nearestHandDist) {
        nearestHandDist = dist
        nearestHandIdx = i
      }
    }

    const handNumber = allHandNumbers[nearestHandIdx]
    const handX = toX(handNumber)

    // Collect all players' chips at this hand, find nearest by Y
    let nearestPlayerId = ''
    let nearestDist = Infinity
    let nearestY = 0
    const players: CrosshairData['players'] = []

    for (const [id, { name, colorIndex, data }] of playerList) {
      const dataPoint = data[nearestHandIdx]
      if (!dataPoint) continue
      const color = PLAYER_PALETTE[colorIndex]
      const py = toY(dataPoint.chips)
      players.push({ name, chips: dataPoint.chips, color, y: py })

      const dist = Math.abs(svgPt.y - py)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestPlayerId = id
        nearestY = py
      }
    }

    // Sort tooltip by chips descending
    players.sort((a, b) => b.chips - a.chips)

    setCrosshair({ handNumber, handX, players, nearestPlayerId, nearestY })
  }, [playerList, allHandNumbers, toX, toY])

  // Session selector + empty state
  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex flex-col p-6 gap-4 overflow-auto">
        <div className="text-sm font-headline font-bold text-on-surface mb-2">选择场次查看{useGameStore.getState().plugin?.meta.scoreLabel || '筹码'}图</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {sessions.map(session => (
            <button
              key={session.sessionId}
              onClick={() => onSelectSession(session.sessionId)}
              className="text-left p-4 bg-surface-container rounded-xl border border-outline-variant/10 hover:bg-surface-container-high hover:border-primary/30 transition-all"
            >
              <div className="text-xs font-bold text-on-surface mb-1">Session #{session.sessionId.slice(0, 8)}</div>
              <div className="text-[10px] text-on-surface-variant">{new Date(session.startTime).toLocaleString('zh-CN')}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded font-bold">{session.handCount} 局</span>
                <span className="text-[10px] text-on-surface-variant truncate">{session.playerNames.join(', ')}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface-variant">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-4xl">show_chart</span>
          <p>该场次暂无对局记录</p>
        </div>
      </div>
    )
  }

  // Grid lines
  const yTicks = 5
  const yStep = yRange / yTicks
  const gridLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = yMin + i * yStep
    return { y: toY(val), label: `$${Math.round(val).toLocaleString()}` }
  })

  const xTicks = Math.min(allHandNumbers.length, 10)
  const xStep = Math.max(1, Math.floor(allHandNumbers.length / xTicks))
  const xLabels = allHandNumbers.filter((_, i) => i % xStep === 0 || i === allHandNumbers.length - 1)

  // Find session info for header
  const currentSession = sessions.find(s => s.sessionId === selectedSessionId)

  // Tooltip positioning
  const tooltipLineHeight = 16
  const tooltipPadV = 8
  const tooltipPadH = 12
  const tooltipW = 160
  const tooltipH = crosshair ? tooltipPadV * 2 + 18 + crosshair.players.length * tooltipLineHeight : 0

  // Position tooltip: prefer right of crosshair, flip left if overflow
  const tooltipX = crosshair
    ? (crosshair.handX + 16 + tooltipW > W - PAD.right
      ? crosshair.handX - 16 - tooltipW
      : crosshair.handX + 16)
    : 0
  // Vertically center around nearest point, clamp to plot area
  const tooltipY = crosshair
    ? Math.max(PAD.top, Math.min(PAD.top + plotH - tooltipH, crosshair.nearestY - tooltipH / 2))
    : 0

  return (
    <div className="flex-1 flex flex-col p-6 gap-4 overflow-auto">
      {/* Session header + back */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onSelectSession('')}
          className="flex items-center gap-1.5 text-sm text-primary hover:text-primary-container transition-colors"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          <span className="font-bold">返回场次</span>
        </button>
        <span className="text-xs text-on-surface-variant">
          Session #{selectedSessionId.slice(0, 8)}
          {currentSession && ` · ${currentSession.handCount} 局`}
        </span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 px-2">
        {playerList.map(([id, { name, colorIndex }]) => (
          <div key={id} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PLAYER_PALETTE[colorIndex] }} />
            <span className="text-xs font-label font-semibold text-on-surface-variant">{name}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid */}
          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={g.y} x2={W - PAD.right} y2={g.y} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
              <text x={PAD.left - 8} y={g.y + 4} textAnchor="end" fill="currentColor" fillOpacity={0.4} fontSize={10} fontFamily="inherit">{g.label}</text>
            </g>
          ))}

          {/* X axis labels */}
          {xLabels.map((hand, i) => (
            <text key={i} x={toX(hand)} y={H - 8} textAnchor="middle" fill="currentColor" fillOpacity={0.4} fontSize={10} fontFamily="inherit">
              #{hand}
            </text>
          ))}

          {/* Clip path to prevent curves rendering outside plot area */}
          <defs>
            <clipPath id="plot-clip">
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* Layer 1: Area fills (pointer-events: none — never block interaction) */}
          <g clipPath="url(#plot-clip)" style={{ pointerEvents: 'none' }}>
            {playerList.map(([id, { colorIndex, data }]) => {
              const dimColor = PLAYER_PALETTE_DIM[colorIndex]
              const points = data.map(d => ({ x: toX(d.hand), y: toY(d.chips) }))
              if (points.length < 2) return null
              const area = smoothAreaPath(points, toY(yMin))
              return <path key={id} d={area} fill={dimColor} />
            })}
          </g>

          {/* Layer 2: Line strokes (pointer-events: none) */}
          <g clipPath="url(#plot-clip)" style={{ pointerEvents: 'none' }}>
            {playerList.map(([id, { colorIndex, data }]) => {
              const color = PLAYER_PALETTE[colorIndex]
              const points = data.map(d => ({ x: toX(d.hand), y: toY(d.chips) }))
              if (points.length === 0) return null
              const line = smoothPath(points)
              return <path key={id} d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            })}
          </g>

          {/* Layer 3: Data point dots (pointer-events: none — interaction handled by overlay) */}
          <g clipPath="url(#plot-clip)" style={{ pointerEvents: 'none' }}>
            {playerList.map(([id, { colorIndex, data }]) => {
              const color = PLAYER_PALETTE[colorIndex]
              return data.map((d, i) => (
                <circle
                  key={`${id}-${i}`}
                  cx={toX(d.hand)} cy={toY(d.chips)} r={2.5}
                  fill={color}
                  stroke="var(--md-sys-color-surface, #1a1a1a)"
                  strokeWidth={1.5}
                />
              ))
            })}
          </g>

          {/* Crosshair + highlighted dots (drawn above everything) */}
          {crosshair && (
            <g style={{ pointerEvents: 'none' }}>
              {/* Vertical crosshair line */}
              <line
                x1={crosshair.handX} y1={PAD.top}
                x2={crosshair.handX} y2={PAD.top + plotH}
                stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="4 3"
              />
              {/* Highlighted dots at crosshair hand for all players */}
              {crosshair.players.map((p, i) => (
                <circle
                  key={i}
                  cx={crosshair.handX} cy={p.y} r={4}
                  fill={p.color}
                  stroke="var(--md-sys-color-surface, #1a1a1a)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}

          {/* Tooltip card */}
          {crosshair && (
            <g style={{ pointerEvents: 'none' }}>
              {/* Background */}
              <rect
                x={tooltipX} y={tooltipY}
                width={tooltipW} height={tooltipH}
                rx={8}
                fill="var(--md-sys-color-surface-container-high, #333)"
                stroke="var(--md-sys-color-outline-variant, #555)"
                strokeWidth={1}
                fillOpacity={0.95}
              />
              {/* Hand number header */}
              <text
                x={tooltipX + tooltipPadH} y={tooltipY + tooltipPadV + 10}
                fill="var(--md-sys-color-on-surface-variant, #aaa)"
                fontSize={10} fontFamily="inherit" fontWeight="bold"
              >
                第 {crosshair.handNumber} 手
              </text>
              {/* Player rows */}
              {crosshair.players.map((p, i) => {
                const rowY = tooltipY + tooltipPadV + 18 + i * tooltipLineHeight
                return (
                  <g key={i}>
                    <circle cx={tooltipX + tooltipPadH + 4} cy={rowY + 4} r={3} fill={p.color} />
                    <text
                      x={tooltipX + tooltipPadH + 12} y={rowY + 8}
                      fill="var(--md-sys-color-on-surface, #fff)"
                      fontSize={10} fontFamily="inherit"
                    >
                      {p.name}
                    </text>
                    <text
                      x={tooltipX + tooltipW - tooltipPadH} y={rowY + 8}
                      textAnchor="end"
                      fill={p.color}
                      fontSize={10} fontFamily="inherit" fontWeight="bold"
                    >
                      ${p.chips.toLocaleString()}
                    </text>
                  </g>
                )
              })}
            </g>
          )}

          {/* Layer 4: Transparent interaction overlay — captures all mouse events */}
          <rect
            x={PAD.left} y={PAD.top} width={plotW} height={plotH}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setCrosshair(null)}
          />
        </svg>
      </div>
    </div>
  )
}
