import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useFormat } from '../ui'
import type { BoardCard, Card, GameRecord, GameView } from '../types'
import { COLOR_VAR, formatStat, identityColor, statsFor } from '../lib/cards'
import { useCardProps } from '../components/cardInteractions'
import { ManaCost } from '../components/ManaCost'
import { eventLabel, phaseLabel } from '../lib/game'
import { Empty, Section } from '../components/primitives'

const pct = (v: number) => `${Math.round(v * 100)}%`

function Pips({ colors }: { colors: string[] }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {colors.map((c) => <span key={c} className="size-2.5 rounded-full ring-1 ring-black/30" style={{ background: COLOR_VAR[c] }} />)}
    </span>
  )
}

export function GameTab() {
  const { game } = useApp()
  if (game?.active) return <LiveGame game={game} />
  return <GameHistory />
}

function LiveGame({ game }: { game: GameView }) {
  const { me, opponent: opp, library } = game
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-panel px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wider text-stone-500 uppercase">
            {eventLabel(game.eventId)} · game {game.gameNumber} · {game.onPlay ? 'on the play' : 'on the draw'}
          </div>
          <div className="text-[15px] font-semibold text-white">
            Turn {game.turn} · {game.myTurn ? 'your turn' : "opponent's turn"}
            <span className="ml-2 text-[12px] font-normal text-stone-400">{phaseLabel(game.phase, game.step)}</span>
          </div>
        </div>
        <LifeBlock label="You" side={me} />
        <LifeBlock label="Opponent" side={opp} colors={opp.colors} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Section
          title={`Your library · ${library.size}`}
          right={library.tracked && <span className="text-[11px] text-stone-400">Land next {pct(library.landNext)} · within 2 draws {pct(library.landWithin2)}</span>}
        >
          {library.tracked ? (
            <div className="flex max-h-[360px] flex-col overflow-y-auto">
              {library.cards.map((c) => <LibraryRow key={c.name} card={c} />)}
            </div>
          ) : (
            <p className="text-[12px] text-stone-500">Your deck list wasn't in the log for this game, so draw odds aren't available.</p>
          )}
        </Section>

        <div className="flex flex-col gap-3">
          <Section
            title={`Opponent could have · ${opp.lands.untapped} open mana`}
            right={<Pips colors={opp.lands.colors} />}
          >
            {game.tricks.length ? (
              <div className="flex flex-col">
                {game.tricks.map((c) => <TrickRow key={c.name} card={c} />)}
              </div>
            ) : (
              <p className="text-[12px] text-stone-500">{opp.lands.untapped ? 'No instant-speed cards in this set fit their open mana.' : 'Opponent is tapped out.'}</p>
            )}
            <p className="mt-1.5 text-[10px] text-stone-500">Instants and flash cards in their colors they could cast now, most-played first.</p>
          </Section>

          <Section
            title={`Opponent · ${opp.seen.length} cards seen`}
            right={opp.archetype && <span className="flex items-center gap-1.5 text-[11px] text-stone-400"><Pips colors={opp.colors} /> likely {opp.archetype}</span>}
          >
            {opp.seen.length ? (
              <div className="flex max-h-[180px] flex-col overflow-y-auto">
                {opp.seen.map((c) => <SeenRow key={c.name} card={c} />)}
              </div>
            ) : (
              <p className="text-[12px] text-stone-500">Nothing revealed yet.</p>
            )}
          </Section>
        </div>
      </div>

      <Section title="Board">
        <BoardRow label="Opponent" cards={opp.battlefield} lands={opp.lands} />
        <div className="my-2 h-px bg-line" />
        <BoardRow label="You" cards={me.battlefield} lands={me.lands} />
      </Section>
    </div>
  )
}

function LifeBlock({ label, side, colors }: { label: string; side: GameView['me']; colors?: string[] }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] tracking-wider text-stone-500 uppercase">{label}{colors && <Pips colors={colors} />}</div>
      <div className={`tabular text-[26px] leading-none font-bold ${side.life <= 5 ? 'text-red-400' : 'text-white'}`}>{side.life}</div>
      <div className="tabular mt-0.5 text-[10px] text-stone-500">hand {side.hand} · lib {side.library} · gy {side.graveyard}</div>
    </div>
  )
}

