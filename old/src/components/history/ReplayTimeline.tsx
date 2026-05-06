import type { HandHistoryEntry } from '../../types/ui'

interface ReplayTimelineProps {
  hand: HandHistoryEntry
  currentStep: number
  onStepChange: (step: number) => void
}

/** Phase → color token */
function phaseColor(phase: string): string {
  switch (phase) {
    case 'preflop': return 'bg-on-surface-variant'
    case 'flop': return 'bg-primary'
    case 'turn': return 'bg-tertiary'
    case 'river': return 'bg-secondary'
    default: return 'bg-outline-variant'
  }
}

function phaseTextColor(phase: string): string {
  switch (phase) {
    case 'preflop': return 'text-on-surface-variant'
    case 'flop': return 'text-primary'
    case 'turn': return 'text-tertiary'
    case 'river': return 'text-secondary'
    default: return 'text-outline-variant'
  }
}

export function ReplayTimeline({ hand, currentStep, onStepChange }: ReplayTimelineProps) {
  const totalSteps = hand.steps.length
  const hasSteps = totalSteps > 0

  return (
    <div className="bg-surface-container-lowest border-t border-outline-variant/10 px-8 py-4">
      <div className="flex items-center gap-6">
        {/* Playback controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onStepChange(Math.max(0, currentStep - 1))}
            disabled={!hasSteps || currentStep === 0}
            className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm">skip_previous</span>
          </button>
          <button
            className="p-2 rounded-full bg-primary text-on-primary hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!hasSteps}
          >
            <span
              className="material-symbols-outlined text-sm"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              play_arrow
            </span>
          </button>
          <button
            onClick={() => onStepChange(Math.min(totalSteps - 1, currentStep + 1))}
            disabled={!hasSteps || currentStep >= totalSteps - 1}
            className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm">skip_next</span>
          </button>
        </div>

        {/* Step counter */}
        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant min-w-[80px]">
          {hasSteps ? `${currentStep + 1} / ${totalSteps}` : 'No steps'}
        </span>

        {/* Timeline bar */}
        <div className="flex-1 flex items-center gap-1">
          {hasSteps ? (
            hand.steps.map((step, i) => (
              <button
                key={i}
                onClick={() => onStepChange(i)}
                className="group flex flex-col items-center flex-1 min-w-0"
                title={step.action}
              >
                {/* Node */}
                <div
                  className={`w-3 h-3 rounded-full border-2 transition-all ${
                    i === currentStep
                      ? `${phaseColor(step.phase)} border-transparent scale-125 shadow-lg`
                      : i < currentStep
                        ? `${phaseColor(step.phase)} border-transparent opacity-60`
                        : 'bg-transparent border-outline-variant/40'
                  } group-hover:scale-125`}
                />
                {/* Connector line */}
                {i < totalSteps - 1 && (
                  <div
                    className={`h-0.5 w-full mt-[-7px] mb-1 ${
                      i < currentStep ? 'bg-primary/40' : 'bg-outline-variant/20'
                    }`}
                    style={{ marginLeft: '50%' }}
                  />
                )}
                {/* Label */}
                <span
                  className={`text-[8px] font-bold uppercase tracking-wider mt-1 truncate max-w-full ${
                    i === currentStep ? phaseTextColor(step.phase) : 'text-on-surface-variant/40'
                  }`}
                >
                  {step.phase}
                </span>
              </button>
            ))
          ) : (
            <div className="flex-1 h-0.5 bg-outline-variant/20 rounded" />
          )}
        </div>

        {/* Current action description */}
        {hasSteps && hand.steps[currentStep] && (
          <div className="max-w-[280px] text-right">
            <p className="text-xs text-on-surface-variant truncate">
              {hand.steps[currentStep].action}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
