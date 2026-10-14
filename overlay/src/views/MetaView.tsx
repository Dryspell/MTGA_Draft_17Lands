import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import type { ConstructedDeck, Job, MetaArchetype, MetaCard, MetaDeck, MetaFormatData, MetaOverview, WinLoss } from '../types'
import { RARITY_TONE, WILDCARDS } from '../lib/cards'
import { copyText } from '../lib/platform'
import { shortDate } from '../lib/dates'
import { Button, Empty, Progress, Section, Select, Spinner } from '../components/primitives'
import { Pips, WinLossText } from '../components/Records'

const pct = (v: number) => `${Math.round(v * 100)}%`
const SOURCE_LABEL: Record<string, string> = { mtgtop8: 'mtgtop8', spicerack: 'Spicerack' }

const FLEX_ROWS = 15

const placing = (rank: string) => {
  if (/^\d+$/.test(rank)) return `#${rank}`
  const range = rank.match(/^\d+-(\d+)$/)
  return range ? `Top ${range[1]}` : rank
}

const deckText = (d: MetaDeck) =>
  ['Deck', ...d.main.map((c) => `${c.count} ${c.name}`), ...(d.side.length ? ['', 'Sideboard', ...d.side.map((c) => `${c.count} ${c.name}`)] : [])].join('\n')

export function MetaView({ onImported }: { onImported: (deck: ConstructedDeck) => void }) {
  const { config, patchSettings, runJob, toast } = useApp()
  const enabled = !!config?.settings.meta_enabled
  const mtgtop8 = !!config?.settings.meta_mtgtop8
  const [overview, setOverview] = useState<MetaOverview | null>(null)
  const [chosen, setChosen] = useState(() => localStorage.getItem('meta-format') ?? '')
  const [data, setData] = useState<MetaFormatData | null>(null)
  const [selected, setSelected] = useState('')
  // Progress belongs to one format's download, which keeps going if you switch away.
  const [jobs, setJobs] = useState<Record<string, string>>({})
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api.metagame().then(setOverview).catch((e) => toast((e as Error).message, 'error'))
  }, [enabled, mtgtop8, tick, toast])

  // Until the overview arrives we don't know which format you play, so don't guess and fetch the wrong one.
  const format = chosen || overview?.suggested || ''
  const pick = (f: string) => {
    localStorage.setItem('meta-format', f)
    setChosen(f)
    setSelected('')
  }

  const follow = useCallback((fmt: string, start: Promise<Job>, failure: string) => {
    const report = (message: string | null) => setJobs((j) => {
      const next = { ...j }
      if (message === null) delete next[fmt]
      else next[fmt] = message
      return next
    })
    report('Starting…')
    runJob(start, (j) => report(j.message || 'Downloading tournament results…'))
      .then(() => setTick((t) => t + 1))
      .catch((e) => toast(`${failure}${(e as Error).message}`, 'error'))
      .finally(() => report(null))
  }, [runJob, toast])

  useEffect(() => {
    if (!enabled || !format) return
    let alive = true
    api.metagameFormat(format).then((d) => {
      if (!alive) return
      setData(d)
      if (d.job && d.job.status === 'running') follow(format, Promise.resolve(d.job), 'Metagame update failed: ')
    }).catch((e) => alive && toast((e as Error).message, 'error'))
    return () => { alive = false }
  }, [enabled, mtgtop8, format, tick, follow, toast])
  const progress = jobs[format] ?? null

  if (!config) return null
  if (!enabled) {
    return (
      <Empty
        title="Tournament metagame is off"
        action={<Button variant="primary" onClick={() => patchSettings({ meta_enabled: true })}>Turn on</Button>}
      >
        Download recent tournament decklists to name opponents' archetypes, see your record against the top decks, compare your lists with stock ones, and import netdecks with their wildcard cost.
        Lists come from Spicerack's public API, plus mtgtop8.com if you allow it in Settings. They're fetched at most once a day and cached on this PC.
      </Empty>
    )
  }

  const shown = data?.format === format ? data : null
  const archetypes = shown?.archetypes ?? []
  const current = archetypes.find((a) => a.id === selected) ?? archetypes[0] ?? null
  const formats = overview?.formats.filter((f) => f.available || f.format === format) ?? []

  const refresh = () => follow(format, api.refreshMetagame(format), '')

  return (
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel px-3 py-2">
        <Select value={format} onChange={(e) => pick(e.target.value)}>
          {formats.map((f) => <option key={f.format} value={f.format}>{f.format}{f.played ? ` · ${f.played} of your decks` : ''}</option>)}
        </Select>
        <div className="min-w-0 flex-1 text-[11px] text-stone-500">
          {shown?.fetched ? <>Updated {new Date(shown.fetched).toLocaleString()}</> : 'Not downloaded yet'}
          {Object.entries(shown?.sources ?? {}).map(([k, s]) => (
            <span key={k} className={`ml-2 ${s?.ok ? 'text-stone-400' : 'text-amber-300'}`} title={s?.error}>
              · {SOURCE_LABEL[k] ?? k}: {s?.ok ? `${s.decks ?? 0} lists` : `${s?.error}${s?.stale ? ', showing its previous lists' : ''}`}
            </span>
          ))}
        </div>
        <Button onClick={refresh} disabled={progress !== null}>Refresh</Button>
      </div>
      {progress !== null && <div className="rounded-lg bg-panel px-3 py-2"><Progress value={null} message={progress} /></div>}
      {!mtgtop8 && (
        <p className="px-1 text-[11px] text-stone-500">
          Only Spicerack is on. Turning on mtgtop8 in Settings adds named archetypes and meta share from MTGO and paper events, and covers Alchemy.
        </p>
      )}

      {!shown ? (
        <Empty title={<span className="flex items-center gap-2"><Spinner /> Loading {format || 'the metagame'}…</span>} />
      ) : !archetypes.length ? (
        <Empty title={`No ${format} tournament data yet`}>
          {progress !== null ? 'Downloading now. This takes about a minute because the sites are read slowly on purpose.' : 'Press Refresh to download it.'}
        </Empty>
      ) : (
        <div className="grid items-start gap-3 @min-[720px]:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-0.5 rounded-lg bg-panel p-2">
            {archetypes.map((a) => <ArchetypeRow key={a.id} arch={a} max={archetypes[0].share} active={a.id === current?.id} onClick={() => setSelected(a.id)} />)}
            {shown.unmatched && shown.unmatched.games > 0 && (
              <div className="mt-1 flex items-center justify-between border-t border-line px-2 pt-1.5 text-[11px] text-stone-500" title="Past opponents whose revealed cards didn't clearly match a tournament archetype">
                <span>Other opponents</span><WinLossText r={shown.unmatched} />
              </div>
            )}
          </aside>
          {current && <ArchetypeDetail key={current.id} arch={current} format={format} onImported={onImported} />}
        </div>
      )}
    </div>
  )
}

