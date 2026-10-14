import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import type { CollectionCheck, ConstructedDeck, ConstructedDeckSummary, DeckCard, RecordBreakdown, SimStats, WinLoss } from '../types'
import { identityColor, isCreature, isLand } from '../lib/cards'
import { openingLands } from '../lib/deck'
import { eventLabel } from '../lib/game'
import { copyText, readClipboard } from '../lib/platform'
import { useCardProps } from '../components/cardInteractions'
import { ManaCost } from '../components/ManaCost'
import { DeckStats, DeckSummaryBar, SampleHand, SimResults } from '../components/DeckPanels'
import { Button, Check, Empty, Input, Modal, Section, Select, Spinner } from '../components/primitives'
import { Breakdown, Pips, WinLossText } from '../components/Records'

type DeckList = Awaited<ReturnType<typeof api.constructedDecks>>

const pct = (v: number) => `${Math.round(v * 100)}%`
const winRate = (r: WinLoss) => (r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0)
const RARITY_TONE: Record<string, string> = { common: 'text-stone-300', uncommon: 'text-sky-200', rare: 'text-amber-300', mythic: 'text-orange-400' }
const WILDCARDS = ['common', 'uncommon', 'rare', 'mythic'] as const

export function ConstructedView() {
  const { decksVersion, toast } = useApp()
  const [list, setList] = useState<DeckList | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelectedState] = useState<string | null>(() => localStorage.getItem('constructed-deck'))
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState('')
  const [showUnknown, setShowUnknown] = useState(false)
  const [importing, setImporting] = useState(false)

  const setSelected = (id: string | null) => {
    if (id) localStorage.setItem('constructed-deck', id)
    else localStorage.removeItem('constructed-deck')
    setSelectedState(id)
  }

  useEffect(() => {
    api.constructedDecks().then((l) => { setList(l); setError('') }).catch((e) => setError((e as Error).message))
  }, [decksVersion])

  const formats = useMemo(() => [...new Set((list?.decks ?? []).map((d) => d.format).filter(Boolean))].sort(), [list])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list?.decks ?? []).filter((d) =>
      (showUnknown || d.known) && (!format || d.format === format) && (!q || d.name.toLowerCase().includes(q)))
  }, [list, query, format, showUnknown])

  if (error && !list) return <Empty title="Constructed decks unavailable">{error}</Empty>
  if (!list) return <Empty title={<span className="flex items-center gap-2"><Spinner /> Loading decks…</span>} />

  const current = list.decks.find((d) => d.id === selected) ?? visible[0] ?? null
  const unknownCount = list.decks.filter((d) => !d.known).length

  return (
    <div className="@container">
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
            <DeckDetail key={current.id} summary={current} onDeleted={() => setSelected(null)} />
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
          onSaved={(d) => { setImporting(false); setSelected(d.id); toast(`Imported ${d.name}`, 'success') }}
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

function DeckDetail({ summary, onDeleted }: { summary: ConstructedDeckSummary; onDeleted: () => void }) {
  const { decksVersion, toast } = useApp()
  const [deck, setDeck] = useState<ConstructedDeck | null>(null)
  const [sim, setSim] = useState<{ stats: SimStats | null; advice: string[]; busy: boolean; message?: string }>({ stats: null, advice: [], busy: false })

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
    const name = window.prompt('Deck name', deck.name)
    if (name && name !== deck.name) setDeck(await api.renameDeck(deck.id, name))
  }
  const remove = async () => {
    if (!window.confirm(`Delete the imported deck "${deck.name}"?`)) return
    await api.deleteDeck(deck.id)
    onDeleted()
  }
  const target = deck.commander.length ? 100 : 60

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-panel px-4 py-3">
        {deck.tileImage && <img src={deck.tileImage} alt="" className="h-12 w-[34px] shrink-0 rounded object-cover ring-1 ring-black/40" />}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wider text-stone-500 uppercase">
            {deck.format || 'Constructed'}{deck.source === 'import' ? ' · imported' : ''}{deck.lastPlayed ? ` · played ${new Date(deck.lastPlayed).toLocaleDateString()}` : ''}
          </div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white"><Pips colors={deck.colors} /> <span className="truncate">{deck.name}</span></div>
        </div>
        <div className="text-right">
          <WinLossText r={deck.stats.overall} className="text-[18px] font-bold" />
          {deck.stats.overall.games > 0 && <div className="text-[10px] text-stone-500">{pct(winRate(deck.stats.overall))} over {deck.stats.overall.games} games</div>}
        </div>
        <div className="flex gap-1.5">
          {deck.known && <Button onClick={copy}>Copy for Arena</Button>}
          {deck.source === 'import' && <Button variant="ghost" onClick={rename}>Rename</Button>}
          {deck.source === 'import' && <Button variant="danger" onClick={remove}>Delete</Button>}
        </div>
      </div>

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
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${g.result === 'win' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                {g.result === 'win' ? 'W' : 'L'} <Pips colors={g.colors} />
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
          <Button variant="ghost" onClick={async () => setText(await readClipboard())}>Paste from clipboard</Button>
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
