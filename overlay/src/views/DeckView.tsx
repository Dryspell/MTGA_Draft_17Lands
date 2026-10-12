import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import type { Card, DeckVariant, DeckView as DeckAnalysis, SealedState } from '../types'
import { BASIC_LANDS, COLORS, COLOR_VAR, basicCard, cardColors, isCreature, isLand } from '../lib/cards'
import { count, entries } from '../lib/deck'
import { startCardDrag, type DraggedCard } from '../lib/drag'
import { usePileLayout } from '../lib/piles'
import { copyText, openUrl, readClipboard } from '../lib/platform'
import { CardTable } from '../components/CardTable'
import { CardPiles, DropZone } from '../components/CardPiles'
import { DeckStats, SampleHand, SimResults } from '../components/DeckPanels'
import { Button, Check, Empty, Progress, Section, Segmented } from '../components/primitives'
import { PracticeDialog } from '../components/TopBar'

type Filters = Record<'creatures' | 'spells' | 'lands' | 'W' | 'U' | 'B' | 'R' | 'G' | 'C', boolean>
type Sim = { view: DeckAnalysis | null; busy: boolean; message: string }
const IDLE: Sim = { view: null, busy: false, message: '' }

/** "UR Safe Tempo [Est: 6-3] (Power: 84)" -> "UR Safe Tempo" */
const buildName = (label: string) => label.replace(/\s*[[(].*$/, '').trim() || label

/** One workspace for the drafted (or practice sealed) pool: saved builds, suggestions, and the deck itself. */
export function DeckView() {
  const { snapshot, toast } = useApp()
  const { sealedId, setSealedId } = useUi()
  const [loaded, setLoaded] = useState<{ source: string; session: SealedState } | null>(null)
  const [practice, setPractice] = useState<null | 'generate' | 'import'>(null)
  const source = sealedId ?? 'live'
  const session = loaded?.source === source ? loaded.session : null
  const draftId = snapshot?.draftId
  const poolSize = snapshot?.poolSize ?? 0

  useEffect(() => {
    if (sealedId) {
      api.sealed(sealedId).then((s) => setLoaded({ source: sealedId, session: s })).catch(() => setSealedId(null))
    } else if (poolSize) {
      api.liveSealed().then((s) => setLoaded({ source: 'live', session: s })).catch((e) => toast(e.message, 'error'))
    }
  }, [sealedId, setSealedId, draftId, poolSize, toast])

  const update = useCallback((s: SealedState) => setLoaded({ source, session: s }), [source])

  if (!session) {
    return (
      <Empty
        title={sealedId || poolSize ? 'Loading pool…' : 'No cards yet'}
        action={
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button onClick={() => setPractice('generate')}>Generate practice sealed pool</Button>
            <Button onClick={() => setPractice('import')}>Import pool from clipboard</Button>
            {practice && <PracticeDialog mode={practice} onClose={() => setPractice(null)} />}
          </div>
        }
      >
        {!sealedId && !poolSize && 'Draft some cards and build your deck here, or practice with a sealed pool.'}
      </Empty>
    )
  }
  return <Workspace key={session.id} session={session} update={update} live={!sealedId} />
}

function Workspace({ session, update, live }: { session: SealedState; update: (s: SealedState) => void; live: boolean }) {
  const { runJob, toast } = useApp()
  const { setSealedId } = useUi()
  const [view, setView] = useState<'visual' | 'list'>('visual')
  const [busy, setBusy] = useState('')
  const [sim, setSim] = useState<Sim>(IDLE)
  const [practice, setPractice] = useState<null | 'generate' | 'import'>(null)
  const [filters, setFilters] = useState<Filters>({ creatures: true, spells: true, lands: true, W: true, U: true, B: true, R: true, G: true, C: true })
  const layout = usePileLayout(`${session.id}:${session.active}`)

  const pool = useMemo(() => session.sideboard.filter((c) => {
    const typeOk = isLand(c) ? filters.lands : isCreature(c) ? filters.creatures : filters.spells
    const colors = cardColors(c)
    return typeOk && (colors.length ? colors.some((col) => filters[col as 'W']) : filters.C)
  }), [session.sideboard, filters])

  const act = async (body: Parameters<typeof api.sealedAction>[1]) => {
    try {
      const next = await api.sealedAction(session.id, body)
      update(next)
      if (next.warning) toast(next.warning, 'error')
      return next
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const toMain = (c: Card) => act({ op: 'main', card: c.name })
  const toSide = (c: Card) => act({ op: 'side', card: c.name })
  const find = (name: string) => session.main.find((c) => c.name === name) ?? session.sideboard.find((c) => c.name === name) ?? (name in BASIC_LANDS ? basicCard(name) : null)

  const dropOnDeck = (d: DraggedCard, pile?: string) => {
    const card = find(d.name)
    if (card && pile) layout.place(card, pile)
    if (d.from !== 'deck') act({ op: 'main', card: d.name })
  }
  const dropOnPool = (d: DraggedCard) => { if (d.from === 'deck') act({ op: 'side', card: d.name }) }

  const deckBody = () => ({ deck: entries(session.main), sideboard: entries(session.sideboard) })
  const total = count(session.main)

  const runSim = async (kind: 'analyze' | 'optimize') => {
    if (kind === 'optimize' && total !== 40) return toast(`The deck must be exactly 40 cards to optimize (currently ${total}).`, 'error')
    setSim({ ...IDLE, busy: true, message: kind === 'analyze' ? 'Running 10,000 Monte Carlo simulations…' : 'AI auto-optimizing: simulating thousands of deck permutations…' })
    try {
      const start = kind === 'analyze' ? api.analyzeDeck(deckBody()) : api.optimizeDeck(deckBody())
      const v = await runJob<DeckAnalysis>(start, (j) => j.message && setSim((s) => ({ ...s, message: j.message })))
      if (kind === 'optimize') await act({ op: 'set', cards: entries(v.deck) })
      setSim({ view: v, busy: false, message: '' })
    } catch (e) {
      setSim({ ...IDLE, message: (e as Error).message })
    }
  }

  const exportTo = async (target: 'mtga' | 'sealeddeck') => {
    setBusy(target === 'sealeddeck' ? 'Exporting to sealeddeck.tech…' : '')
    try {
      const res = await api.sealedExport(session.id, target)
      if (target === 'sealeddeck' && res.url) await openUrl(res.url)
      else {
        await copyText(res.text)
        toast(res.error ?? 'Deck copied to clipboard in MTGA format', res.error ? 'error' : 'success')
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  const exportPool = async () => {
    const counts = new Map<string, number>()
    for (const c of [...session.main, ...session.sideboard]) if (!(c.name in BASIC_LANDS)) counts.set(c.name, (counts.get(c.name) ?? 0) + c.count)
    const { text } = await api.exportDeck({ deck: [...counts].map(([name, n]) => ({ name, count: n })) })
    await copyText(text)
    toast('Pool copied to clipboard', 'success')
  }

  const rename = () => {
    const name = window.prompt('Rename build', session.active)?.trim()
    if (name && name !== session.active) act({ op: 'rename', name: session.active, new_name: name })
  }
  const select = (name: string) => { setSim(IDLE); act({ op: 'select', name }) }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-semibold text-white">{session.label}</span>
        <span className="text-[11px] text-stone-500">{session.poolSize} card pool</span>
        <div className="flex-1" />
        {!live && <Button variant="ghost" onClick={() => setSealedId(null)}>Back to draft pool</Button>}
        <Button variant="ghost" onClick={() => setPractice('generate')}>Practice sealed</Button>
        <Button variant="ghost" onClick={() => setPractice('import')}>Import pool</Button>
        {practice && <PracticeDialog mode={practice} onClose={() => setPractice(null)} />}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] font-semibold tracking-wider text-stone-500 uppercase">Builds</span>
        {session.variants.map((v) => (
          <button
            key={v}
            onClick={() => v !== session.active && select(v)}
            onDoubleClick={rename}
            className={`rounded-md px-2.5 py-1 text-[12px] ${v === session.active ? 'bg-accent/20 text-white ring-1 ring-accent/50' : 'bg-white/5 text-stone-400 hover:text-white'}`}
            title="Double-click to rename"
          >
            {v}
          </button>
        ))}
        <Button variant="ghost" onClick={() => act({ op: 'create' })}>+ New</Button>
        <Button variant="ghost" onClick={() => act({ op: 'copy' })}>Duplicate</Button>
        <Button variant="ghost" onClick={rename}>Rename</Button>
        <Button variant="ghost" onClick={() => act({ op: 'delete' })} disabled={session.variants.length < 2}>Delete</Button>
      </div>

      <Suggestions session={session} live={live} act={act} update={update} />

      <div className="flex flex-wrap items-center gap-1.5">
        <Button onClick={() => act({ op: 'auto-lands' })} title="Fill the rest of the deck with the best basic land split">Auto-lands</Button>
        <Button onClick={() => runSim('analyze')} disabled={!total || sim.busy}>Analyze</Button>
        <Button onClick={() => runSim('optimize')} disabled={sim.busy}>Auto-optimize</Button>
        <Button onClick={() => exportTo('mtga')} disabled={!total}>Copy deck</Button>
        <Button onClick={() => exportTo('sealeddeck')} busy={busy.startsWith('Exporting')} disabled={!total}>sealeddeck.tech</Button>
        <Button onClick={async () => act({ op: 'import', text: await readClipboard() })} title="Replace this build with a deck list from the clipboard">Import deck</Button>
        <Button onClick={() => exportPool().catch((e) => toast(e.message, 'error'))}>Export pool</Button>
        <Button variant="ghost" onClick={() => act({ op: 'clear' })} disabled={!total}>Clear</Button>
        <div className="flex-1" />
        <Segmented value={view} onChange={setView} options={[{ value: 'visual', label: 'Visual' }, { value: 'list', label: 'List' }]} />
      </div>
      {busy && <Progress value={null} message={busy} />}

      <BasicsBar main={session.main} add={(name) => act({ op: 'main', card: name })} remove={(name) => act({ op: 'side', card: name })} />

      <div className={view === 'list' ? 'grid gap-3 lg:grid-cols-2' : 'flex flex-col gap-3'}>
        <Section
          title={`${session.active} · deck (${total}/40)`}
          right={
            <span className="flex items-center gap-2 text-[10px] text-stone-500">
              {view === 'visual' && layout.custom && <button onClick={layout.reset} className="text-accent hover:underline">Reset piles</button>}
              drag or click cards to move them
            </span>
          }
        >
          <DropZone onDrop={(d) => dropOnDeck(d)} className="-m-1 p-1">
            {view === 'visual' ? (
              <CardPiles cards={session.main} zone="deck" pileOf={layout.pileOf} showEmpty onCardClick={toSide} onDropToPile={dropOnDeck} />
            ) : (
              <CardTable
                viewId="sealed_deck_table"
                cards={session.main}
                extraFields={['cmc']}
                onRowClick={toSide}
                onRowDragStart={(c, e) => startCardDrag(e, { name: c.name, from: 'deck' })}
                empty={<div className="py-6 text-center text-[12px] text-stone-500">Drag cards here from your pool.</div>}
              />
            )}
          </DropZone>
        </Section>

        <Section title={`Pool / sideboard (${count(session.sideboard)})`}>
          <PoolFilters filters={filters} onChange={setFilters} />
          <DropZone onDrop={dropOnPool} className="-m-1 p-1">
            {view === 'visual' ? (
              pool.length ? <CardPiles cards={pool} zone="pool" onCardClick={toMain} /> : <div className="py-6 text-center text-[12px] text-stone-500">Drag cards here to take them out of the deck.</div>
            ) : (
              <CardTable
                viewId="sealed_pool_table"
                cards={pool}
                extraFields={['cmc']}
                onRowClick={toMain}
                onRowDragStart={(c, e) => startCardDrag(e, { name: c.name, from: 'pool' })}
              />
            )}
          </DropZone>
        </Section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DeckStats deck={session.main} />
        <SimResults stats={sim.view?.stats ?? null} note={sim.view?.note} advice={sim.view?.advice} busy={sim.busy} message={sim.message || 'Press Analyze to simulate this build.'} />
      </div>
      {total > 0 && <SampleHand deck={session.main} />}
    </div>
  )
}

function BasicsBar({ main, add, remove }: { main: Card[]; add: (name: string) => void; remove: (name: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel px-3 py-2">
      <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase" title="Drag a land into the deck, or use − / +">Basics</span>
      {Object.entries(BASIC_LANDS).map(([name, color]) => {
        const n = main.find((c) => c.name === name)?.count ?? 0
        return (
          <div
            key={name}
            draggable
            onDragStart={(e) => startCardDrag(e, { name, from: 'basic' })}
            className="flex cursor-grab items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 active:cursor-grabbing"
            title={`Drag ${name} into the deck`}
          >
            <span className="size-2.5 rounded-full" style={{ background: COLOR_VAR[color] }} />
            <button onClick={() => remove(name)} className="px-1 text-stone-400 hover:text-white disabled:opacity-30" disabled={!n}>−</button>
            <span className="tabular w-4 text-center text-[12px]">{n}</span>
            <button onClick={() => add(name)} className="px-1 text-stone-400 hover:text-white">+</button>
          </div>
        )
      })}
    </div>
  )
}

function PoolFilters({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2">
      {(['creatures', 'spells', 'lands'] as const).map((k) => (
        <Check key={k} checked={filters[k]} onChange={(v) => onChange({ ...filters, [k]: v })} label={k[0].toUpperCase() + k.slice(1)} />
      ))}
      <span className="mx-1 h-4 w-px bg-line" />
      {[...COLORS, 'C' as const].map((c) => (
        <button
          key={c}
          onClick={() => onChange({ ...filters, [c]: !filters[c] })}
          className={`size-5 rounded-full ring-1 ring-black/40 ${filters[c] ? '' : 'opacity-25'}`}
          style={{ background: COLOR_VAR[c] }}
          title={c === 'C' ? 'Colorless' : c}
        />
      ))}
    </div>
  )
}

/** AI-suggested decks: the live builder for draft pools, sealed shells for practice pools. */
function Suggestions({ session, live, act, update }: {
  session: SealedState
  live: boolean
  act: (body: Parameters<typeof api.sealedAction>[1]) => Promise<SealedState | undefined>
  update: (s: SealedState) => void
}) {
  const { snapshot, runJob, toast } = useApp()
  const { builder, setBuilder } = useUi()
  const [preview, setPreview] = useState<string | null>(null)
  const [shellsBusy, setShellsBusy] = useState(false)
  const spells = [...session.main, ...session.sideboard].filter((c) => !isLand(c)).reduce((n, c) => n + c.count, 0)
  const poolKey = `${snapshot?.draftId}:${snapshot?.poolSize}`

  const build = useCallback(async () => {
    setBuilder({ running: true, variants: [], selected: null, message: 'Initializing AI builder…', error: '', builtFor: poolKey })
    const found: DeckVariant[] = []
    try {
      const result = await runJob<{ variants: DeckVariant[] }>(api.suggestDeck(), (job) => {
        const variant = job.data?.variant as DeckVariant | undefined
        if (variant) {
          found.push(variant)
          setBuilder({ variants: [...found] })
        } else if (job.message) setBuilder({ message: job.message })
      })
      setBuilder({ variants: result.variants, running: false })
    } catch (e) {
      setBuilder({ running: false, error: (e as Error).message })
    }
  }, [runJob, setBuilder, poolKey])

  useEffect(() => {
    if (live && spells >= 22 && !builder.running && builder.builtFor !== poolKey) build()
  }, [live, spells, builder.running, builder.builtFor, poolKey, build])

  const shells = async () => {
    setShellsBusy(true)
    try {
      update(await runJob<SealedState>(api.sealedShells(session.id)))
      toast('Added suggested shells to your builds', 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setShellsBusy(false)
    }
  }

  if (!live) {
    return (
      <Section id="deck_suggestions" title="Suggested builds" right={<Button onClick={shells} busy={shellsBusy}>Generate shells</Button>}>
        <p className="text-[12px] text-stone-500">Builds a deck shell for each strong color pair in this pool and adds them to your builds.</p>
      </Section>
    )
  }

  return (
    <Section
      id="deck_suggestions"
      title={`Suggested builds${builder.variants.length ? ` (${builder.variants.length})` : ''}`}
      right={<Button variant="ghost" onClick={build} busy={builder.running} disabled={spells < 22}>Rebuild</Button>}
    >
      {spells < 22 && !builder.variants.length && <p className="text-[12px] text-stone-500">Suggestions start at 22 non-land cards (you have {spells}).</p>}
      {builder.running && <Progress value={null} message={builder.message} />}
      {!builder.running && builder.error && <div className="rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{builder.error}</div>}
      <div className="flex flex-col gap-1">
        {builder.variants.map((v) => {
          const name = buildName(v.label)
          const saved = session.variants.includes(name)
          return (
            <div key={v.label} className="rounded-md bg-white/[0.03]">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="flex gap-0.5">{v.colors.map((c) => <span key={c} className="size-2.5 rounded-full" style={{ background: COLOR_VAR[c] }} />)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-stone-200">{v.label}</div>
                  {v.breakdown && <div className="truncate text-[11px] text-stone-500">{v.breakdown}</div>}
                </div>
                <Button variant="ghost" onClick={() => setPreview(preview === v.label ? null : v.label)}>{preview === v.label ? 'Hide' : 'Preview'}</Button>
                {saved ? (
                  <Button onClick={() => act({ op: 'select', name })} disabled={session.active === name}>Open</Button>
                ) : (
                  <Button variant="primary" onClick={() => act({ op: 'set', name, cards: entries(v.deck) })} title="Save as a new build you can edit">Use</Button>
                )}
              </div>
              {preview === v.label && (
                <div className="flex flex-col gap-2 px-2 pb-2">
                  <CardPiles cards={v.deck} />
                  <SimResults stats={v.stats} note={v.note} advice={v.advice} message="Simulation data missing." />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
