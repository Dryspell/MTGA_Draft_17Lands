import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useFormat } from '../ui'
import type { BoardCard, Card, ConstructedStats, GameRecord, GameView, MatchSummary, MulliganAdvice, SimilarOpponents, TrickCard } from '../types'
import { formatStat, identityColor, statsFor } from '../lib/cards'
import { useCardProps } from '../components/cardInteractions'
import { ManaCost } from '../components/ManaCost'
import { eventLabel, phaseLabel } from '../lib/game'
import { Empty, Section, Segmented } from '../components/primitives'
import { Breakdown, Pips, WinLossText } from '../components/Records'

const pct = (v: number) => `${Math.round(v * 100)}%`

export function GameTab() {
  const { game } = useApp()
  if (game?.active) return <LiveGame game={game} />
  return <GameHistory />
}

function LiveGame({ game }: { game: GameView }) {
  const { me, opponent: opp, library } = game
  const constructed = game.format === 'constructed'
  const sideboarded = game.match.sideboard.in.length + game.match.sideboard.out.length > 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-panel px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wider text-stone-500 uppercase">
            {eventLabel(game.eventId)} · game {game.gameNumber}
            {game.gameNumber > 1 && ` (${game.match.wins}–${game.match.losses})`}
            {game.onPlay !== null && ` · ${game.onPlay ? 'on the play' : 'on the draw'}`}
          </div>
          <div className="text-[15px] font-semibold text-white">
            {game.turn > 0 ? <>Turn {game.turn} · {game.myTurn ? 'your turn' : "opponent's turn"}</> : 'Opening hands'}
            <span className="ml-2 text-[12px] font-normal text-stone-400">{game.turn > 0 && phaseLabel(game.phase, game.step)}</span>
          </div>
          {(game.deck.name || opp.name) && (
            <div className="truncate text-[11px] text-stone-400">
              {game.deck.name && <>Playing <span className="text-stone-200">{game.deck.name}</span></>}
              {game.deck.name && opp.name && ' · '}
              {opp.name && <>vs <span className="text-stone-200">{opp.name}</span></>}
            </div>
          )}
        </div>
        <LifeBlock label="You" side={me} />
        <LifeBlock label="Opponent" side={opp} colors={opp.colors} />
      </div>

      {game.mulligan && <MulliganPanel advice={game.mulligan} />}

      {sideboarded && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-panel px-3 py-2 text-[12px]">
          <span className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Sideboarded</span>
          {game.match.sideboard.in.map((c) => <span key={`in-${c.name}`} className="text-emerald-300">+{c.count} {c.name}</span>)}
          {game.match.sideboard.out.map((c) => <span key={`out-${c.name}`} className="text-red-300">−{c.count} {c.name}</span>)}
        </div>
      )}

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
              <p className="text-[12px] text-stone-500">
                {!opp.lands.untapped ? 'Opponent is tapped out.' : constructed ? "None of the instant-speed cards they've shown fit their open mana." : 'No instant-speed cards in this set fit their open mana.'}
              </p>
            )}
            <p className="mt-1.5 text-[10px] text-stone-500">
              {constructed
                ? "Instants and flash cards they've revealed this match, then ones similar past opponents played, that fit their open mana."
                : 'Instants and flash cards in their colors they could cast now, most-played first.'}
            </p>
          </Section>

          <Section
            title={`Opponent · ${opp.seen.length} cards seen`}
            right={opp.colors.length > 0 && <span className="flex items-center gap-1.5 text-[11px] text-stone-400"><Pips colors={opp.colors} /> {constructed ? opp.archetypeName : `likely ${opp.archetype}`}</span>}
          >
            {opp.seen.length ? (
              <div className="flex max-h-[180px] flex-col overflow-y-auto">
                {opp.seen.map((c) => <SeenRow key={c.name} card={c} showGih={!constructed} />)}
              </div>
            ) : (
              <p className="text-[12px] text-stone-500">Nothing revealed yet.</p>
            )}
            {opp.similar && <SimilarBlock similar={opp.similar} />}
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

