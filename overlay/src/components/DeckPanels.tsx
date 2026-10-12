import { useEffect, useState } from 'react'
import type { Card, SimStats } from '../types'
import { useApp } from '../store'
import { COLOR_LABEL, COLOR_VAR, identityColor, tagLabel } from '../lib/cards'
import { sampleHand, summarize } from '../lib/deck'
import { useCardProps } from './CardHover'
import { Button, Section, Spinner, Stat } from './primitives'

export function DeckStats({ deck }: { deck: Card[] }) {
  const { meta } = useApp()
  const s = summarize(deck)
  const max = Math.max(4, ...s.curve)
  return (
    <Section id="deck_stats_panel" title="Deck stats">
      <div className="flex flex-col gap-3 text-[12px]">
        <div className="text-stone-300">
          <b className="text-white">{s.total}</b> cards · {s.creatures} creatures · {s.spells} non-creatures · {s.lands} lands
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Color requirements (pips)</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(s.pips).filter(([, n]) => n > 0).map(([c, n]) => (
              <span key={c} className="flex items-center gap-1 text-stone-300">
                <span className="size-2.5 rounded-full" style={{ background: COLOR_VAR[c] }} />{COLOR_LABEL[c]} {n}
              </span>
            ))}
            {Object.values(s.pips).every((n) => !n) && <span className="text-stone-500">Colorless</span>}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Mana curve (avg CMC {s.avgCmc.toFixed(2)})</div>
          <div className="flex items-end gap-1.5" style={{ height: 56 }}>
            {s.curve.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                <span className="tabular text-[10px] text-stone-400">{n || ''}</span>
                <div className="w-full rounded-t-sm bg-accent/70" style={{ height: Math.max(n ? 2 : 0, (n / max) * 34) }} />
                <span className="text-[10px] text-stone-500">{i < 5 ? i + 1 : '6+'}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Roles & synergies</div>
          {s.tags.length ? (
            <div className="flex flex-wrap gap-1">
              {s.tags.map(([t, n]) => <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-stone-300">{tagLabel(t, meta?.tagVisuals ?? {})}: {n}</span>)}
            </div>
          ) : (
            <span className="text-stone-500">No Scryfall tags found for this set.</span>
          )}
        </div>
      </div>
    </Section>
  )
}

type Threshold = [label: string, key: keyof SimStats, good: number, fair: number, reverse?: boolean, percent?: boolean]

const CONSISTENCY: Threshold[] = [
  ['T2 play (2-drop)', 'cast_t2', 65, 50],
  ['T3 play (3-drop)', 'cast_t3', 65, 50],
  ['T4 play (4-drop)', 'cast_t4', 55, 40],
  ['Perfect curve (T2–T4)', 'curve_out', 25, 15],
  ['Removal by turn 4', 'removal_t4', 60, 45],
]
const RISKS: Threshold[] = [
  ['Mulligan rate', 'mulligans', 15, 25, true],
  ['Avg. hand size', 'avg_hand_size', 6.8, 6.5, false, false],
  ['Missed 3rd land drop', 'screw_t3', 15, 25, true],
  ['Missed 4th land drop', 'screw_t4', 25, 35, true],
  ['Color screwed (T3)', 'color_screw_t3', 6, 12, true],
  ['Mana flooded (T5)', 'flood_t5', 20, 30, true],
]

function SimRow([label, key, good, fair, reverse = false, percent = true]: Threshold, stats: SimStats) {
  const v = stats[key] ?? 0
  const tone = reverse ? (v <= good ? 'good' : v <= fair ? 'fair' : 'bad') : v >= good ? 'good' : v >= fair ? 'fair' : 'bad'
  const word = { good: 'Great', fair: 'Fair', bad: 'Poor' }[tone]
  return <Stat key={key} label={label} tone={tone} value={`${percent ? `${v.toFixed(1)}%` : v.toFixed(2)} · ${word}`} />
}

export function SimResults({ stats, note, advice, busy, message }: { stats: SimStats | null; note?: string | null; advice?: string[]; busy?: boolean; message?: string }) {
  return (
    <Section id="simulation_panel" title="Simulation (10,000 games)">
      {busy ? (
        <div className="flex items-center gap-2 py-4 text-[12px] text-stone-400"><Spinner /> {message || 'Running 10,000 Monte Carlo simulations…'}</div>
      ) : !stats ? (
        <div className="py-2 text-[12px] text-stone-500">{message || 'Run Analyze to simulate draws from this deck.'}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold tracking-wider text-accent uppercase">Consistency</div>
            {CONSISTENCY.map((t) => SimRow(t, stats))}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[10px] font-semibold tracking-wider text-accent uppercase">Risk factors</div>
            {RISKS.map((t) => SimRow(t, stats))}
          </div>
          {(note || advice?.length) ? (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-semibold tracking-wider text-accent uppercase">Advisor summary</div>
              {note && <div className="text-[12px] font-semibold text-emerald-300">{note}</div>}
              {advice?.map((a) => <div key={a} className="text-[12px] text-stone-300">• {a}</div>)}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  )
}

export function SampleHand({ deck }: { deck: Card[] }) {
  const [hand, setHand] = useState<Card[]>([])
  useEffect(() => setHand(sampleHand(deck)), [deck])
  return (
    <Section id="sample_hand_panel" title="Sample hand" right={<Button variant="ghost" onClick={() => setHand(sampleHand(deck))}>Draw new hand</Button>}>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {hand.map((c, i) => <HandCard key={`${c.name}-${i}`} card={c} />)}
      </div>
    </Section>
  )
}

function HandCard({ card }: { card: Card }) {
  const props = useCardProps(card)
  return (
    <div {...props} className="overflow-hidden rounded-md ring-1 ring-black/40" style={{ aspectRatio: '488 / 680' }}>
      {card.images[0] ? (
        <img src={card.images[0]} alt={card.name} className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full items-center justify-center bg-stone-800 p-1 text-center text-[10px] text-stone-200" style={{ borderTop: `3px solid ${identityColor(card)}` }}>
          {card.name}
        </div>
      )}
    </div>
  )
}