function useGih(card: Card) {
  const fmt = useFormat()
  const { stats, arch } = statsFor(card, fmt.arch)
  return formatStat(stats.gihwr, 'gihwr', arch, fmt)
}

function LibraryRow({ card }: { card: Card & { nextDraw: number } }) {
  const props = useCardProps(card)
  return (
    <div {...props} className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-white/5">
      <span className="tabular w-5 text-right text-stone-400">{card.count}</span>
      <span className="h-4 w-[3px] shrink-0 rounded-r" style={{ background: identityColor(card) }} />
      <span className="min-w-0 flex-1 truncate text-stone-200">{card.name}</span>
      <ManaCost cost={card.manaCost} />
      <span className="relative w-12 text-right">
        <span className="absolute inset-y-0.5 right-0 rounded-sm bg-accent/20" style={{ width: `${Math.max(6, card.nextDraw * 100 * 2.5)}%` }} />
        <span className="tabular relative text-stone-300">{pct(card.nextDraw)}</span>
      </span>
    </div>
  )
}

const KIND_TONE: Record<string, string> = {
  removal: 'bg-red-500/15 text-red-300',
  counter: 'bg-sky-500/15 text-sky-300',
  trick: 'bg-amber-400/15 text-amber-300',
  'flash creature': 'bg-emerald-500/15 text-emerald-300',
  instant: 'bg-white/10 text-stone-300',
}

function TrickRow({ card }: { card: Card & { trickKind: string } }) {
  const props = useCardProps(card)
  const gih = useGih(card)
  return (
    <div {...props} className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-white/5">
      <span className="h-4 w-[3px] shrink-0 rounded-r" style={{ background: identityColor(card) }} />
      <span className="min-w-0 flex-1 truncate text-stone-200">{card.name}</span>
      <span className={`rounded px-1.5 text-[10px] ${KIND_TONE[card.trickKind] ?? KIND_TONE.instant}`}>{card.trickKind}</span>
      <ManaCost cost={card.manaCost} />
      <span className="tabular w-10 text-right text-stone-400" title="17Lands GIH win rate">{gih}</span>
    </div>
  )
}

function SeenRow({ card }: { card: Card }) {
  const props = useCardProps(card)
  const gih = useGih(card)
  return (
    <div {...props} className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-white/5">
      <span className="tabular w-5 text-right text-stone-400">{card.count}</span>
      <span className="h-4 w-[3px] shrink-0 rounded-r" style={{ background: identityColor(card) }} />
      <span className="min-w-0 flex-1 truncate text-stone-200">{card.name}</span>
      <ManaCost cost={card.manaCost} />
      <span className="tabular w-10 text-right text-stone-400">{gih}</span>
    </div>
  )
}

function BoardRow({ label, cards, lands }: { label: string; cards: BoardCard[]; lands: GameView['me']['lands'] }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-20 shrink-0 pt-1">
        <div className="text-[11px] font-semibold text-stone-300">{label}</div>
        <div className="flex items-center gap-1 text-[10px] text-stone-500">{lands.untapped}/{lands.total} lands <Pips colors={lands.colors} /></div>
      </div>
      <div className="flex min-h-[60px] flex-1 flex-wrap gap-1.5">
        {cards.length ? cards.map((c) => <BoardTile key={c.instanceId} card={c} />) : <span className="pt-1 text-[11px] text-stone-600">No permanents</span>}
      </div>
    </div>
  )
}