function TrickRow({ card }: { card: TrickCard }) {
  const props = useCardProps(card)
  const gih = useGih(card)
  return (
    <div {...props} className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-white/5">
      <span className="h-4 w-[3px] shrink-0 rounded-r" style={{ background: identityColor(card) }} />
      <span className="min-w-0 flex-1 truncate text-stone-200">{card.name}</span>
      <span className={`rounded px-1.5 text-[10px] ${KIND_TONE[card.trickKind] ?? KIND_TONE.instant}`}>{card.trickKind}</span>
      <ManaCost cost={card.manaCost} />
      {card.source === 'set' ? (
        <span className="tabular w-10 text-right text-stone-400" title="17Lands GIH win rate">{gih}</span>
      ) : (
        <span
          className={`w-[72px] text-right text-[10px] ${card.source === 'revealed' ? 'text-amber-300' : 'text-stone-400'}`}
          title={card.source === 'revealed' ? 'This opponent has shown this card in this match' : `Played by ${card.seenIn} similar past opponent${card.seenIn === 1 ? '' : 's'}`}
        >
          {card.source === 'revealed' ? 'revealed' : `seen ×${card.seenIn ?? 1}`}
        </span>
      )}
    </div>
  )
}

function SeenRow({ card, showGih }: { card: Card; showGih: boolean }) {
  const props = useCardProps(card)
  const gih = useGih(card)
  return (
    <div {...props} className="flex items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-white/5">
      <span className="tabular w-5 text-right text-stone-400">{card.count}</span>
      <span className="h-4 w-[3px] shrink-0 rounded-r" style={{ background: identityColor(card) }} />
      <span className="min-w-0 flex-1 truncate text-stone-200">{card.name}</span>
      <ManaCost cost={card.manaCost} />
      {showGih && <span className="tabular w-10 text-right text-stone-400">{gih}</span>}
    </div>
  )
}

