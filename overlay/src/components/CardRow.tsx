import type { Card } from '../types'
import { displayStats, identityColor } from '../lib/cards'
import { GradeBadge } from './GradeBadge'
import { ManaCost } from './ManaCost'
import { usePreview } from './CardPreview'

interface Props {
  card: Card
  /** Advisor score relative to the best card in the pack, 0..1. */
  strength?: number
  highlight?: boolean
  dimmed?: boolean
}

export function CardRow({ card, strength = 0, highlight, dimmed }: Props) {
  const setPreview = usePreview()
  const { stats, grade, fallback } = displayStats(card)
  const rec = card.recommendation
  const wheel = rec && rec.wheelChance >= 25 ? Math.round(rec.wheelChance) : null
  const reasons = rec?.reasoning ?? []
  const stripe = identityColor(card)

  return (
    <div
      onMouseEnter={(e) => setPreview({ card, y: e.currentTarget.getBoundingClientRect().top + 16 })}
      onMouseLeave={() => setPreview(null)}
      className={`group relative overflow-hidden rounded-md transition-colors ${
        highlight ? 'bg-accent/10 ring-1 ring-accent/50' : 'hover:bg-white/5'
      } ${dimmed ? 'opacity-50' : ''}`}
    >
      {strength > 0 && (
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-white/[0.06] to-transparent"
          style={{ width: `${Math.max(4, strength * 100)}%` }}
        />
      )}
      <div className="relative flex items-center gap-2 py-1.5 pr-2 pl-0">
        <span className="h-7 w-[3px] shrink-0 rounded-r" style={{ background: stripe }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`truncate ${highlight ? 'font-semibold text-white' : 'text-stone-200'}`}>
              {card.name}
            </span>
            {card.count > 1 && <span className="text-[11px] text-stone-500">×{card.count}</span>}
            {rec?.isElite && (
              <span className="rounded bg-amber-400/15 px-1 text-[10px] font-semibold tracking-wide text-amber-300">
                BOMB
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <ManaCost cost={card.manaCost} />
            {highlight
              ? reasons.slice(0, 3).map((r) => (
                  <span key={r} className="rounded bg-white/5 px-1 text-[10px] text-stone-400">
                    {r}
                  </span>
                ))
              : reasons[0] && <span className="truncate text-[10px] text-stone-500">{reasons[0]}</span>}
          </div>
        </div>
        {wheel !== null && (
          <span
            className="tabular shrink-0 text-[10px] text-sky-300/80"
            title={`${wheel}% chance to wheel`}
          >
            ↻{wheel}%
          </span>
        )}
        <span
          className={`tabular w-10 shrink-0 text-right ${fallback ? 'text-stone-500' : 'text-stone-200'}`}
          title={fallback ? 'No data for this archetype; showing All Decks' : 'Games-in-hand win rate'}
        >
          {stats.gihwr ? stats.gihwr.toFixed(1) : '–'}
        </span>
        <span className="tabular w-8 shrink-0 text-right text-stone-500" title="Average last seen at">
          {stats.alsa ? stats.alsa.toFixed(1) : '–'}
        </span>
        <GradeBadge grade={grade} muted={fallback} />
      </div>
    </div>
  )
}
