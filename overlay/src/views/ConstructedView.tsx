import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import type { CollectionCheck, ConstructedDeck, ConstructedDeckSummary, DeckCard, DeckEntry, DeckVersion, MetaCompare, PaperList, RecordBreakdown, SideboardGuide, SimStats, WinLoss } from '../types'
import { RARITY_TONE, WILDCARDS, identityColor, isCreature, isLand } from '../lib/cards'
import { openingLands } from '../lib/deck'
import { eventLabel } from '../lib/game'
import { copyText, readClipboard } from '../lib/platform'
import { shortDate } from '../lib/dates'
import { markEditing } from '../lib/editing'
import { useCardProps } from '../components/cardInteractions'
import { ManaCost } from '../components/ManaCost'
import { DeckStats, DeckSummaryBar, SampleHand, SimResults } from '../components/DeckPanels'
import { Button, Check, Empty, Input, Modal, Section, Segmented, Select, Spinner } from '../components/primitives'
import { Breakdown, Pips, WinLossText } from '../components/Records'
import { MetaView } from './MetaView'

type DeckList = Awaited<ReturnType<typeof api.constructedDecks>>

const pct = (v: number) => `${Math.round(v * 100)}%`
const winRate = (r: WinLoss) => (r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0)
const RESULT_TONE: Record<string, string> = { win: 'bg-emerald-500/15 text-emerald-300', loss: 'bg-red-500/15 text-red-300', draw: 'bg-white/10 text-stone-300' }

export function ConstructedView() {
  const { decksVersion, toast } = useApp()
  const [list, setList] = useState<DeckList | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelectedState] = useState<string | null>(() => localStorage.getItem('constructed-deck'))
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState('')
  const [showUnknown, setShowUnknown] = useState(false)
  const [importing, setImporting] = useState(false)
  const [mode, setModeState] = useState<'decks' | 'meta'>(() => (localStorage.getItem('constructed-mode') === 'meta' ? 'meta' : 'decks'))

  const setMode = (m: 'decks' | 'meta') => {
    localStorage.setItem('constructed-mode', m)
    setModeState(m)
  }
  const setSelected = (id: string | null) => {
    if (id) localStorage.setItem('constructed-deck', id)
    else localStorage.removeItem('constructed-deck')
    setSelectedState(id)
  }

  const reload = useCallback(() => {
    api.constructedDecks().then((l) => { setList(l); setError('') }).catch((e) => setError((e as Error).message))
  }, [])
  useEffect(reload, [decksVersion, reload])

  const formats = useMemo(() => [...new Set((list?.decks ?? []).map((d) => d.format).filter(Boolean))].sort(), [list])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list?.decks ?? []).filter((d) =>
      (showUnknown || d.known) && (!format || d.format === format) && (!q || d.name.toLowerCase().includes(q)))
  }, [list, query, format, showUnknown])

  const switcher = (
    <div className="mb-2 flex">
      <Segmented value={mode} onChange={setMode} options={[{ value: 'decks', label: 'My decks' }, { value: 'meta', label: 'Metagame' }]} />
    </div>
  )
  if (mode === 'meta') {
    return <div>{switcher}<MetaView onImported={(d) => { setSelected(d.id); setMode('decks'); reload() }} /></div>
  }
  if (error && !list) return <Empty title="Constructed decks unavailable">{error}</Empty>
  if (!list) return <Empty title={<span className="flex items-center gap-2"><Spinner /> Loading decks…</span>} />

  const current = list.decks.find((d) => d.id === selected) ?? visible[0] ?? null
  const unknownCount = list.decks.filter((d) => !d.known).length

  return (
    <div className="@container">
      {switcher}
      <div className="grid items-start gap-3 @min-[720px]:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-2 rounded-lg bg-panel p-2 @min-[720px]:sticky @min-[720px]:top-0 @min-[720px]:max-h-[calc(100vh-7rem)]">
          <div className="flex gap-1.5">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search decks" className="min-w-0 flex-1" />
            <Button variant="primary" onClick={() => setImporting(true)} title="Paste a deck list to analyze it or check what you're missing">Import</Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={format} onChange={(e) => setFormat(e.target.value)} className="min-w-0 flex-1">
              <option value="">All formats</option>
              {formats.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
          </div>
          {unknownCount > 0 && (
            <Check checked={showUnknown} onChange={setShowUnknown} label={<span className="text-[11px] text-stone-400">Show {unknownCount} decks without a known list</span>}
              hint="Arena only logs a deck's cards when you save it, queue with it, or play it." />
          )}
          <div className="-mx-1 flex min-h-0 flex-col overflow-y-auto">
            {visible.map((d) => <DeckRow key={d.id} deck={d} active={d.id === current?.id} onClick={() => setSelected(d.id)} />)}
            {!visible.length && <p className="px-2 py-4 text-center text-[11px] text-stone-500">No decks match.</p>}
          </div>
          <Wildcards balance={list.wildcards} />
        </aside>

        <div className="min-w-0">
          {!list.cardsLoaded && (
            <div className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              Arena's card database wasn't found, so card details are missing. Set the MTGA data folder in Settings.
            </div>
          )}
          {current ? (
            <DeckDetail key={current.id} summary={current} onChanged={reload} onDeleted={() => { setSelected(null); reload() }} />
          ) : (
            <Empty title="No constructed decks yet" action={<Button variant="primary" onClick={() => setImporting(true)}>Import a deck list</Button>}>
              Decks appear here as Arena logs them: open a deck in Arena's deck builder, queue with it, or play a game. You can also paste any deck list.
            </Empty>
          )}
        </div>
      </div>
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onSaved={(d) => { setImporting(false); setSelected(d.id); reload(); toast(`Imported ${d.name}`, 'success') }}
        />
      )}
    </div>
  )
}