function ArchetypeRow({ arch, max, active, onClick }: { arch: MetaArchetype; max: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex flex-col gap-0.5 rounded px-2 py-1 text-left text-[12px] ${active ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-white/5'}`}>
      <span className="flex items-center gap-1.5">
        <Pips colors={arch.colors} />
        <span className="min-w-0 flex-1 truncate text-stone-100">{arch.name}</span>
        <span className="tabular text-[11px] text-stone-300">{pct(arch.share)}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
          <span className="block h-full rounded-full bg-accent/60" style={{ width: `${(arch.share / (max || 1)) * 100}%` }} />
        </span>
        {arch.record.games > 0 && <span className="text-[10px] text-stone-500">you <WinLossText r={arch.record} /></span>}
      </span>
    </button>
  )
}

function ArchetypeDetail({ arch, format, onImported }: { arch: MetaArchetype; format: string; onImported: (deck: ConstructedDeck) => void }) {
  const core = useMemo(() => arch.cards.filter((c) => c.inclusion >= 0.5 && !c.land), [arch])
  const flex = useMemo(() => arch.cards.filter((c) => c.inclusion < 0.5 && c.inclusion >= 0.2 && !c.land), [arch])
  const lands = useMemo(() => arch.cards.filter((c) => c.inclusion >= 0.5 && c.land), [arch])
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-panel px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wider text-stone-500 uppercase">
            {format}{arch.style ? ` · ${arch.style}` : ''} · {SOURCE_LABEL[arch.source]}
          </div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white"><Pips colors={arch.colors} /> <span className="truncate">{arch.name}</span></div>
          <div className="text-[11px] text-stone-400">
            {pct(arch.share)} of the meta · {arch.deckCount} list{arch.deckCount === 1 ? '' : 's'} sampled
            {arch.winRate !== null && <> · {pct(arch.winRate)} match wins in {arch.matches} tournament rounds</>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-stone-500 uppercase">Your record vs it</div>
          {arch.record.games ? <MyRecord r={arch.record} /> : <div className="text-[12px] text-stone-500">Not faced yet</div>}
        </div>
        {arch.url && <Button variant="ghost" onClick={() => api.openUrl(arch.url)}>Open on mtgtop8</Button>}
      </div>

      <div className="grid items-start gap-3 @min-[560px]:grid-cols-2">
        <Section id="meta_core" title={`Core cards · ${core.length}`}>
          <CardShares cards={core} />
          {lands.length > 0 && <div className="mt-2"><div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Lands</div><CardShares cards={lands} /></div>}
        </Section>
        <Section id="meta_flex" title={`Flex slots · ${flex.length}`}>
          {flex.length ? <CardShares cards={flex.slice(0, FLEX_ROWS)} /> : <p className="text-[12px] text-stone-500">The sampled lists agree on almost everything.</p>}
          {flex.length > FLEX_ROWS && <p className="mt-1 text-[11px] text-stone-500">and {flex.length - FLEX_ROWS} more, each in fewer lists</p>}
        </Section>
      </div>

      <Section id="meta_lists" title={`Lists · ${arch.decks.length}`}>
        <div className="flex flex-col gap-1.5">
          {arch.decks.map((d) => <SampleList key={d.id} deck={d} format={format} onImported={onImported} />)}
        </div>
        <p className="mt-2 text-[10px] text-stone-500">Wildcard costs use the cards you're known to own from decks you've queued or played with.</p>
      </Section>
    </div>
  )
}

function MyRecord({ r }: { r: WinLoss }) {
  const rate = r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0
  return <div><WinLossText r={r} className="text-[16px] font-bold" /> <span className="text-[11px] text-stone-500">{pct(rate)}</span></div>
}

function CardShares({ cards }: { cards: MetaCard[] }) {
  return (
    <div className="flex flex-col text-[12px]">
      {cards.map((c) => (
        <div key={c.name} className="flex items-center gap-2 rounded px-1 py-[1px] hover:bg-white/5" title={`In ${pct(c.inclusion)} of lists, ${c.avg.toFixed(1)} copies on average`}>
          <span className="tabular w-6 text-right text-stone-400">{c.avg.toFixed(c.avg % 1 ? 1 : 0)}</span>
          <span className="min-w-0 flex-1 truncate text-stone-200">{c.name}</span>
          <span className="h-1 w-12 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-accent/60" style={{ width: pct(c.inclusion) }} /></span>
          <span className="tabular w-8 text-right text-[10px] text-stone-500">{pct(c.inclusion)}</span>
        </div>
      ))}
    </div>
  )
}

function SampleList({ deck, format, onImported }: { deck: MetaDeck; format: string; onImported: (deck: ConstructedDeck) => void }) {
  const { toast } = useApp()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const cost = deck.cost
  const record = deck.wins !== undefined && deck.losses !== undefined && deck.wins + deck.losses > 0 ? `${deck.wins}–${deck.losses}` : ''
  const importIt = () => {
    setBusy(true)
    api.importMetaDeck(format, deck.id)
      .then((d) => { toast(`Imported ${d.name}`, 'success'); onImported(d) })
      .catch((e) => toast((e as Error).message, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="rounded bg-white/[0.03] px-2 py-1.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <button className="min-w-0 flex-1 truncate text-left text-stone-200 hover:text-white" onClick={() => setOpen(!open)} title="Show the list">
          <span className={`mr-1 inline-block text-[9px] text-stone-500 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          {deck.player || 'Unknown player'} <span className="text-stone-500">· {deck.event}{deck.rank ? ` · ${placing(deck.rank)}` : ''}{record ? ` · ${record}` : ''}{deck.date ? ` · ${shortDate(deck.date)}` : ''}</span>
        </button>
        {cost && <Cost cost={cost} />}
        <button className="text-[11px] text-stone-400 hover:text-stone-100" onClick={() => copyText(deckText(deck)).then(() => toast('List copied in Arena format', 'success'))}>Copy</button>
        <Button onClick={importIt} busy={busy}>Import</Button>
      </div>
      {open && (
        <div className="mt-1 grid gap-x-4 text-[11px] text-stone-300 @min-[460px]:grid-cols-2">
          <div>{deck.main.map((c) => <div key={c.name}><span className="tabular inline-block w-5 text-right text-stone-500">{c.count}</span> {c.name}</div>)}</div>
          {deck.side.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Sideboard</div>
              {deck.side.map((c) => <div key={c.name}><span className="tabular inline-block w-5 text-right text-stone-500">{c.count}</span> {c.name}</div>)}
            </div>
          )}
          {deck.url && <button className="mt-1 text-left text-accent hover:underline" onClick={() => api.openUrl(deck.url)}>View the original</button>}
        </div>
      )}
    </div>
  )
}

function Cost({ cost }: { cost: NonNullable<MetaDeck['cost']> }) {
  if (!cost.missing) return <span className="rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-300">You own it</span>
  return (
    <span className={`flex items-center gap-1.5 text-[10px] ${cost.affordable === false ? 'opacity-90' : ''}`} title={cost.affordable === false ? 'More wildcards than you have' : 'Wildcards needed'}>
      {WILDCARDS.filter((r) => cost.wildcards[r]).map((r) => (
        <span key={r} className={`font-semibold ${RARITY_TONE[r]}`}>{cost.wildcards[r]}{r[0].toUpperCase()}</span>
      ))}
      {cost.affordable === false && <span className="text-red-300">short</span>}
    </span>
  )
}