function BoardTile({ card }: { card: BoardCard }) {
  const props = useCardProps(card)
  const gih = useGih(card)
  return (
    <div
      {...props}
      className={`relative w-[64px] overflow-hidden rounded ring-1 ring-black/40 transition-opacity ${card.tapped ? 'opacity-50' : ''}`}
      style={{ aspectRatio: '488 / 680' }}
      title={card.tapped ? `${card.name} (tapped)` : card.name}
    >
      {card.images[0] ? (
        <img src={card.images[0]} alt={card.name} className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="size-full bg-stone-800 p-1 text-[9px] leading-tight text-stone-200" style={{ borderTop: `3px solid ${identityColor(card)}` }}>{card.name}</div>
      )}
      {!card.token && gih !== '-' && <span className="absolute top-0.5 left-0.5 rounded bg-black/80 px-0.5 text-[9px] text-stone-200">{gih}</span>}
      {card.power != null && (
        <span className="absolute right-0.5 bottom-0.5 rounded bg-black/85 px-1 text-[10px] font-bold text-white">{card.power}/{card.toughness}</span>
      )}
    </div>
  )
}

// ---- after the game -------------------------------------------------------

function GameHistory() {
  const { game } = useApp()
  const [history, setHistory] = useState<GameRecord[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    api.games().then(setHistory).catch(() => setHistory([]))
  }, [game?.matchId, game?.result])

  const byEvent = useMemo(() => {
    const out = new Map<string, { wins: number; losses: number }>()
    for (const r of history ?? []) {
      const e = out.get(r.eventId) ?? { wins: 0, losses: 0 }
      if (r.result === 'win') e.wins++
      else if (r.result === 'loss') e.losses++
      out.set(r.eventId, e)
    }
    return [...out]
  }, [history])

  if (!history) return <Empty title="Loading games…" />
  if (!history.length) {
    return (
      <Empty title="No games yet">
        Start a match in Arena and this tab will follow along: your draw odds, what the opponent could have, and the board. Each game is saved here for review afterwards.
      </Empty>
    )
  }
  const record = history.find((r) => r.id === selected) ?? history[0]

  return (
    <div className="flex flex-col gap-3">
      <GameReview record={record} />
      <Section
        title={`Game history · ${history.length}`}
        right={<span className="flex flex-wrap gap-2 text-[11px] text-stone-400">{byEvent.slice(0, 3).map(([e, r]) => <span key={e}>{eventLabel(e)} {r.wins}–{r.losses}</span>)}</span>}
      >
        <div className="flex max-h-[320px] flex-col overflow-y-auto">
          {history.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`flex items-center gap-3 rounded px-2 py-1 text-left text-[12px] ${r.id === record.id ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-white/5'}`}
            >
              <ResultBadge result={r.result} />
              <span className="w-28 shrink-0 text-stone-400">{new Date(r.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              <span className="min-w-0 flex-1 truncate text-stone-200">{eventLabel(r.eventId)}{r.gameNumber > 1 ? ` · game ${r.gameNumber}` : ''}</span>
              <span className="flex w-16 items-center gap-1 text-stone-400">vs <Pips colors={r.opponent.colors} /></span>
              <span className="tabular w-14 text-right text-stone-500">{r.turns} turns</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  )
}

function ResultBadge({ result }: { result: GameRecord['result'] }) {
  const tone = result === 'win' ? 'bg-emerald-500/20 text-emerald-300' : result === 'loss' ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-stone-300'
  return <span className={`w-9 shrink-0 rounded py-0.5 text-center text-[10px] font-bold uppercase ${tone}`}>{result === 'win' ? 'Win' : result === 'loss' ? 'Loss' : 'Draw'}</span>
}

const VERDICT = {
  screw: { label: 'Mana screw', tone: 'text-red-300' },
  flood: { label: 'Mana flood', tone: 'text-amber-300' },
  smooth: { label: 'Smooth mana', tone: 'text-emerald-300' },
}

export function GameReview({ record }: { record: GameRecord }) {
  const turns = useMemo(() => {
    const map = new Map<number, GameRecord['timeline']>()
    for (const e of record.timeline) map.set(e.turn, [...(map.get(e.turn) ?? []), e])
    return [...map].sort((a, b) => a[0] - b[0])
  }, [record.timeline])
  const verdict = VERDICT[record.mana.verdict]
  const cast = record.timeline.filter((e) => e.mine && e.action === 'cast').length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 rounded-lg bg-panel p-4">
        <div className={`flex size-14 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold uppercase ${record.result === 'win' ? 'bg-emerald-500/20 text-emerald-300' : record.result === 'loss' ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-stone-300'}`}>
          {record.result}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wider text-stone-500 uppercase">{eventLabel(record.eventId)} · game {record.gameNumber}</div>
          <div className="text-[15px] font-semibold text-white">
            {record.onPlay ? 'On the play' : 'On the draw'} · {record.turns} turns
            {record.mulligans > 0 && ` · mulligan to ${7 - record.mulligans}`}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-[12px] text-stone-400">
            <span className={verdict.tone}>{verdict.label}</span>
            <span>{record.mana.landsSeen} lands in {record.mana.cardsSeen} cards seen ({pct(record.mana.landPct)})</span>
            {record.mana.missedDrops.length > 0 && <span>missed land drop on turn {record.mana.missedDrops.join(', ')}</span>}
            <span>{cast} spells cast</span>
          </div>
        </div>
        <div className="text-right text-[12px] text-stone-400">
          <div className="flex items-center justify-end gap-1.5">vs <Pips colors={record.opponent.colors} /> {record.opponent.archetype}</div>
          <div>{record.opponent.cards.length} opponent cards seen</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
        <Section title="Life totals"><LifeChart life={record.life} /></Section>
        <Section title="Turn by turn">
          <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto text-[12px]">
            {turns.map(([turn, events]) => (
              <div key={turn} className="grid grid-cols-[44px_1fr_1fr] gap-2 border-b border-line/50 pb-1">
                <span className="tabular text-stone-500">T{turn}</span>
                <span className="text-stone-200">{events.filter((e) => e.mine).map((e) => `${e.action} ${e.name}`).join(' · ') || <span className="text-stone-600">-</span>}</span>
                <span className="text-stone-400">{events.filter((e) => !e.mine).map((e) => `${e.action} ${e.name}`).join(' · ') || <span className="text-stone-600">-</span>}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-[44px_1fr_1fr] gap-2 text-[10px] tracking-wider text-stone-500 uppercase"><span /><span>You</span><span>Opponent</span></div>
        </Section>
      </div>

      {record.opponent.cards.length > 0 && (
        <Section id="game_review_opponent" title="Opponent's cards" defaultOpen={false}>
          <div className="columns-2 gap-4 text-[12px] text-stone-300 sm:columns-3">
            {record.opponent.cards.map((c) => <div key={c.name}>{c.count > 1 ? `${c.count}× ` : ''}{c.name}</div>)}
          </div>
        </Section>
      )}
    </div>
  )
}

function LifeChart({ life }: { life: GameRecord['life'] }) {
  if (life.length < 2) return <p className="text-[12px] text-stone-500">Not enough turns to chart.</p>
  const w = 300, h = 120, pad = 4
  const maxTurn = life[life.length - 1][0]
  const maxLife = Math.max(20, ...life.flatMap(([, a, b]) => [a, b]))
  const x = (t: number) => pad + ((t - life[0][0]) / Math.max(1, maxTurn - life[0][0])) * (w - pad * 2)
  const y = (v: number) => h - pad - (Math.max(0, v) / maxLife) * (h - pad * 2)
  const line = (i: 1 | 2) => life.map((p) => `${x(p[0])},${y(p[i])}`).join(' ')
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full">
        <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-stone-700" />
        <polyline points={line(2)} fill="none" stroke="var(--color-red-400, #f87171)" strokeWidth="2" />
        <polyline points={line(1)} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-[10px] text-stone-500">
        <span>T{life[0][0]}</span>
        <span className="flex gap-3"><span className="text-accent">You {life[life.length - 1][1]}</span><span className="text-red-400">Opponent {life[life.length - 1][2]}</span></span>
        <span>T{maxTurn}</span>
      </div>
    </div>
  )
}
