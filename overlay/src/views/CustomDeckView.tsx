import { useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import type { Card, DeckView, Job } from '../types'
import { BASIC_LANDS, COLOR_VAR, sortByCmc } from '../lib/cards'
import { addBasic, count, entries, moveOne } from '../lib/deck'
import { copyText } from '../lib/platform'
import { CardTable } from '../components/CardTable'
import { DeckStats, SampleHand, SimResults } from '../components/DeckPanels'
import { Button, Empty, Section } from '../components/primitives'

export function CustomDeckView() {
  const { snapshot, runJob, toast } = useApp()
  const { custom, setCustom } = useUi()
  const [sim, setSim] = useState<{ view: DeckView | null; busy: boolean; message: string }>({ view: null, busy: false, message: '' })

  const pool = snapshot?.pool
  const fromPool = () => setCustom({ deck: [], sideboard: sortByCmc(pool ?? []) })
  useEffect(() => {
    if (!custom && pool?.length) setCustom({ deck: [], sideboard: sortByCmc(pool) })
  }, [custom, pool, setCustom])

  if (!custom) return <Empty title="No cards to build with yet">Draft some cards, or send a deck here from the Deck Builder.</Empty>
  const { deck, sideboard } = custom

  const toDeck = (c: Card) => { const [s, d] = moveOne(sideboard, deck, c.name); setCustom({ deck: d, sideboard: s }) }
  const toSide = (c: Card) => { const [d, s] = moveOne(deck, sideboard, c.name); setCustom({ deck: d, sideboard: s }) }
  const basic = (name: string, delta: number) => setCustom({ deck: addBasic(deck, name, delta), sideboard })

  const clear = () => {
    let sb = sideboard
    for (const c of deck) {
      if (c.name in BASIC_LANDS) continue
      const existing = sb.find((x) => x.name === c.name)
      sb = existing ? sb.map((x) => (x === existing ? { ...x, count: x.count + c.count } : x)) : [...sb, c]
    }
    setCustom({ deck: [], sideboard: sortByCmc(sb) })
    setSim({ view: null, busy: false, message: '' })
  }

  const run = async (start: () => Promise<Job<DeckView>>, message: string, apply: boolean) => {
    setSim((s) => ({ ...s, busy: true, message }))
    try {
      const view = await runJob<DeckView>(start(), (j) => j.message && setSim((s) => ({ ...s, message: j.message })))
      if (apply) setCustom({ deck: view.deck, sideboard: view.sideboard })
      setSim({ view, busy: false, message: '' })
    } catch (e) {
      setSim({ view: null, busy: false, message: (e as Error).message })
    }
  }
  const body = () => ({ deck: entries(deck), sideboard: entries(sideboard) })

  const copy = async () => {
    const { text } = await api.exportDeck(body())
    await copyText(text)
    toast('Deck copied in MTGA format', 'success')
  }

  const total = count(deck)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button onClick={() => run(() => api.autoLands(body()), 'Simulating perfect mana base permutations…', true)} busy={sim.busy} title="Fill the rest of the deck with the best basic land split">Auto-lands</Button>
        <Button onClick={() => run(() => api.analyzeDeck(body()), 'Running 10,000 Monte Carlo simulations…', false)} disabled={sim.busy || !total}>Analyze</Button>
        <Button
          onClick={() => total === 40 ? run(() => api.optimizeDeck(body()), 'AI auto-optimizing: simulating thousands of deck permutations…', true) : toast(`Base deck must be exactly 40 cards to optimize (currently ${total}).`, 'error')}
          disabled={sim.busy}
        >
          Auto-optimize
        </Button>
        <Button onClick={() => copy().catch((e) => toast(e.message, 'error'))} disabled={!total}>Copy deck</Button>
        <div className="flex-1" />
        <Button variant="ghost" onClick={clear}>Clear deck</Button>
        <Button variant="ghost" onClick={fromPool} title="Start over from your drafted pool">Reset from pool</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-panel px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">Basics</span>
        {Object.entries(BASIC_LANDS).map(([name, color]) => {
          const n = deck.find((c) => c.name === name)?.count ?? 0
          return (
            <div key={name} className="flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5">
              <span className="size-2.5 rounded-full" style={{ background: COLOR_VAR[color] }} title={name} />
              <button onClick={() => basic(name, -1)} className="px-1 text-stone-400 hover:text-white" disabled={!n}>−</button>
              <span className="tabular w-4 text-center text-[12px]">{n}</span>
              <button onClick={() => basic(name, 1)} className="px-1 text-stone-400 hover:text-white">+</button>
            </div>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title={`Main deck (${total})`} right={<span className="text-[10px] text-stone-500">double-click to move</span>}>
          <CardTable viewId="custom_deck_table" cards={deck} extraFields={['cmc']} onRowDoubleClick={toSide} rowTitle="Double-click to move to sideboard" />
        </Section>
        <Section title={`Sideboard (${count(sideboard)})`}>
          <CardTable viewId="custom_sb_table" cards={sideboard} extraFields={['cmc']} onRowDoubleClick={toDeck} rowTitle="Double-click to move to main deck" />
        </Section>
        <DeckStats deck={deck} />
        <SimResults stats={sim.view?.stats ?? null} note={sim.view?.note} advice={sim.view?.advice} busy={sim.busy} message={sim.message} />
      </div>
      {total > 0 && <SampleHand deck={deck} />}
    </div>
  )
}
