import { useCallback, useEffect } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import type { DeckVariant } from '../types'
import { isLand } from '../lib/cards'
import { count, entries } from '../lib/deck'
import { copyText } from '../lib/platform'
import { CardTable } from '../components/CardTable'
import { DeckStats, SampleHand, SimResults } from '../components/DeckPanels'
import { Button, Empty, Progress, Section, Select } from '../components/primitives'

export function DeckBuilderView() {
  const { snapshot, runJob, toast } = useApp()
  const { builder, setBuilder, setCustom, setTab } = useUi()
  const spells = (snapshot?.pool ?? []).filter((c) => !isLand(c)).reduce((n, c) => n + c.count, 0)
  const poolKey = `${snapshot?.draftId}:${snapshot?.poolSize}`

  const build = useCallback(async () => {
    setBuilder({ running: true, variants: [], selected: null, message: 'Initializing AI builder…', error: '', builtFor: poolKey })
    const found: DeckVariant[] = []
    try {
      const result = await runJob<{ variants: DeckVariant[] }>(api.suggestDeck(), (job) => {
        const variant = job.data?.variant as DeckVariant | undefined
        if (variant) {
          found.push(variant)
          setBuilder({ variants: [...found], selected: found[0].label })
        } else if (job.message) setBuilder({ message: job.message })
      })
      setBuilder({ variants: result.variants, selected: result.variants[0]?.label ?? null, running: false })
    } catch (e) {
      setBuilder({ running: false, error: (e as Error).message })
    }
  }, [runJob, setBuilder, poolKey])

  useEffect(() => {
    if (spells >= 22 && !builder.running && builder.builtFor !== poolKey) build()
  }, [spells, builder.running, builder.builtFor, poolKey, build])

  if (spells < 22 && !builder.variants.length) {
    return <Empty title="Not enough spells yet">Have {spells}, need 22 non-land cards to build a 40-card deck.</Empty>
  }

  const variant = builder.variants.find((v) => v.label === builder.selected) ?? builder.variants[0]

  const copy = async () => {
    if (!variant) return
    const { text } = await api.exportDeck({ deck: entries(variant.deck), sideboard: entries(variant.sideboard) })
    await copyText(text)
    toast('Deck copied in MTGA format', 'success')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={variant?.label ?? ''} onChange={(e) => setBuilder({ selected: e.target.value })} className="min-w-0 flex-1" disabled={!builder.variants.length}>
          {!builder.variants.length && <option>{builder.running ? builder.message : 'No decks yet'}</option>}
          {builder.variants.map((v) => <option key={v.label} value={v.label}>{v.label}</option>)}
        </Select>
        <Button onClick={build} busy={builder.running}>Rebuild</Button>
        <Button onClick={() => copy().catch((e) => toast(e.message, 'error'))} disabled={!variant}>Copy deck</Button>
        <Button
          variant="primary"
          disabled={!variant}
          onClick={() => { if (variant) { setCustom({ deck: variant.deck, sideboard: variant.sideboard }); setTab('custom') } }}
        >
          Edit in Custom Deck
        </Button>
      </div>
      {builder.running && <Progress value={null} message={builder.message} />}
      {!builder.running && builder.error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{builder.error}</div>
      )}
      {variant && (
        <>
          {variant.breakdown && <div className="text-[12px] text-stone-400">{variant.breakdown}</div>}
          <div className="grid gap-3 lg:grid-cols-2">
            <Section title={`Main deck (${count(variant.deck)})`}>
              <CardTable viewId="suggest_deck_table" cards={variant.deck} arch={variant.archetype} extraFields={['cmc']} />
            </Section>
            <Section title={`Sideboard (${count(variant.sideboard)})`}>
              <CardTable viewId="suggest_sb_table" cards={variant.sideboard} arch={variant.archetype} extraFields={['cmc']} />
            </Section>
            <DeckStats deck={variant.deck} />
            <SimResults stats={variant.stats} note={variant.note} advice={variant.advice} message="Simulation data missing." />
          </div>
          <SampleHand deck={variant.deck} />
        </>
      )}
    </div>
  )
}
