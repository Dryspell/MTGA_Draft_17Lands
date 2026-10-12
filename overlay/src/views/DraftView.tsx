import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { useUi } from '../ui'
import { CardTable } from '../components/CardTable'
import { AdvisorPicks, ManaCurve, SignalMeter, TypeBreakdown } from '../components/Charts'
import { Button, Empty, Section } from '../components/primitives'
import { RecapView } from './RecapView'

function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, width] as const
}

export function DraftView() {
  const { snapshot, config } = useApp()
  const { setTab } = useUi()
  const [ref, width] = useWidth()

  if (!snapshot) return <Empty title="Connecting to the draft engine…" />
  if (!snapshot.hasDatasets) {
    return (
      <Empty title="No 17Lands datasets yet" action={<Button variant="primary" onClick={() => setTab('datasets')}>Open Datasets</Button>}>
        Download a dataset for the set you're drafting to see win rates and pick advice.
      </Empty>
    )
  }

  const hasDraft = snapshot.packCards.length > 0 || snapshot.missingCards.length > 0 || snapshot.poolSize > 0
  if (!hasDraft) {
    return snapshot.event.set ? (
      <Empty title={`Draft started: ${snapshot.event.set} ${snapshot.event.type}`}>Waiting for pack data to appear in the log…</Empty>
    ) : (
      <Empty title="Waiting for a draft to begin…">
        Make sure “Detailed Logs (Plugin Support)” is checked in your MTGA Account settings. Right-click any card for more options.
      </Empty>
    )
  }

  if (snapshot.draftComplete && snapshot.recap) return <RecapView />

  const wide = width >= 720
  const ideal = config?.card_logic.deck_mid?.distribution ?? []

  return (
    <div ref={ref} className={`flex gap-3 ${wide ? 'h-full min-h-0 flex-row' : 'flex-col'}`}>
      <div className={`flex flex-col gap-3 ${wide ? 'min-h-0 flex-1 overflow-y-auto' : ''}`}>
        <Section title={snapshot.packCards.length ? `Live pack · P${snapshot.pack} p${snapshot.pick}` : 'Live pack'}>
          <CardTable
            viewId="pack_table"
            cards={snapshot.packCards}
            pickedNames={snapshot.pickedNames}
            highlightBest
            showReasons
            empty={<div className="py-6 text-center text-[12px] text-stone-500">Waiting for the next pack…</div>}
          />
        </Section>
        {snapshot.missingCards.length > 0 && (
          <Section id="wheel_tracker" title={`Seen cards (wheel tracker) · ${snapshot.missingCards.length}`}>
            <CardTable viewId="missing_table" cards={snapshot.missingCards} />
          </Section>
        )}
      </div>
      <aside className={`flex flex-col gap-3 ${wide ? 'min-h-0 w-72 shrink-0 overflow-y-auto' : ''}`}>
        <Section title="Advisor">
          <AdvisorPicks cards={snapshot.packCards} />
        </Section>
        <Section id="open_lanes_panel" title="Open lanes">
          <SignalMeter signals={snapshot.signals} />
        </Section>
        <Section id="mana_curve_panel" title="Mana curve" right={<span className="text-[10px] text-stone-500">{snapshot.creatureCount} creatures · {snapshot.noncreatureCount} spells</span>}>
          <ManaCurve counts={snapshot.curve} ideal={ideal} />
        </Section>
        <Section id="pool_balance_panel" title="Pool balance">
          <TypeBreakdown counts={snapshot.typeCounts} />
        </Section>
      </aside>
    </div>
  )
}
