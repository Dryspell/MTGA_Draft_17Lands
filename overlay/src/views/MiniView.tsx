import { useState } from 'react'
import { useApp } from '../store'
import { CardTable } from '../components/CardTable'
import { AdvisorPicks, ManaCurve, SignalMeter, TypeBreakdown } from '../components/Charts'
import { Empty, Section, Segmented } from '../components/primitives'

type MiniTab = 'pack' | 'advisor' | 'stats' | 'pool'

/** Port of the classic compact overlay: Pack, Advisor, Stats and Pool tabs. */
export function MiniView() {
  const { snapshot, config } = useApp()
  const [tab, setTab] = useState<MiniTab>('pack')
  if (!snapshot) return <Empty title="Connecting…" />

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pack', label: 'Pack' },
          { value: 'advisor', label: 'Advisor' },
          { value: 'stats', label: 'Stats' },
          { value: 'pool', label: `Pool ${snapshot.poolSize || ''}` },
        ]}
      />
      {tab === 'pack' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <CardTable
            viewId="overlay_table"
            cards={snapshot.packCards}
            pickedNames={snapshot.pickedNames}
            highlightBest
            className="min-h-0 flex-1"
            empty={<div className="py-6 text-center text-[12px] text-stone-500">Waiting for the next pack…</div>}
          />
          {snapshot.missingCards.length > 0 && (
            <Section id="mini_wheel_tracker" title={`Seen cards (wheel) · ${snapshot.missingCards.length}`} defaultOpen={false}>
              <CardTable viewId="missing_table" cards={snapshot.missingCards} />
            </Section>
          )}
        </div>
      )}
      {tab === 'advisor' && <div className="overflow-y-auto"><AdvisorPicks cards={snapshot.packCards} limit={5} /></div>}
      {tab === 'stats' && (
        <div className="flex flex-col gap-2 overflow-y-auto">
          <Section title="Open lanes"><SignalMeter signals={snapshot.signals} /></Section>
          <Section title="Mana curve"><ManaCurve counts={snapshot.curve} ideal={config?.card_logic.deck_mid?.distribution ?? []} /></Section>
          <Section title="Pool balance"><TypeBreakdown counts={snapshot.typeCounts} /></Section>
        </div>
      )}
      {tab === 'pool' && <CardTable viewId="overlay_pool_table" cards={snapshot.pool} className="min-h-0 flex-1" />}
    </div>
  )
}
