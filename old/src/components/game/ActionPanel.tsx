import type { ActionType } from '../../types/action'
import type { AvailableAction } from '../../games/poker/engine/poker-engine'

interface ActionPanelProps {
  heroCards: string
  amountToCall: number
  onAction?: (type: ActionType, amount?: number) => void
  availableActions?: AvailableAction[]
}

export function ActionPanel({ heroCards, amountToCall, onAction, availableActions }: ActionPanelProps) {
  const validTypes = new Set((availableActions || []).map(a => a.type))
  const raiseAction = availableActions?.find(a => a.type === 'raise')
  const betAction = availableActions?.find(a => a.type === 'bet')
  const canFold = validTypes.has('fold')
  const canCheck = validTypes.has('check')
  const canCall = validTypes.has('call')
  const canRaise = validTypes.has('raise')
  const canBet = validTypes.has('bet')

  // Fixed-Limit: bet/raise amounts are fixed
  const fixedBetAmount = betAction?.minAmount || 0
  const fixedRaiseAmount = raiseAction?.minAmount || 0

  return (
    <div className="fixed bottom-0 left-20 right-80 glass-panel h-24 flex items-center justify-between px-12 border-t border-outline-variant/10 z-30">
      <div className="flex items-center space-x-6">
        <div className="flex flex-col">
          <span className="text-[10px] font-label uppercase text-on-surface-variant tracking-widest">
            我的手牌
          </span>
          <span className="text-lg font-bold font-headline">{heroCards}</span>
        </div>
        <div className="h-10 w-[1px] bg-outline-variant/30" />
        <div className="flex flex-col">
          <span className="text-[10px] font-label uppercase text-on-surface-variant tracking-widest">
            当前需付
          </span>
          <span className="text-lg font-bold font-headline text-tertiary">
            ${amountToCall}
          </span>
        </div>
      </div>
      <div className="flex space-x-4 items-center">
        {canFold && (
          <button
            onClick={() => onAction?.('fold')}
            className="px-8 py-3 bg-error text-on-error font-bold rounded-md hover:brightness-110 transition-all active:scale-95"
          >
            弃牌 (Fold)
          </button>
        )}
        {canCheck && (
          <button
            onClick={() => onAction?.('check')}
            className="px-8 py-3 bg-surface-container-high text-on-surface font-bold rounded-md hover:brightness-110 transition-all active:scale-95"
          >
            过牌 (Check)
          </button>
        )}
        {canCall && (
          <button
            onClick={() => onAction?.('call', amountToCall)}
            className="px-8 py-3 bg-tertiary text-on-tertiary font-bold rounded-md hover:brightness-110 transition-all active:scale-95 shadow-[0_4px_12px_rgba(164,201,255,0.3)]"
          >
            跟注 ${amountToCall} (Call)
          </button>
        )}
        {canBet && (
          <button
            onClick={() => onAction?.('bet', fixedBetAmount)}
            className="px-10 py-3 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-md hover:brightness-110 transition-all active:scale-95 shadow-[0_4px_12px_rgba(45,90,39,0.4)] flex items-center space-x-2"
          >
            <span>下注 ${fixedBetAmount}</span>
            <span className="material-symbols-outlined text-sm">trending_up</span>
          </button>
        )}
        {canRaise && (
          <button
            onClick={() => onAction?.('raise', fixedRaiseAmount)}
            className="px-10 py-3 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-md hover:brightness-110 transition-all active:scale-95 shadow-[0_4px_12px_rgba(45,90,39,0.4)] flex items-center space-x-2"
          >
            <span>加注到 ${fixedRaiseAmount}</span>
            <span className="material-symbols-outlined text-sm">trending_up</span>
          </button>
        )}
      </div>
    </div>
  )
}
