import { useMemo } from 'react'
import type { Card, Snapshot } from '../types'
import { COLORS, COLOR_VAR, cardColors, displayStats } from '../lib/cards'
import { CardRow } from './CardRow'
import { Empty } from './PackView'

const GROUPS = [...COLORS, 'Multi', 'Colorless'] as const
const GROUP_LABEL: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', Multi: 'Multicolor', Colorless: 'Colorless',
}

function groupOf(card: Card): string {
  const colors = cardColors(card)
  if (colors.length > 1) return 'Multi'
  return colors[0] ?? 'Colorless'
}

function Curve({ curve }: { curve: number[] }) {
  const max = Math.max(4, ...curve)
  return (
    <div className="flex items-end gap-1">
      {curve.map((n, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="tabular text-[10px] text-stone-400">{n || ''}</span>
          <div className="w-full rounded-sm bg-accent/70" style={{ height: Math.max(2, (n / max) * 48) }} />
          <span className="text-[10px] text-stone-500">{i === 7 ? '7+' : i}</span>
        </div>
      ))}
    </div>
  )
}

export function PoolView({ snapshot }: { snapshot: Snapshot }) {
  const { pool, curve, creatureCount, noncreatureCount, poolSize } = snapshot

  const groups = useMemo(() => {
    const map = new Map<string, Card[]>()
    for (const card of pool) {
      const g = groupOf(card)
      map.set(g, [...(map.get(g) ?? []), card])
    }
    for (const cards of map.values()) {
      cards.sort((a, b) => displayStats(b).stats.gihwr - displayStats(a).stats.gihwr)
    }
    return GROUPS.filter((g) => map.has(g)).map((g) => ({ group: g, cards: map.get(g)! }))
  }, [pool])

  if (!pool.length) return <Empty>No picks yet</Empty>

  const colorCounts = COLORS.map((c) => ({
    c,
    n: pool.reduce((sum, card) => sum + (cardColors(card).includes(c) ? card.count : 0), 0),
  }))
  const colorTotal = colorCounts.reduce((s, x) => s + x.n, 0) || 1

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-panel p-3">
        <div className="mb-2 flex justify-between text-[11px] text-stone-400">
          <span>{poolSize} cards</span>
          <span>
            {creatureCount} creatures · {noncreatureCount} spells
          </span>
        </div>
        <Curve curve={curve} />
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/5">
          {colorCounts.map(({ c, n }) => (
            <div key={c} style={{ width: `${(n / colorTotal) * 100}%`, background: COLOR_VAR[c] }} title={`${c}: ${n}`} />
          ))}
        </div>
      </div>

      {groups.map(({ group, cards }) => (
        <section key={group}>
          <h3 className="mb-1 flex items-center gap-1.5 px-1 text-[11px] tracking-wide text-stone-400 uppercase">
            <span className="size-2 rounded-full" style={{ background: COLOR_VAR[group] ?? 'var(--color-mana-gold)' }} />
            {GROUP_LABEL[group]}
            <span className="text-stone-600">{cards.reduce((s, c) => s + c.count, 0)}</span>
          </h3>
          <div className="flex flex-col gap-0.5">
            {cards.map((card) => (
              <CardRow key={card.name} card={card} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
