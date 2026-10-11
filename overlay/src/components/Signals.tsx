import type { Color } from '../types'
import { COLORS, COLOR_VAR } from '../lib/cards'

export function Signals({ signals }: { signals: Record<Color, number> }) {
  const max = Math.max(10, ...COLORS.map((c) => signals[c] ?? 0))
  const leader = COLORS.reduce((a, b) => ((signals[b] ?? 0) > (signals[a] ?? 0) ? b : a))
  const hasSignal = (signals[leader] ?? 0) > 0

  return (
    <div className="flex items-end gap-1.5" title="Open-lane signals: strong cards seen later than usual">
      {COLORS.map((c) => {
        const v = signals[c] ?? 0
        const h = Math.max(2, (v / max) * 18)
        return (
          <div key={c} className="flex flex-col items-center gap-0.5">
            <div className="flex h-[18px] w-2 items-end overflow-hidden rounded-sm bg-white/5">
              <div
                className="w-full rounded-sm transition-all duration-500"
                style={{ height: h, background: COLOR_VAR[c], opacity: hasSignal && c === leader ? 1 : 0.55 }}
              />
            </div>
            <span className="text-[9px] leading-none text-stone-500">{c}</span>
          </div>
        )
      })}
    </div>
  )
}