function SimilarBlock({ similar }: { similar: SimilarOpponents }) {
  return (
    <div className="mt-2 border-t border-line/60 pt-2 text-[12px]">
      <div className="flex items-center gap-2 text-[11px] text-stone-400">
        <span className="min-w-0 flex-1">
          Looks like <span className="text-stone-200">{similar.archetype}</span> you've faced in {similar.games} game{similar.games === 1 ? '' : 's'}
        </span>
        <WinLossText r={similar} />
      </div>
      {similar.cards.length > 0 && (
        <>
          <div className="mt-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">They also played</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-stone-300">
            {similar.cards.map((c) => (
              <span key={c.name} title={`In ${c.games} of ${similar.games} games`}>
                {c.name}<span className="ml-1 text-[10px] text-stone-500">{pct(c.games / similar.games)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const MULL_TONE = {
  keep: { label: 'Keep', tone: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  risky: { label: 'Risky keep', tone: 'bg-amber-400/15 text-amber-300 ring-amber-400/40' },
  mulligan: { label: 'Mulligan', tone: 'bg-red-500/15 text-red-300 ring-red-400/40' },
}

function MulliganPanel({ advice }: { advice: MulliganAdvice }) {
  const v = MULL_TONE[advice.verdict]
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-3 ring-1 ${v.tone}`}>
      <div>
        <div className="text-[10px] tracking-wider uppercase opacity-80">
          Opening hand{advice.mulligans > 0 && ` · mulligan ${advice.mulligans}, keep ${advice.handSize - advice.mulligans}`} · {advice.onPlay ? 'on the play' : 'on the draw'}
        </div>
        <div className="text-[18px] leading-tight font-bold">{v.label}</div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-stone-400">
        {advice.colors.length > 0 && <span className="flex items-center gap-1" title="Colors your lands in hand produce">mana <Pips colors={advice.colors} /></span>}
        <span title="Chance to have at least 2 lands by your turn 2">2 lands by T2 <span className="tabular text-stone-200">{pct(advice.landBy2)}</span></span>
        <span title="Chance to have at least 3 lands by your turn 3">3 by T3 <span className="tabular text-stone-200">{pct(advice.landBy3)}</span></span>
        <span title="Chance to have at least 4 lands by your turn 4">4 by T4 <span className="tabular text-stone-200">{pct(advice.landBy4)}</span></span>
      </div>
      {advice.reasons.length > 0 && (
        <ul className="w-full list-disc pl-5 text-[12px] text-stone-300">
          {advice.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
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
  const [mode, setMode] = useState<'games' | 'matches' | 'stats'>('games')

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
      <div className="flex items-center justify-between gap-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'games', label: 'Games' },
            { value: 'matches', label: 'Matches' },
            { value: 'stats', label: 'Stats' },
          ]}
        />
        <span className="flex flex-wrap justify-end gap-2 text-[11px] text-stone-400">
          {byEvent.slice(0, 3).map(([e, r]) => <span key={e}>{eventLabel(e)} {r.wins}–{r.losses}</span>)}
        </span>
      </div>
      {mode === 'games' && (
        <>
          <GameReview record={record} />
          <Section title={`Game history · ${history.length}`}>
            <div className="flex max-h-[320px] flex-col overflow-y-auto">
              {history.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`flex items-center gap-3 rounded px-2 py-1 text-left text-[12px] ${r.id === record.id ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-white/5'}`}
                >
                  <ResultBadge result={r.result} />
                  <span className="w-28 shrink-0 text-stone-400">{shortTime(r.time)}</span>
                  <span className="min-w-0 flex-1 truncate text-stone-200">
                    {r.deckName || eventLabel(r.eventId)}{r.gameNumber > 1 ? ` · game ${r.gameNumber}` : ''}
                    {r.deckName && <span className="ml-1.5 text-stone-500">{eventLabel(r.eventId)}</span>}
                  </span>
                  <span className="flex w-16 items-center gap-1 text-stone-400">vs <Pips colors={r.opponent.colors} /></span>
                  <span className="tabular w-14 text-right text-stone-500">{r.turns} turns</span>
                </button>
              ))}
            </div>
          </Section>
        </>
      )}
      {mode === 'matches' && <MatchList refresh={`${game?.matchId}:${game?.result}`} onOpen={(id) => { setSelected(id); setMode('games') }} />}
      {mode === 'stats' && <StatsPanel refresh={`${game?.matchId}:${game?.result}`} />}
    </div>
  )
}

const shortTime = (t: string) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function MatchList({ refresh, onOpen }: { refresh: string; onOpen: (gameId: string) => void }) {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null)
  useEffect(() => {
    api.matches().then(setMatches).catch(() => setMatches([]))
  }, [refresh])
  if (!matches) return <Empty title="Loading matches…" />
  if (!matches.length) return <Empty title="No matches yet" />
  return (
    <div className="flex flex-col gap-2">
      {matches.map((m) => <MatchRow key={m.matchId} match={m} onOpen={onOpen} />)}
    </div>
  )
}

function MatchRow({ match: m, onOpen }: { match: MatchSummary; onOpen: (gameId: string) => void }) {
  const { toast } = useApp()
  const [note, setNote] = useState(m.note)
  const [editing, setEditing] = useState(false)
  const save = () => {
    setEditing(false)
    if (note === m.note) return
    api.setMatchNote(m.matchId, note).catch((e) => toast((e as Error).message, 'error'))
  }
  return (
    <div className="rounded-lg bg-panel px-3 py-2 text-[12px]">
      <div className="flex items-center gap-3">
        <ResultBadge result={m.result} />
        <span className="tabular font-semibold text-white">{m.wins}–{m.losses}</span>
        <span className="min-w-0 flex-1 truncate text-stone-200">
          {m.deckName || eventLabel(m.eventId)}
          <span className="ml-1.5 text-stone-500">{m.deckName ? eventLabel(m.eventId) : ''}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-stone-400">
          vs {m.opponent.name && <span className="text-stone-300">{m.opponent.name}</span>} <Pips colors={m.opponent.colors} /> {m.opponent.archetypeName}
        </span>
        <span className="shrink-0 text-right whitespace-nowrap text-stone-500">{shortTime(m.time)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {m.games.map((g) => {
          const sb = g.sideboard.in.length + g.sideboard.out.length
          return (
            <button
              key={g.id}
              onClick={() => onOpen(g.id)}
              title={sb ? [...g.sideboard.in.map((c) => `+${c.count} ${c.name}`), ...g.sideboard.out.map((c) => `−${c.count} ${c.name}`)].join('\n') : 'Open game review'}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:ring-1 hover:ring-white/20 ${g.result === 'win' ? 'bg-emerald-500/15 text-emerald-300' : g.result === 'loss' ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-stone-300'}`}
            >
              G{g.gameNumber} {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
              <span className="text-stone-400">{g.onPlay === null ? '' : g.onPlay ? 'play' : 'draw'}{g.mulligans > 0 ? ` · mull ${g.mulligans}` : ''}{sb ? ' · sided' : ''}</span>
            </button>
          )
        })}
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save() }}
          placeholder="Sideboarding plan, what beat you, what to change…"
          className="mt-1.5 h-16 w-full resize-y rounded bg-black/30 px-2 py-1 text-[12px] text-stone-200 ring-1 ring-line outline-none focus:ring-accent/60"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="mt-1 block w-full text-left text-[12px] whitespace-pre-wrap text-stone-400 hover:text-stone-200">
          {note || <span className="text-stone-600">+ Add a note</span>}
        </button>
      )}
    </div>
  )
}

function StatsPanel({ refresh }: { refresh: string }) {
  const [stats, setStats] = useState<ConstructedStats | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    api.constructedStats().then(setStats).catch(() => setFailed(true))
  }, [refresh])
  if (failed) return <Empty title="Couldn't load stats" />
  if (!stats) return <Empty title="Loading stats…" />
  if (!stats.overall.games) {
    return <Empty title="No constructed games yet">Play a constructed match with the overlay running and your records by deck, play/draw and opponent show up here.</Empty>
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title="Constructed record">
        <div className="flex flex-col gap-2 text-[12px]">
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="Overall" r={stats.overall} />
            <StatBox label="On the play" r={stats.onPlay} />
            <StatBox label="On the draw" r={stats.onDraw} />
          </div>
          <div className="text-[11px] text-stone-500">Mulliganed in {pct(stats.mulliganRate)} of games</div>
          <Breakdown title="By event" rows={stats.byEvent.map((r) => ({ ...r, label: eventLabel(r.key) }))} />
        </div>
      </Section>
      <Section title="Against">
        <div className="flex flex-col gap-2 text-[12px]">
          <Breakdown title="Archetype" rows={stats.byOpponent.slice(0, 10)} />
          <Breakdown title="Colors" rows={stats.byOpponentColors.slice(0, 10)} />
        </div>
      </Section>
      <Section title="By deck" className="md:col-span-2">
        <div className="flex flex-col text-[12px]">
          <div className="grid grid-cols-[1fr_64px_64px_64px] gap-2 px-1 text-[10px] tracking-wider text-stone-500 uppercase">
            <span>Deck</span><span className="text-right">Total</span><span className="text-right">Play</span><span className="text-right">Draw</span>
          </div>
          {stats.byDeck.map((d) => (
            <div key={d.key} className="grid grid-cols-[1fr_64px_64px_64px] gap-2 rounded px-1 py-0.5 hover:bg-white/5">
              <span className="truncate text-stone-200">{d.name}</span>
              <WinLossText r={d} className="text-right" />
              <WinLossText r={d.onPlay} className="text-right" />
              <WinLossText r={d.onDraw} className="text-right" />
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function StatBox({ label, r }: { label: string; r: ConstructedStats['overall'] }) {
  return (
    <div className="rounded bg-white/[0.03] px-2 py-1">
      <div className="text-[10px] text-stone-500 uppercase">{label}</div>
      <WinLossText r={r} className="text-[15px] font-semibold" />
      {r.games > 0 && <span className="ml-1.5 text-[10px] text-stone-500">{pct(r.wins / Math.max(1, r.wins + r.losses))}</span>}
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
          <div className="truncate text-[11px] tracking-wider text-stone-500 uppercase">
            {eventLabel(record.eventId)} · game {record.gameNumber}
            {record.deckName && <span className="normal-case"> · {record.deckName}</span>}
          </div>
          <div className="text-[15px] font-semibold text-white">
            {record.onPlay === null ? '' : record.onPlay ? 'On the play · ' : 'On the draw · '}{record.turns} turns
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
          <div className="flex items-center justify-end gap-1.5">
            vs {record.opponent.name && <span className="text-stone-200">{record.opponent.name}</span>}
            <Pips colors={record.opponent.colors} /> {record.format === 'constructed' ? record.opponent.archetypeName : record.opponent.archetype}
          </div>
          <div>{record.opponent.cards.length} opponent cards seen</div>
        </div>
      </div>

      {record.sideboard && record.sideboard.in.length + record.sideboard.out.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-panel px-3 py-2 text-[12px]">
          <span className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Sideboarded</span>
          {record.sideboard.in.map((c) => <span key={`in-${c.name}`} className="text-emerald-300">+{c.count} {c.name}</span>)}
          {record.sideboard.out.map((c) => <span key={`out-${c.name}`} className="text-red-300">−{c.count} {c.name}</span>)}
        </div>
      )}

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
