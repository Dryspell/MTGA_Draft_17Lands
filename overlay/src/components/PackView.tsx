import { useMemo, useState, type ReactNode } from 'react'
import type { Card } from '../types'
import { displayStats } from '../lib/cards'
import { CardRow } from './CardRow'

type SortKey = 'advisor' | 'gihwr' | 'alsa'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'advisor', label: 'Advisor' },
  { key: 'gihwr', label: 'GIH WR' },
  { key: 'alsa', label: 'ALSA' },
]

function sortCards(cards: Card[], key: SortKey): Card[] {
  const value = (c: Card) => {
    if (key === 'advisor') return c.recommendation?.score ?? -1
    const s = displayStats(c).stats
    return key === 'gihwr' ? s.gihwr : -(s.alsa || 99)
  }
  return [...cards].sort((a, b) => value(b) - value(a))
}

export function PackView({ cards, missing }: { cards: Card[]; missing: Card[] }) {
  const [sort, setSort] = useState<SortKey>('advisor')
  const [showMissing, setShowMissing] = useState(false)

  const sorted = useMemo(() => sortCards(cards, sort), [cards, sort])
  const best = useMemo(
    () => cards.reduce<Card | null>((top, c) => ((c.recommendation?.score ?? -1) > (top?.recommendation?.score ?? -1) ? c : top), null),
    [cards],
  )
  const maxScore = best?.recommendation?.score ?? 0

  if (!cards.length) {
    return <Empty>Waiting for the next pack…</Empty>
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex rounded-md bg-white/5 p-0.5 text-[11px]">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`rounded px-2 py-0.5 transition-colors ${
                sort === s.key ? 'bg-white/10 text-white' : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pr-2 text-[10px] tracking-wide text-stone-500 uppercase">
          <span className="w-10 text-right">GIH</span>
          <span className="w-8 text-right">ALSA</span>
          <span className="w-7 text-center">Grd</span>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        {sorted.map((card) => (
          <CardRow
            key={card.name}
            card={card}
            highlight={card === best}
            strength={maxScore > 0 ? Math.max(0, card.recommendation?.score ?? 0) / maxScore : 0}
          />
        ))}
      </div>

      {missing.length > 0 && (
        <div className="mt-1 border-t border-line pt-2">
          <button
            onClick={() => setShowMissing((v) => !v)}
            className="flex w-full items-center justify-between px-1 text-[11px] tracking-wide text-stone-400 uppercase hover:text-stone-200"
          >
            <span>Taken from this pack ({missing.length})</span>
            <span>{showMissing ? '−' : '+'}</span>
          </button>
          {showMissing && (
            <div className="mt-1 flex flex-col gap-0.5">
              {sortCards(missing, 'gihwr').map((card) => (
                <CardRow key={card.name} card={card} dimmed />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-40 items-center justify-center text-stone-500">{children}</div>
}