function DeckRow({ deck, active, onClick }: { deck: ConstructedDeckSummary; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] ${active ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-white/5'}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${deck.known ? 'text-stone-100' : 'text-stone-500'}`}>{deck.name}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-stone-500">
          <Pips colors={deck.colors} />
          {deck.format || (deck.source === 'import' ? 'Imported' : '')}
          {!deck.known && <span>· list unknown</span>}
        </span>
      </span>
      <WinLossText r={deck.record} className="text-[11px]" />
    </button>
  )
}

function Wildcards({ balance }: { balance: Record<string, number> }) {
  if (!Object.keys(balance).length) return null
  return (
    <div className="flex items-center justify-between gap-1 border-t border-line px-1 pt-2 text-[10px] text-stone-500" title="Wildcards from your last Arena login">
      {WILDCARDS.map((r) => (
        <span key={r} className="flex items-center gap-1"><span className={`font-bold ${RARITY_TONE[r]}`}>{r[0].toUpperCase()}</span><span className="tabular text-stone-300">{balance[r] ?? 0}</span></span>
      ))}
    </div>
  )
}

// ---- one deck ----------------------------------------------------------------

function DeckDetail({ summary, onChanged, onDeleted }: { summary: ConstructedDeckSummary; onChanged: () => void; onDeleted: () => void }) {
  const { decksVersion, toast } = useApp()
  const [deck, setDeck] = useState<ConstructedDeck | null>(null)
  const [sim, setSim] = useState<{ stats: SimStats | null; advice: string[]; busy: boolean; message?: string }>({ stats: null, advice: [], busy: false })
  const [buying, setBuying] = useState(false)

  const simulated = useRef('')
  const runSim = useCallback(() => {
    setSim((s) => ({ ...s, busy: true }))
    api.analyzeConstructed(summary.id)
      .then((r) => setSim({ ...r, busy: false }))
      .catch((e) => setSim({ stats: null, advice: [], busy: false, message: (e as Error).message }))
  }, [summary.id])

  useEffect(() => {
    api.constructedDeck(summary.id).then((d) => {
      setDeck(d)
      const key = d.main.map((c) => `${c.grpId}:${c.count}`).join(',')
      if (key !== simulated.current && d.main.reduce((n, c) => n + c.count, 0) >= 40) {
        simulated.current = key
        runSim()
      }
    }).catch((e) => toast((e as Error).message, 'error'))
  }, [summary.id, decksVersion, toast, runSim])

  const cardTotal = deck ? deck.main.reduce((n, c) => n + c.count, 0) : 0

  if (!deck) return <Empty title={<span className="flex items-center gap-2"><Spinner /> Loading {summary.name}…</span>} />

  const copy = async () => {
    await copyText(deck.text)
    toast('Deck copied in Arena format. Use Import in Arena\'s deck builder.', 'success')
  }
  const rename = async () => {
    const name = window.prompt('Deck name', deck.name)?.trim()
    if (!name || name === deck.name) return
    try {
      setDeck(await api.renameDeck(deck.id, name))
      onChanged()
    } catch (e) {
      toast(`Could not rename the deck: ${(e as Error).message}`, 'error')
    }
  }
  const remove = async () => {
    if (!window.confirm(`Delete the imported deck "${deck.name}"?`)) return
    try {
      await api.deleteDeck(deck.id)
      onDeleted()
    } catch (e) {
      toast(`Could not delete the deck: ${(e as Error).message}`, 'error')
    }
  }
  const target = deck.commander.length ? 100 : 60

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-panel px-4 py-3">
        {deck.tileImage && <img src={deck.tileImage} alt="" className="h-12 w-[34px] shrink-0 rounded object-cover ring-1 ring-black/40" />}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wider text-stone-500 uppercase">
            {deck.format || 'Constructed'}{deck.source === 'import' ? ' · imported' : ''}{deck.lastPlayed ? ` · played ${shortDate(deck.lastPlayed)}` : ''}
          </div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white"><Pips colors={deck.colors} /> <span className="truncate">{deck.name}</span></div>
        </div>
        <div className="text-right">
          <WinLossText r={deck.stats.overall} className="text-[18px] font-bold" />
          {deck.stats.overall.games > 0 && <div className="text-[10px] text-stone-500">{pct(winRate(deck.stats.overall))} over {deck.stats.overall.games} games</div>}
        </div>
        <div className="flex gap-1.5">
          {deck.known && <Button onClick={copy}>Copy for Arena</Button>}
          {deck.known && <Button variant="ghost" onClick={() => setBuying(true)} title="Shopping list for TCGplayer or Card Kingdom">Buy in paper</Button>}
          {deck.source === 'import' && <Button variant="ghost" onClick={rename}>Rename</Button>}
          {deck.source === 'import' && <Button variant="danger" onClick={remove}>Delete</Button>}
        </div>
      </div>

      {buying && <PaperDialog deck={deck} onClose={() => setBuying(false)} />}
      {!deck.known ? (
        <Empty title="Card list not logged yet">
          Arena only writes a deck's cards to its log when you save it, queue with it, or play it. Open "{deck.name}" in Arena's deck builder (or play a game with it) and it will show up here.
        </Empty>
      ) : (
        <div className="@container">
          <div className="grid items-start gap-3 @min-[760px]:grid-cols-[minmax(0,1fr)_250px]">
            <div className="flex min-w-0 flex-col gap-3">
              <Section title={`Deck · ${cardTotal}`}>
                <DeckSummaryBar deck={deck.main} stats={sim.stats} target={target} />
                {deck.commander.length > 0 && <CardGroup title="Commander" cards={deck.commander} collection={deck.collection} />}
                {deck.companions.length > 0 && <CardGroup title="Companion" cards={deck.companions} collection={deck.collection} />}
                <div className="columns-1 gap-4 @min-[460px]:columns-2">
                  <CardGroup title="Creatures" cards={deck.main.filter((c) => isCreature(c) && !isLand(c))} collection={deck.collection} />
                  <CardGroup title="Spells" cards={deck.main.filter((c) => !isCreature(c) && !isLand(c))} collection={deck.collection} />
                  <CardGroup title="Lands" cards={deck.main.filter(isLand)} collection={deck.collection} />
                  {deck.side.length > 0 && <CardGroup title="Sideboard" cards={deck.side} collection={deck.collection} />}
                </div>
              </Section>
              <div className="grid items-start gap-3 @min-[560px]:grid-cols-2">
                <RecordPanel stats={deck.stats} recent={deck.recent} />
                <CollectionPanel check={deck.collection} />
              </div>
              <MetaComparePanel deck={deck} />
              <GuidesPanel deck={deck} onChange={setDeck} />
              {deck.versions.length > 0 && <VersionsPanel versions={deck.versions} />}
              <SampleHand deck={deck.main} />
            </div>
            <aside className="flex flex-col gap-3 @min-[760px]:sticky @min-[760px]:top-0">
              <OpeningHands deck={deck.main} mulliganRate={deck.stats.overall.games ? deck.stats.mulliganRate : null} />
              <SimResults stats={sim.stats} advice={sim.advice} busy={sim.busy} message={sim.message}
                right={<Button variant="ghost" onClick={runSim} disabled={sim.busy || cardTotal < 40}>Rerun</Button>} />
              <DeckStats deck={deck.main} />
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}

function CardGroup({ title, cards, collection }: { title: string; cards: DeckCard[]; collection: CollectionCheck }) {
  const missing = useMemo(() => new Map(collection.cards.map((c) => [c.name, c.missing])), [collection])
  if (!cards.length) return null
  return (
    <div className="mb-3 break-inside-avoid">
      <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">{title} · {cards.reduce((n, c) => n + c.count, 0)}</div>
      {cards.map((c) => <CardLine key={`${title}-${c.grpId}`} card={c} missing={missing.get(c.name) ?? 0} />)}
    </div>
  )
}

function CardLine({ card, missing }: { card: DeckCard; missing: number }) {
  const props = useCardProps(card)
  return (
    <div {...props} className="flex items-center gap-2 rounded px-1 py-[1px] text-[12px] hover:bg-white/5">
      <span className="tabular w-4 text-right text-stone-400">{card.count}</span>
      <span className="h-3.5 w-[3px] shrink-0 rounded-r" style={{ background: identityColor(card) }} />
      <span className="min-w-0 flex-1 truncate text-stone-200">{card.name}</span>
      {missing > 0 && <span className="rounded bg-red-500/15 px-1 text-[10px] text-red-300" title={`${missing} more than you're known to own`}>−{missing}</span>}
      <ManaCost cost={card.manaCost} />
    </div>
  )
}

function OpeningHands({ deck, mulliganRate }: { deck: DeckCard[]; mulliganRate: number | null }) {
  const size = deck.reduce((n, c) => n + c.count, 0)
  const lands = deck.filter(isLand).reduce((n, c) => n + c.count, 0)
  const odds = openingLands(lands, size)
  const keepable = odds.slice(2, 6).reduce((a, b) => a + b, 0)
  const max = Math.max(...odds)
  return (
    <Section id="constructed_opening_hands" title="Opening hands">
      <div className="flex items-end gap-1" style={{ height: 64 }}>
        {odds.map((p, k) => (
          <div key={k} className="flex flex-1 flex-col items-center gap-0.5" title={`${k} lands: ${(p * 100).toFixed(1)}%`}>
            <span className="tabular text-[9px] text-stone-500">{p >= 0.005 ? Math.round(p * 100) : ''}</span>
            <div className={`w-full rounded-t-sm ${k >= 2 && k <= 5 ? 'bg-accent/70' : 'bg-red-400/50'}`} style={{ height: Math.max(p ? 2 : 0, (p / (max || 1)) * 40) }} />
            <span className="text-[10px] text-stone-500">{k}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-0.5 text-[12px]">
        <div className="flex justify-between"><span className="text-stone-400">{lands} lands in {size} cards</span><span className="tabular text-stone-200">{pct(lands / (size || 1))}</span></div>
        <div className="flex justify-between"><span className="text-stone-400">7-card hands with 2–5 lands</span><span className="tabular font-semibold text-stone-100">{pct(keepable)}</span></div>
        {mulliganRate !== null && <div className="flex justify-between"><span className="text-stone-400">Your mulligan rate</span><span className="tabular text-stone-200">{pct(mulliganRate)}</span></div>}
      </div>
    </Section>
  )
}

// ---- versions & sideboard guides ------------------------------------------------

const ANY_OPPONENT = 'Any opponent'
const SPEEDS = ['Aggro', 'Midrange', 'Control', 'Ramp']

function Changes({ ins, outs }: { ins: DeckEntry[]; outs: DeckEntry[] }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {ins.map((c) => <span key={`in-${c.name}`} className="text-emerald-300">+{c.count} {c.name}</span>)}
      {outs.map((c) => <span key={`out-${c.name}`} className="text-red-300">−{c.count} {c.name}</span>)}
    </span>
  )
}

function VersionsPanel({ versions }: { versions: DeckVersion[] }) {
  return (
    <Section id="constructed_versions" title={`Versions · ${versions.length}`}>
      <div className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto text-[12px]">
        {versions.map((v, i) => (
          <div key={`${v.key}-${v.at}`} className="rounded bg-white/[0.03] px-2 py-1">
            <div className="flex items-center gap-2">
              <span className="text-stone-300">{new Date(v.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              {v.current && <span className="rounded bg-accent/20 px-1.5 text-[10px] text-accent">current</span>}
              <span className="text-[11px] text-stone-500">{v.count} cards</span>
              <span className="flex-1" />
              <WinLossText r={v.record} />
            </div>
            {v.added.length + v.removed.length > 0 ? (
              <div className="mt-0.5 text-[11px]"><Changes ins={v.added} outs={v.removed} /></div>
            ) : (
              <div className="mt-0.5 text-[11px] text-stone-500">{i === versions.length - 1 ? 'First tracked list' : 'Same cards, different printings'}</div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-stone-500">A new version is saved whenever the main deck changes in Arena. Game 1s count toward the exact list; sideboarded games count toward the list current at the time.</p>
    </Section>
  )
}

function MetaComparePanel({ deck }: { deck: ConstructedDeck }) {
  const { config } = useApp()
  const enabled = !!config?.settings.meta_enabled
  const [archetype, setArchetype] = useState('')
  const [result, setResult] = useState<MetaCompare | null | undefined>(undefined)
  const listKey = deck.main.map((c) => `${c.grpId}:${c.count}`).join(',')
  useEffect(() => {
    if (!enabled) return
    let alive = true
    api.compareMeta(deck.id, archetype).then((r) => alive && setResult(r.compare ?? null)).catch(() => alive && setResult(null))
    return () => { alive = false }
  }, [enabled, deck.id, archetype, listKey])

  if (!enabled || result === undefined || !deck.metaFormat) return null
  if (!result) {
    return (
      <Section id="constructed_meta" title="Compared with the meta">
        <p className="text-[12px] text-stone-500">No {deck.metaFormat} tournament data downloaded yet. Open Metagame above to get it.</p>
      </Section>
    )
  }
  const { archetype: arch, similarity, missing, extra, nearest } = result
  const changes = nearest ? [...nearest.add, ...nearest.cut].reduce((n, c) => n + c.count, 0) : 0
  return (
    <Section
      id="constructed_meta"
      title="Compared with the meta"
      right={(
        <Select value={arch.id} onChange={(e) => setArchetype(e.target.value)} className="max-w-[200px]" title="Compare with another archetype">
          {result.options.map((o) => <option key={o.id} value={o.id}>{o.name} · {pct(o.similarity)}</option>)}
        </Select>
      )}
    >
      <div className="flex flex-col gap-2 text-[12px]">
        <p className="text-stone-300">
          {pct(similarity)} similar to <span className="font-semibold text-white">{arch.name}</span>
          <span className="text-stone-500"> · {pct(arch.share)} of the {result.format} meta{arch.winRate !== null ? ` · ${pct(arch.winRate)} tournament match wins` : ''}</span>
        </p>
        {similarity < 0.3 && <p className="text-[11px] text-amber-300">Your list doesn't closely match any tournament archetype, so read the differences as ideas rather than fixes.</p>}
        <div className="grid gap-3 @min-[460px]:grid-cols-2">
          <div>
            <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Stock cards you play fewer of</div>
            {missing.length ? missing.map((m) => (
              <div key={m.name} className="flex items-center gap-2" title={`In ${pct(m.inclusion)} of ${arch.name} lists`}>
                <span className="tabular w-8 text-right text-stone-400">{m.have}/{m.typical}</span>
                <span className={`min-w-0 flex-1 truncate ${m.land ? 'text-stone-400' : 'text-stone-200'}`}>{m.name}</span>
                <span className="tabular text-[10px] text-stone-500">{pct(m.inclusion)}</span>
              </div>
            )) : <p className="text-stone-500">You play every core card.</p>}
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Your own picks</div>
            {extra.length ? extra.slice(0, 12).map((x) => (
              <div key={x.name} className="flex items-center gap-2">
                <span className="tabular w-8 text-right text-stone-400">{x.count}</span>
                <span className="min-w-0 flex-1 truncate text-stone-200">{x.name}</span>
                <span className="text-[10px] text-stone-500">{x.inclusion ? pct(x.inclusion) : 'not in lists'}</span>
              </div>
            )) : <p className="text-stone-500">Nothing unusual.</p>}
            {extra.length > 12 && <p className="text-[11px] text-stone-500">and {extra.length - 12} more</p>}
          </div>
        </div>
        {nearest && changes > 0 && (
          <div className="rounded bg-white/[0.03] px-2 py-1.5">
            <div className="text-[11px] text-stone-400">
              Closest list: {nearest.player || 'unknown player'} · {nearest.event}{nearest.date ? ` · ${shortDate(nearest.date)}` : ''}.
              {changes <= 30 ? ' To match it:' : ` It differs from yours by ${changes} cards.`}
            </div>
            {changes <= 30 && <div className="mt-0.5 text-[11px]"><Changes ins={nearest.add} outs={nearest.cut} /></div>}
          </div>
        )}
      </div>
    </Section>
  )
}

function GuidesPanel({ deck, onChange }: { deck: ConstructedDeck; onChange: (d: ConstructedDeck) => void }) {
  const { toast } = useApp()
  const [editing, setEditing] = useState<SideboardGuide | null>(null)
  const saved = new Set(deck.guides.map((g) => g.key))
  const suggestions = deck.sideboardHistory.filter((s) => !saved.has(s.key))
  const remove = (key: string) => {
    if (!window.confirm(`Delete the sideboard plan for "${key}"?`)) return
    api.deleteGuide(deck.id, key).then(onChange).catch((e) => toast((e as Error).message, 'error'))
  }
  if (editing) {
    return <GuideEditor deck={deck} guide={editing} onCancel={() => setEditing(null)} onSaved={(d) => { onChange(d); setEditing(null) }} />
  }
  return (
    <Section
      id="constructed_guides"
      title="Sideboard guides"
      right={<Button variant="ghost" onClick={() => setEditing({ key: '', in: [], out: [], note: '' })}>+ New plan</Button>}
    >
      <div className="flex flex-col gap-2 text-[12px]">
        {deck.guides.length === 0 && (
          <p className="text-stone-500">
            Save what to bring in and take out against each kind of opponent. The matching plan shows up on the Game tab when Arena asks you to sideboard, and during games 2 and 3.
          </p>
        )}
        {deck.guides.map((g) => (
          <div key={g.key} className="rounded bg-white/[0.03] px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-stone-100">vs {g.key}</span>
              <span className="flex-1" />
              <button className="text-[11px] text-stone-400 hover:text-stone-100" onClick={() => setEditing(g)}>Edit</button>
              <button className="text-[11px] text-stone-500 hover:text-red-300" onClick={() => remove(g.key)}>Delete</button>
            </div>
            {g.in.length + g.out.length > 0 && <div className="mt-0.5"><Changes ins={g.in} outs={g.out} /></div>}
            {g.note && <div className="mt-0.5 whitespace-pre-wrap text-stone-400">{g.note}</div>}
          </div>
        ))}
        {suggestions.length > 0 && (
          <div>
            <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">How you've sideboarded before</div>
            {suggestions.slice(0, 5).map((s) => (
              <div key={s.key} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-white/5">
                <div className="min-w-0 flex-1">
                  <span className="text-stone-300">vs {s.key}</span>
                  <span className="ml-1.5 text-[11px] text-stone-500">{s.games} game{s.games === 1 ? '' : 's'} · <WinLossText r={s} /></span>
                  <div className="text-[11px]"><Changes ins={s.in} outs={s.out} /></div>
                </div>
                <button className="shrink-0 text-[11px] text-accent hover:underline" onClick={() => setEditing({ key: s.key, in: s.in, out: s.out, note: '' })}>Save as plan</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

function GuideEditor({ deck, guide, onCancel, onSaved }: { deck: ConstructedDeck; guide: SideboardGuide; onCancel: () => void; onSaved: (d: ConstructedDeck) => void }) {
  const { toast } = useApp()
  const [key, setKey] = useState(guide.key)
  const [ins, setIns] = useState(() => new Map(guide.in.map((c) => [c.name, c.count])))
  const [outs, setOuts] = useState(() => new Map(guide.out.map((c) => [c.name, c.count])))
  const [note, setNote] = useState(guide.note)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    markEditing('guide', true)
    return () => { markEditing('guide', false) }
  }, [])
  const options = useMemo(() => {
    const faced = [...deck.stats.byOpponent.map((r) => r.key), ...deck.sideboardHistory.map((s) => s.key)].filter((k) => k && k !== 'Unknown')
    return [...new Set([ANY_OPPONENT, ...SPEEDS, ...faced, ...deck.metaArchetypes])]
  }, [deck])
  // A saved plan can name cards the list no longer has; those can't be seen or edited, so they don't count.
  const rows = (m: Map<string, number>, cards: DeckCard[]) => cards
    .map((c) => ({ name: c.name, count: Math.min(m.get(c.name) ?? 0, c.count) }))
    .filter((r) => r.count > 0)
  const inRows = rows(ins, deck.side)
  const outRows = rows(outs, deck.main)
  const totalIn = inRows.reduce((a, r) => a + r.count, 0)
  const totalOut = outRows.reduce((a, r) => a + r.count, 0)
  const clash = deck.guides.find((g) => g.key !== guide.key && g.key.toLowerCase() === key.trim().toLowerCase())
  const save = () => {
    setBusy(true)
    api.saveGuide(deck.id, key.trim(), inRows, outRows, note, guide.key)
      .then(onSaved)
      .catch((e) => toast((e as Error).message, 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <Section title={guide.key ? `Sideboard plan · vs ${guide.key}` : 'New sideboard plan'}>
      <div className="flex flex-col gap-2 text-[12px]">
        <label className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-stone-400">Against</span>
          <Input list="guide-opponents" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. Mono-Red Aggro, Control, Any opponent" className="flex-1" />
          <datalist id="guide-opponents">{options.map((o) => <option key={o} value={o} />)}</datalist>
        </label>
        {clash && <p className="text-[11px] text-amber-300">Saving replaces your existing plan vs {clash.key}.</p>}
        <p className="text-[10px] text-stone-500">
          During a match the most specific plan wins: the exact archetype ("Rakdos Aggro"), then its colors ("Rakdos"), then its style ("Aggro"), then "{ANY_OPPONENT}".
          {deck.metaArchetypes.length > 0 && ` Tournament archetypes from the ${deck.metaFormat} metagame are in the list too.`}
        </p>
        <div className="grid gap-3 @min-[460px]:grid-cols-2">
          <PlanColumn title={`Bring in · ${totalIn}`} cards={deck.side} counts={ins} onChange={setIns} tone="text-emerald-300"
            empty="This list has no sideboard." />
          <PlanColumn title={`Take out · ${totalOut}`} cards={deck.main} counts={outs} onChange={setOuts} tone="text-red-300" empty="" />
        </div>
        {totalIn !== totalOut && <p className="text-[11px] text-amber-300">Bringing in {totalIn} and taking out {totalOut}: your deck size will change.</p>}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Notes: what matters in this matchup, when to keep a hand, play/draw differences…"
          className="h-16 w-full resize-y rounded bg-black/30 px-2 py-1 text-[12px] text-stone-200 ring-1 ring-line outline-none focus:ring-accent/60"
        />
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={save} disabled={busy || !key.trim()}>{busy ? 'Saving…' : 'Save plan'}</Button>
        </div>
      </div>
    </Section>
  )
}

function PlanColumn({ title, cards, counts, onChange, tone, empty }: {
  title: string; cards: DeckCard[]; counts: Map<string, number>; onChange: (m: Map<string, number>) => void; tone: string; empty: string
}) {
  const set = (name: string, n: number) => onChange(new Map(counts).set(name, n))
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">{title}</div>
      {!cards.length && <p className="text-stone-500">{empty}</p>}
      <div className="flex max-h-[260px] flex-col overflow-y-auto">
        {cards.map((c) => {
          const n = counts.get(c.name) ?? 0
          return (
            <div key={c.name} className="flex items-center gap-2 rounded px-1 py-[1px] hover:bg-white/5">
              <span className="min-w-0 flex-1 truncate text-stone-200">{c.name}</span>
              <span className="text-[10px] text-stone-500">of {c.count}</span>
              <button className="size-5 rounded bg-white/5 text-stone-300 hover:bg-white/10 disabled:opacity-30" disabled={n <= 0} onClick={() => set(c.name, n - 1)}>−</button>
              <span className={`tabular w-4 text-center ${n ? tone : 'text-stone-600'}`}>{n}</span>
              <button className="size-5 rounded bg-white/5 text-stone-300 hover:bg-white/10 disabled:opacity-30" disabled={n >= c.count} onClick={() => set(c.name, n + 1)}>+</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecordPanel({ stats, recent }: { stats: RecordBreakdown; recent: ConstructedDeck['recent'] }) {
  if (!stats.overall.games) {
    return <Section title="Record"><p className="text-[12px] text-stone-500">No games recorded with this deck yet. Games are tracked automatically while the overlay is running.</p></Section>
  }
  return (
    <Section id="constructed_record" title="Record">
      <div className="flex flex-col gap-2 text-[12px]">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded bg-white/[0.03] px-2 py-1"><div className="text-[10px] text-stone-500 uppercase">On the play</div><WinLossText r={stats.onPlay} className="font-semibold" /></div>
          <div className="rounded bg-white/[0.03] px-2 py-1"><div className="text-[10px] text-stone-500 uppercase">On the draw</div><WinLossText r={stats.onDraw} className="font-semibold" /></div>
        </div>
        <Breakdown title="Against" rows={stats.byOpponent.slice(0, 6)} />
        {stats.byEvent.length > 1 && <Breakdown title="By event" rows={stats.byEvent.map((r) => ({ ...r, label: eventLabel(r.key) }))} />}
        <div>
          <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Recent</div>
          <div className="flex flex-wrap gap-1">
            {recent.map((g) => (
              <span key={g.id} title={`${g.result} vs ${g.opponent || 'unknown'} · ${g.onPlay ? 'play' : 'draw'} · ${new Date(g.time).toLocaleString()}`}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${RESULT_TONE[g.result] ?? RESULT_TONE.loss}`}>
                {g.result === 'win' ? 'W' : g.result === 'draw' ? 'D' : 'L'} <Pips colors={g.colors} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}

function CollectionPanel({ check }: { check: CollectionCheck }) {
  const total = WILDCARDS.reduce((n, r) => n + (check.wildcards[r] ?? 0), 0)
  return (
    <Section id="constructed_collection" title="Collection">
      {total === 0 ? (
        <p className="text-[12px] text-emerald-300">You own everything in this list.</p>
      ) : (
        <div className="flex flex-col gap-2 text-[12px]">
          <WildcardCost check={check} />
          <div className="flex max-h-[180px] flex-col overflow-y-auto">
            {check.cards.map((c) => (
              <div key={c.name} className="flex items-center gap-2">
                <span className="tabular w-6 text-right text-red-300">{c.missing}×</span>
                <span className="min-w-0 flex-1 truncate text-stone-200">{c.name}</span>
                <span className={`text-[10px] ${RARITY_TONE[c.rarity] ?? 'text-stone-400'}`}>{c.rarity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] text-stone-500">Ownership is inferred from decks you've queued or played with, so cards you own but haven't played yet can show as missing.</p>
    </Section>
  )
}

function WildcardCost({ check }: { check: CollectionCheck }) {
  return (
    <div className="grid grid-cols-4 gap-1 text-center">
      {WILDCARDS.map((r) => {
        const need = check.wildcards[r] ?? 0
        const have = check.balance[r]
        const short = have !== undefined && need > have
        return (
          <div key={r} className="rounded bg-white/[0.03] py-1">
            <div className={`text-[10px] capitalize ${RARITY_TONE[r]}`}>{r}</div>
            <div className={`tabular text-[13px] font-semibold ${short ? 'text-red-300' : need ? 'text-white' : 'text-stone-600'}`}>{need}</div>
            {have !== undefined && <div className="tabular text-[9px] text-stone-500">have {have}</div>}
          </div>
        )
      })}
    </div>
  )
}

function PaperDialog({ deck, onClose }: { deck: ConstructedDeck; onClose: () => void }) {
  const { toast } = useApp()
  const [sideboard, setSideboard] = useState(true)
  const [basics, setBasics] = useState(false)
  const [list, setList] = useState<PaperList | null>(null)

  useEffect(() => {
    api.paperList(deck.id, sideboard, basics).then(setList).catch((e) => toast((e as Error).message, 'error'))
  }, [deck.id, sideboard, basics, toast])

  const total = list?.cards.reduce((n, c) => n + c.count, 0) ?? 0
  const copy = async (then?: string) => {
    if (!list) return
    await copyText(list.text)
    toast(then ? 'List copied. Paste it into the deck builder on Card Kingdom.' : 'Shopping list copied', 'success')
    if (then) api.openUrl(then)
  }

  return (
    <Modal
      title={`Buy ${deck.name} in paper`}
      onClose={onClose}
      width="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={() => copy()} disabled={!total}>Copy list</Button>
          <div className="flex-1" />
          <Button onClick={() => list && copy(list.cardKingdomUrl)} disabled={!total} title="Copies the list and opens Card Kingdom's deck builder">Card Kingdom</Button>
          <Button variant="primary" onClick={() => list && api.openUrl(list.tcgplayerUrl)} disabled={!total} title="Opens TCGplayer's mass entry with the list filled in">TCGplayer</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-2 text-[12px]">
        <div className="flex flex-wrap gap-x-4">
          <Check checked={sideboard} onChange={setSideboard} label="Include the sideboard" />
          <Check checked={basics} onChange={setBasics} label={`Include basic lands${list?.basics ? ` (${list.basics})` : ''}`} />
        </div>
        {!list ? <Spinner /> : (
          <>
            <textarea readOnly value={list.text} className="h-48 resize-none rounded-md bg-white/[0.06] p-2 font-mono text-[11px] text-stone-100 outline-none" />
            <p className="text-[11px] text-stone-500">{total} cards, without set codes, so the store offers its own printings and prices.</p>
            {list.rebalanced.length > 0 && (
              <p className="text-[11px] text-stone-400">Rebalanced Alchemy cards are listed as their paper originals: {list.rebalanced.join(', ')}.</p>
            )}
            {list.digital.length > 0 && (
              <p className="text-[11px] text-amber-300">
                Arena-only, no paper version: {list.digital.map((c) => `${c.count} ${c.name}`).join(', ')}. Pick paper replacements for these.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function ImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (deck: ConstructedDeck) => void }) {
  const { toast } = useApp()
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'check'>('')
  const [check, setCheck] = useState<CollectionCheck | null>(null)

  const run = async (kind: 'save' | 'check') => {
    setBusy(kind)
    try {
      if (kind === 'save') {
        const deck = await api.importDeck(text, name)
        if (deck.unknown?.length) toast(`Skipped ${deck.unknown.length} unrecognised line(s): ${deck.unknown.slice(0, 3).join(', ')}`, 'error')
        onSaved(deck)
      } else {
        setCheck(await api.checkCollection(text))
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal
      title="Import a deck list"
      onClose={onClose}
      width="max-w-lg"
      footer={(
        <>
          <Button variant="ghost" onClick={async () => { setText(await readClipboard()); setCheck(null) }}>Paste from clipboard</Button>
          <div className="flex-1" />
          <Button onClick={() => run('check')} busy={busy === 'check'} disabled={!text.trim()}>Check collection</Button>
          <Button variant="primary" onClick={() => run('save')} busy={busy === 'save'} disabled={!text.trim()}>Save deck</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deck name (optional)" />
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setCheck(null) }}
          placeholder={'Deck\n4 Llanowar Elves (FDN) 227\n4 Sheoldred, the Apocalypse\n...\n\nSideboard\n2 Duress'}
          className="h-56 resize-none rounded-md bg-white/[0.06] p-2 font-mono text-[11px] text-stone-100 outline-none placeholder:text-stone-600 focus:ring-1 focus:ring-accent/60"
        />
        <p className="text-[11px] text-stone-500">Arena, MTGO and most deck sites' text exports work. Save it to track stats and simulate it, or just check what you'd need to craft.</p>
        {check && (
          <div className="flex flex-col gap-2 rounded-md bg-white/[0.03] p-2 text-[12px]">
            {check.cards.length ? (
              <>
                <WildcardCost check={check} />
                <div className="max-h-32 overflow-y-auto">
                  {check.cards.map((c) => <div key={c.name} className="flex justify-between"><span className="text-stone-300">{c.missing}× {c.name}</span><span className={`text-[10px] ${RARITY_TONE[c.rarity] ?? ''}`}>{c.rarity}</span></div>)}
                </div>
                {check.affordable !== null && <div className={check.affordable ? 'text-emerald-300' : 'text-amber-300'}>{check.affordable ? 'You have enough wildcards to craft the rest.' : 'Not enough wildcards to craft everything yet.'}</div>}
              </>
            ) : <div className="text-emerald-300">You own everything in this list.</div>}
            {!!check.unknown?.length && <div className="text-[11px] text-amber-300">Unrecognised: {check.unknown.join(', ')}</div>}
          </div>
        )}
      </div>
    </Modal>
  )
}
