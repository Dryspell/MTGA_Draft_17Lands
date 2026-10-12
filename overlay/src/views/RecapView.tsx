import type { ReactNode } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import type { PickEntry, RecapEntry } from '../types'
import { gradeTone, tagLabel } from '../lib/cards'
import { TypeBreakdown } from '../components/Charts'
import { Button, Section } from '../components/primitives'

/** Port of DraftRecapScreen: the post-draft summary. */
export function RecapView() {
  const { snapshot, meta, toast } = useApp()
  const { setTab, setSealedId } = useUi()
  const recap = snapshot?.recap
  if (!snapshot || !recap) return null

  const openSealed = async () => {
    try {
      const s = await api.liveSealed()
      setSealedId(s.id)
      setTab('sealed')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const [letter, ...rest] = recap.grade.split(' ')
  const verdict = rest.join(' ').replace(/[()]/g, '')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 rounded-lg bg-panel p-4">
        <div className={`flex size-16 shrink-0 items-center justify-center rounded-xl text-2xl font-bold ${gradeTone(letter)}`}>{letter}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wider text-stone-500 uppercase">{snapshot.isSealed ? 'Sealed pool' : 'Draft complete'} · {snapshot.event.set} {snapshot.event.type}</div>
          <div className="text-[22px] font-bold text-white">Pool power {recap.poolPower.toFixed(0)}{verdict && <span className="ml-2 text-[14px] font-medium text-stone-400">{verdict}</span>}</div>
          <div className="text-[12px] text-stone-400">
            Top 23 average {recap.top23Avg.toFixed(1)}% vs format {recap.formatAvg.toFixed(1)}%
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button variant="primary" onClick={() => setTab('builder')}>Build deck</Button>
          {snapshot.isSealed && <Button onClick={openSealed}>Open Sealed Studio</Button>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Best archetypes">
          {recap.archetypes.map((a) => (
            <Line key={a.key} left={`${a.name} (${a.key})`} right={`${a.gihwr.toFixed(1)}%`} />
          ))}
        </Section>
        <Section title="Best cards"><Entries list={recap.bestCards} /></Section>
        <Section title="Steals (taken later than usual)"><Picks list={recap.steals} sign="+" /></Section>
        <Section title="Reaches (taken earlier than usual)"><Picks list={recap.reaches} sign="-" /></Section>
        {recap.rares.length > 0 && <Section title="Rares & mythics"><Entries list={recap.rares} /></Section>}
        {recap.staples.length > 0 && <Section title="Removal & staples"><Entries list={recap.staples} /></Section>}
        {recap.lands.length > 0 && <Section title="Fixing & lands"><Entries list={recap.lands} /></Section>}
        {recap.roles.length > 0 && (
          <Section title="Roles">
            {recap.roles.map((r) => <Line key={r.tag} left={tagLabel(r.tag, meta?.tagVisuals ?? {})} right={r.count} />)}
          </Section>
        )}
        {recap.tribes.length > 0 && (
          <Section title="Tribes">{recap.tribes.map((t) => <Line key={t.name} left={t.name} right={t.count} />)}</Section>
        )}
        <Section title="Card types"><TypeBreakdown counts={recap.typeCounts} /></Section>
      </div>
    </div>
  )
}

function Line({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-[12px]">
      <span className="truncate text-stone-300">{left}</span>
      <span className="tabular text-stone-100">{right}</span>
    </div>
  )
}

const Entries = ({ list }: { list: RecapEntry[] }) => (
  <>{list.map((c) => <Line key={c.name} left={c.name} right={c.gihwr ? `${c.gihwr.toFixed(1)}%` : '-'} />)}</>
)

const Picks = ({ list, sign }: { list: PickEntry[]; sign: string }) =>
  list.length ? (
    <>{list.map((c) => <Line key={c.name} left={`${c.name} · P${c.pack}p${c.pick}`} right={<span className={sign === '+' ? 'text-emerald-300' : 'text-amber-300'}>{sign}{c.delta.toFixed(1)}</span>} />)}</>
  ) : (
    <div className="text-[11px] text-stone-500">None</div>
  )
