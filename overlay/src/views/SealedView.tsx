import { useEffect, useMemo, useState } from 'react'
import { api, toEntries } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import type { Card, DeckView, SealedState } from '../types'
import { BASIC_LANDS, COLORS, COLOR_VAR, cardColors, isCreature, isLand } from '../lib/cards'
import { count } from '../lib/deck'
import { copyText, openUrl, readClipboard } from '../lib/platform'
import { CardTable } from '../components/CardTable'
import { DeckStats, SimResults } from '../components/DeckPanels'
import { Button, Check, Empty, Progress, Section, Segmented } from '../components/primitives'
import { PracticeDialog } from '../components/TopBar'
import { CmcPiles } from './PoolView'

export function SealedView() {
  const { snapshot, runJob, toast } = useApp()
  const { sealedId, setSealedId } = useUi()
  const [loaded, setSession] = useState<SealedState | null>(null)
  const session = loaded && loaded.id === sealedId ? loaded : null
  const [practice, setPractice] = useState<null | 'generate' | 'import'>(null)
  const [view, setView] = useState<'visual' | 'list'>('visual')
  const [busy, setBusy] = useState('')
  const [sim, setSim] = useState<{ view: DeckView | null; busy: boolean; message: string }>({ view: null, busy: false, message: '' })
  const [filters, setFilters] = useState({ creatures: true, spells: true, lands: true, W: true, U: true, B: true, R: true, G: true, C: true })

  useEffect(() => {
    if (!sealedId) return
    api.sealed(sealedId).then(setSession).catch(() => setSealedId(null))
  }, [sealedId, setSealedId])

  const pool = useMemo(() => (session?.sideboard ?? []).filter((c) => {
    const typeOk = isLand(c) ? filters.lands : isCreature(c) ? filters.creatures : filters.spells
    const colors = cardColors(c)
    const colorOk = colors.length ? colors.some((col) => filters[col as 'W']) : filters.C
    return typeOk && colorOk
  }), [session?.sideboard, filters])

  const act = async (body: Parameters<typeof api.sealedAction>[1]) => {
    if (!session) return
    try {
      const next = await api.sealedAction(session.id, body)
      setSession(next)
      if (next.warning) toast(next.warning, 'error')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (!session) {
    const openLive = async () => {
      try {
        const s = await api.liveSealed()
        setSealedId(s.id)
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    }
    return (
      <Empty
        title="Sealed Studio"
        action={
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {!!snapshot?.poolSize && <Button variant="primary" onClick={openLive}>Open current pool ({snapshot.poolSize})</Button>}
            <Button onClick={() => setPractice('generate')}>Generate practice pool</Button>
            <Button onClick={() => setPractice('import')}>Import pool from clipboard</Button>
            {practice && <PracticeDialog mode={practice} onClose={() => setPractice(null)} />}
          </div>
        }
      >
        Build and compare multiple decks from a sealed pool.
      </Empty>
    )
  }

  const shells = async () => {
    setBusy('Generating deck shells…')
    try {
      setSession(await runJob<SealedState>(api.sealedShells(session.id)))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  const exportTo = async (target: 'mtga' | 'sealeddeck') => {
    setBusy(target === 'sealeddeck' ? 'Exporting to sealeddeck.tech…' : '')
    try {
      const res = await api.sealedExport(session.id, target)
      if (target === 'sealeddeck' && res.url) {
        await openUrl(res.url)
      } else {
        await copyText(res.text)
        toast(res.error ?? 'Deck copied to clipboard in MTGA format', res.error ? 'error' : 'success')
      }
    } finally {
      setBusy('')
    }
  }

  const analyze = async () => {
    setSim({ view: null, busy: true, message: 'Running 10,000 Monte Carlo simulations…' })
    try {
      const v = await runJob<DeckView>(api.analyzeDeck({ deck: toEntries(session.main), sideboard: toEntries(session.sideboard) }))
      setSim({ view: v, busy: false, message: '' })
    } catch (e) {
      setSim({ view: null, busy: false, message: (e as Error).message })
    }
  }

  const rename = () => {
    const name = window.prompt('Rename build', session.active)?.trim()
    if (name && name !== session.active) act({ op: 'rename', name: session.active, new_name: name })
  }

  const toMain = (c: Card) => act({ op: 'main', card: c.name })
  const toSide = (c: Card) => act({ op: 'side', card: c.name })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-semibold text-white">{session.label}</span>
        <span className="text-[11px] text-stone-500">{session.poolSize} card pool</span>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => setSealedId(null)}>Close session</Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {session.variants.map((v) => (
          <button
            key={v}
            onClick={() => act({ op: 'select', name: v })}
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

      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" onClick={shells} busy={busy.startsWith('Generating')}>Auto shells</Button>
        <Button onClick={() => act({ op: 'auto-lands' })}>Auto-lands</Button>
        <Button onClick={analyze} disabled={!session.main.length || sim.busy}>Analyze</Button>
        <Button onClick={async () => act({ op: 'import', text: await readClipboard() })}>Import deck</Button>
        <Button onClick={() => exportTo('mtga')}>Copy deck</Button>
        <Button onClick={() => exportTo('sealeddeck')} busy={busy.startsWith('Exporting')}>sealeddeck.tech</Button>
        <Button variant="ghost" onClick={() => act({ op: 'clear' })}>Clear</Button>
        <div className="flex-1" />
        <Segmented value={view} onChange={setView} options={[{ value: 'visual', label: 'Visual' }, { value: 'list', label: 'List' }]} />
      </div>
      {busy && <Progress value={null} message={busy} />}

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">Basics</span>
        {Object.entries(BASIC_LANDS).map(([name, color]) => {
          const n = session.main.find((c) => c.name === name)?.count ?? 0
          return (
            <div key={name} className="flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5">
              <span className="size-2.5 rounded-full" style={{ background: COLOR_VAR[color] }} title={name} />
              <button onClick={() => act({ op: 'side', card: name })} className="px-1 text-stone-400 hover:text-white" disabled={!n}>−</button>
              <span className="tabular w-4 text-center text-[12px]">{n}</span>
              <button onClick={() => act({ op: 'main', card: name })} className="px-1 text-stone-400 hover:text-white">+</button>
            </div>
          )
        })}
      </div>

      <Section title={`${session.active} · main deck (${count(session.main)})`} right={<span className="text-[10px] text-stone-500">click a card to move it</span>}>
        {view === 'visual' ? (
          session.main.length ? <CmcPiles cards={session.main} onCardClick={toSide} /> : <div className="py-4 text-center text-[12px] text-stone-500">Click cards in your pool to add them.</div>
        ) : (
          <CardTable viewId="sealed_deck_table" cards={session.main} extraFields={['cmc']} onRowClick={toSide} />
        )}
      </Section>

      <Section title={`Pool / sideboard (${count(session.sideboard)})`}>
        <div className="mb-2 flex flex-wrap items-center gap-x-2">
          {(['creatures', 'spells', 'lands'] as const).map((k) => (
            <Check key={k} checked={filters[k]} onChange={(v) => setFilters((f) => ({ ...f, [k]: v }))} label={k[0].toUpperCase() + k.slice(1)} />
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          {[...COLORS, 'C'].map((c) => (
            <button
              key={c}
              onClick={() => setFilters((f) => ({ ...f, [c]: !f[c as 'W'] }))}
              className={`size-5 rounded-full text-[10px] font-bold ring-1 ring-black/40 ${filters[c as 'W'] ? '' : 'opacity-25'}`}
              style={{ background: COLOR_VAR[c] }}
              title={c === 'C' ? 'Colorless' : c}
            />
          ))}
        </div>
        {view === 'visual' ? <CmcPiles cards={pool} onCardClick={toMain} /> : <CardTable viewId="sealed_pool_table" cards={pool} extraFields={['cmc']} onRowClick={toMain} />}
      </Section>

      <div className="grid gap-3 lg:grid-cols-2">
        <DeckStats deck={session.main} />
        <SimResults stats={sim.view?.stats ?? null} note={sim.view?.note} advice={sim.view?.advice} busy={sim.busy} message={sim.message} />
      </div>
    </div>
  )
}
