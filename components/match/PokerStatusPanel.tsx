'use client'

import { Badge } from '@/components/ui/badge'
import { useMatchViewStore, type CardVisual } from '@/store/match-view-store'

const SUIT_SYMBOL: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

const STREET_LABEL: Record<string, string> = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
}

function formatCards(cards: CardVisual[]): string {
  return cards.length > 0
    ? cards.map((card) => `${card.rank}${SUIT_SYMBOL[card.suit] ?? '?'}`).join(' ')
    : '暂无'
}

export function PokerStatusPanel() {
  const handNumber = useMatchViewStore((state) => state.handNumber)
  const phase = useMatchViewStore((state) => state.phase)
  const players = useMatchViewStore((state) => state.players)
  const currentActor = useMatchViewStore((state) => state.currentActor)
  const dealerIndex = useMatchViewStore((state) => state.dealerIndex)
  const smallBlindIndex = useMatchViewStore((state) => state.smallBlindIndex)
  const bigBlindIndex = useMatchViewStore((state) => state.bigBlindIndex)
  const communityCards = useMatchViewStore((state) => state.communityCards)
  const pot = useMatchViewStore((state) => state.pot)
  const streetPots = useMatchViewStore((state) => state.streetPots)
  const sidePots = useMatchViewStore((state) => state.sidePots)
  const stopRequested = useMatchViewStore((state) => state.stopRequested)

  const nameAtSeat = (seatIndex: number) =>
    players.find((player) => player.seatIndex === seatIndex)?.displayName ?? `Seat ${seatIndex + 1}`
  const actorName = currentActor
    ? players.find((player) => player.agentId === currentActor)?.displayName ?? currentActor
    : '等待结算'

  const flop = communityCards.slice(0, 3)
  const turn = communityCards.slice(3, 4)
  const river = communityCards.slice(4, 5)

  return (
    <section className="rounded-2xl border border-border bg-slate-950/45 p-3 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Poker State</div>
          <div className="mt-1 font-semibold text-white">第 {handNumber} 手</div>
        </div>
        <Badge variant="outline">{phase}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-slate-900/55 p-2">
          <div className="text-muted-foreground">当前行动</div>
          <div className="mt-1 font-semibold text-cyan-100">{actorName}</div>
        </div>
        <div className="rounded-xl bg-slate-900/55 p-2">
          <div className="text-muted-foreground">总底池</div>
          <div className="mt-1 font-semibold text-amber-100">总底池 ${pot}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">D {nameAtSeat(dealerIndex)}</Badge>
        <Badge variant="secondary">SB {nameAtSeat(smallBlindIndex)}</Badge>
        <Badge variant="secondary">BB {nameAtSeat(bigBlindIndex)}</Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {Object.entries(streetPots).map(([street, amount]) => (
          <div key={street} className="rounded-xl bg-slate-900/55 px-2 py-1.5 text-slate-200">
            {STREET_LABEL[street] ?? street} ${amount}
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1 text-xs text-slate-200">
        <div>Flop: {formatCards(flop)}</div>
        <div>Turn: {formatCards(turn)}</div>
        <div>River: {formatCards(river)}</div>
        <div aria-label="board-cards">{formatCards(communityCards)}</div>
      </div>

      {sidePots.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {sidePots.map((sidePot, index) => (
            <Badge key={`${sidePot.amount}-${index}`} variant="outline">
              {index === 0 ? '边池' : `边池 ${index + 1}`} ${sidePot.amount}
            </Badge>
          ))}
        </div>
      ) : null}

      {stopRequested ? (
        <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">
          本手后结束已请求
        </div>
      ) : null}
    </section>
  )
}
