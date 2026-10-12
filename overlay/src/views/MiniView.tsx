import { useState } from 'react'
import { useApp } from '../store'
import { CardTable } from '../components/CardTable'
import { AdvisorPicks, ManaCurve, SignalMeter, TypeBreakdown } from '../components/Charts'
import { Empty, Section, Segmented } from '../components/primitives'
import { phaseLabel } from '../lib/game'
import type { GameView } from '../types'

type MiniTab = 'pack' | 'advisor' | 'stats' | 'pool' | 'game'

/** Port of the classic compact overlay: Pack, Advisor, Stats and Pool tabs. */
export function MiniView() {
  const { snapshot, config, game } = useApp()
  const [tab, setTab] = useState<MiniTab>('pack')
  const gameKey = game?.active ? `${game.matchId}:${game.gameNumber}` : null
  const [followed, setFollowed] = useState<string | null>(null)
  if (gameKey && gameKey !== followed) {
    setFollowed(gameKey)
    setTab('game')
  }
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
          ...(game ? [{ value: 'game' as const, label: 'Game' }] : []),
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
      {tab === 'game' && game && <MiniGame game={game} />}
    </div>
  )
}

function MiniGame({ game }: { game: GameView }) {
  if (!game.active) return <Empty title={game.result ? `Last game: ${game.result}` : 'No game in progress'}>Open the full window's Game tab for the review.</Empty>
  const { me, opponent: opp, library } = game
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto text-[12px]">
      <div className="flex items-center justify-between rounded-lg bg-panel px-3 py-2">
        <div>
          <div className="font-semibold text-white">Turn {game.turn}{game.myTurn ? ' · you' : ''}</div>
          <div className="text-[10px] text-stone-500">{phaseLabel(game.phase, game.step)}</div>
        </div>
        <div className="tabular text-[18px] font-bold"><span className="text-white">{me.life}</span><span className="mx-1 text-stone-600">–</span><span className="text-red-300">{opp.life}</span></div>
      </div>
      {library.tracked && (
        <Section title={`Library ${library.size}`} right={<span className="text-[11px] text-stone-400">land next {Math.round(library.landNext * 100)}%</span>}>
          {library.cards.filter((c) => !c.types.includes('Land')).slice(0, 6).map((c) => (
            <div key={c.name} className="flex justify-between text-stone-300"><span className="truncate">{c.count}× {c.name}</span><span className="tabular text-stone-500">{Math.round(c.nextDraw * 100)}%</span></div>
          ))}
        </Section>
      )}
      <Section title={`Opponent could have · ${opp.lands.untapped} open`}>
        {game.tricks.length ? game.tricks.slice(0, 5).map((c) => (
          <div key={c.name} className="flex justify-between gap-2 text-stone-300"><span className="truncate">{c.name}</span><span className="shrink-0 text-[10px] text-stone-500">{c.trickKind}</span></div>
        )) : <span className="text-stone-500">{opp.lands.untapped ? 'Nothing fits their mana.' : 'Tapped out.'}</span>}
      </Section>
    </div>
  )
}
