import type { Card } from '../types'
import { useApp } from '../store'
import { COLORS, COLOR_LABEL, COLOR_VAR, tagLabel } from '../lib/cards'
import { useCardProps } from './CardHover'

/** Port of ManaCurvePlot: bars 0..5 and 6+, dashed ideal outline, colored by distance from ideal. */
export function ManaCurve({ counts, ideal }: { counts: number[]; ideal: number[] }) {
  const current = counts.length > 6 ? [...counts.slice(0, 6), counts.slice(6).reduce((a, b) => a + b, 0)] : counts
  const max = Math.max(5, ...current, ...ideal)
  const H = 64
  return (
    <div className="flex items-end justify-center gap-1.5" style={{ height: H + 30 }}>
      {current.map((c, i) => {
        const t = ideal[i] ?? 0
        const color = c > t + 1 ? '#ef4444' : c < t && t > 0 ? '#f59e0b' : c >= t ? '#10b981' : 'var(--color-accent)'
        return (
          <div key={i} className="flex w-6 flex-col items-center gap-1">
            <span className="tabular h-3 text-[10px] font-semibold text-stone-300">{c || ''}</span>
            <div className="relative w-full" style={{ height: H }}>
              {t > 0 && <div className="absolute inset-x-0 bottom-0 border border-dashed border-stone-400/60" style={{ height: (t / max) * H }} />}
              <div className="absolute inset-x-0.5 bottom-0 rounded-t-sm" style={{ height: Math.max(c ? 2 : 0, (c / max) * H), background: color }} />
            </div>
            <span className="text-[10px] text-stone-500">{i < 6 ? i : '6+'}</span>
          </div>
        )
      })}
    </div>
  )
}

export function SignalMeter({ signals }: { signals: Record<string, number> }) {
  const max = Math.max(5, ...COLORS.map((c) => signals[c] ?? 0))
  const top = [...COLORS].sort((a, b) => (signals[b] ?? 0) - (signals[a] ?? 0))
  return (
    <div className="flex flex-col gap-1">
      {COLORS.map((c) => {
        const v = signals[c] ?? 0
        return (
          <div key={c} className="flex items-center gap-2 text-[11px]">
            <span className="w-10 text-stone-400">{COLOR_LABEL[c]}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: COLOR_VAR[c] }} />
            </div>
            <span className={`tabular w-8 text-right ${c === top[0] || c === top[1] ? 'font-semibold text-stone-100' : 'text-stone-500'}`}>{v.toFixed(1)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Compact header version: one dot per color, sized by signal strength. */
export function SignalDots({ signals }: { signals: Record<string, number> }) {
  const max = Math.max(...COLORS.map((c) => signals[c] ?? 0), 1)
  return (
    <div className="flex items-center gap-1" title="Open lanes (signals)">
      {COLORS.map((c) => {
        const v = signals[c] ?? 0
        return <span key={c} className="rounded-full" title={`${COLOR_LABEL[c]}: ${v.toFixed(1)}`} style={{ background: COLOR_VAR[c], width: 4 + (v / max) * 6, height: 4 + (v / max) * 6, opacity: 0.35 + (v / max) * 0.65 }} />
      })}
    </div>
  )
}

const TYPE_COLORS: Record<string, string> = {
  Creature: '#10b981', Planeswalker: '#a855f7', Battle: '#f43f5e', Instant: '#3b82f6',
  Sorcery: '#ef4444', Enchantment: '#eab308', Artifact: '#94a3b8', Land: '#a16207',
}

export function TypeBreakdown({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (!total) return <div className="text-[11px] text-stone-500">No cards yet</div>
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 overflow-hidden rounded-full">
        {entries.map(([t, n]) => <div key={t} title={`${t}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: TYPE_COLORS[t] ?? '#78716c' }} />)}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        {entries.map(([t, n]) => (
          <div key={t} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: TYPE_COLORS[t] ?? '#78716c' }} />
            <span className="flex-1 text-stone-400">{t}</span>
            <span className="tabular text-stone-200">{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Port of AdvisorPanel: top picks with score, elite marker, reasoning and roles. */
export function AdvisorPicks({ cards, limit = 3 }: { cards: Card[]; limit?: number }) {
  const recs = cards.filter((c) => c.recommendation).sort((a, b) => b.recommendation!.score - a.recommendation!.score).slice(0, limit)
  if (!recs.length) return <div className="py-2 text-center text-[11px] text-stone-500">Calculating tactical scores...</div>
  return (
    <div className="flex flex-col gap-2.5">
      {recs.map((c) => <AdvisorPick key={c.name} card={c} />)}
    </div>
  )
}

function AdvisorPick({ card }: { card: Card }) {
  const { meta } = useApp()
  const props = useCardProps(card)
  const rec = card.recommendation!
  const tone = rec.isElite ? 'text-emerald-400' : 'text-accent'
  let reason = rec.reasoning.join(' | ') || 'Tactically superior for your pool'
  if (rec.isElite) reason = `ELITE PICK (+${rec.zScore}σ)${rec.reasoning.length ? ` | ${rec.reasoning.join(' | ')}` : ''}`
  return (
    <div {...props} className="flex gap-2">
      <span className={`w-1 shrink-0 rounded-full ${rec.isElite ? 'bg-emerald-400' : 'bg-accent'}`} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className={`tabular text-[15px] font-bold ${tone}`}>{rec.isElite ? '★ ' : ''}{rec.score.toFixed(0)}</span>
          <span className="text-stone-600">|</span>
          <span className={`truncate text-[12px] uppercase ${rec.isElite ? 'font-bold text-emerald-300' : 'text-stone-100'}`}>{card.name}</span>
        </div>
        <div className="text-[11px] text-stone-400">{reason}</div>
        {rec.tags.length > 0 && <div className="text-[11px] text-stone-500">{rec.tags.map((t) => tagLabel(t, meta?.tagVisuals ?? {})).join(', ')}</div>}
      </div>
    </div>
  )
}
