import { useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useFormat } from '../ui'
import type { Card } from '../types'
import { identityColor, isCreature, isLand } from '../lib/cards'
import { entries } from '../lib/deck'
import { copyText } from '../lib/platform'
import { CardTable } from '../components/CardTable'
import { useCardProps } from '../components/CardHover'
import { Button, Check, Empty, Segmented, Select } from '../components/primitives'

const FOLLOW = 'Follow'
type TypeKey = 'creature' | 'land' | 'spell' | 'other'

function typeMatches(card: Card, on: Record<TypeKey, boolean>) {
  if (!card.types.length) return on.other
  if (on.creature && isCreature(card)) return true
  if (on.land && isLand(card)) return true
  if (on.spell && (card.types.includes('Instant') || card.types.includes('Sorcery'))) return true
  if (on.other && ['Artifact', 'Enchantment', 'Planeswalker'].some((t) => card.types.includes(t))) return true
  return false
}

export function PoolView() {
  const { snapshot, config, toast } = useApp()
  const fmt = useFormat()
  const [types, setTypes] = useState<Record<TypeKey, boolean>>({ creature: true, land: true, spell: true, other: true })
  const [override, setOverride] = useState(FOLLOW)
  const [mode, setMode] = useState<'list' | 'visual'>('list')

  const pool = useMemo(() => (snapshot?.pool ?? []).filter((c) => typeMatches(c, types)), [snapshot?.pool, types])
  if (!snapshot?.pool.length) return <Empty title="No picks yet">Your drafted cards will appear here.</Empty>

  const arch = override === FOLLOW || override === 'Auto' ? fmt.arch : override
  const following = config?.settings.deck_filter === 'Auto' ? 'Auto' : 'Deck Filter'
  const status = override === FOLLOW ? `(${following}: ${arch === 'All Decks' && following === 'Auto' ? 'Detecting…' : arch})` : ''

  const exportPool = async () => {
    const { text } = await api.exportDeck({ deck: entries(pool) })
    await copyText(text)
    toast('Pool copied to clipboard', 'success')
  }

  const toolbar = (
    <>
      {(['creature', 'land', 'spell', 'other'] as TypeKey[]).map((k) => (
        <Check key={k} checked={types[k]} onChange={(v) => setTypes((t) => ({ ...t, [k]: v }))} label={{ creature: 'Creatures', land: 'Lands', spell: 'Spells', other: 'Other' }[k]} />
      ))}
      <Select value={override} onChange={(e) => setOverride(e.target.value)} title="Colors used for this tab's stats">
        <option value={FOLLOW}>Follow deck filter</option>
        {Object.entries(snapshot.filterOptions).map(([label, key]) => <option key={key} value={key}>{label}</option>)}
      </Select>
      {status && <span className="text-[11px] text-stone-500">{status}</span>}
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-stone-400">{snapshot.poolSize} cards</span>
        <div className="flex-1" />
        <Segmented value={mode} onChange={setMode} options={[{ value: 'list', label: 'List' }, { value: 'visual', label: 'Visual' }]} />
        <Button onClick={() => exportPool().catch((e) => toast(e.message, 'error'))}>Export pool</Button>
      </div>
      {mode === 'list' ? (
        <CardTable viewId="taken_table" cards={pool} arch={arch} toolbar={toolbar} className="flex-1" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">{toolbar}</div>
          <CmcPiles cards={pool} />
        </>
      )}
    </div>
  )
}

const PILES = ['Lands', '1', '2', '3', '4', '5', '6+', 'Unknown']

function pileOf(card: Card) {
  if (isLand(card)) return 'Lands'
  if (!card.types.length && !card.cmc) return 'Unknown'
  return card.cmc <= 1 ? '1' : card.cmc >= 6 ? '6+' : String(Math.floor(card.cmc))
}

export function CmcPiles({ cards, onCardClick }: { cards: Card[]; onCardClick?: (card: Card) => void }) {
  const piles = useMemo(() => {
    const map = new Map<string, Card[]>()
    for (const c of cards) map.set(pileOf(c), [...(map.get(pileOf(c)) ?? []), c])
    for (const list of map.values()) list.sort((a, b) => a.colors.join('').localeCompare(b.colors.join('')) || a.name.localeCompare(b.name))
    return PILES.filter((p) => map.has(p)).map((p) => [p, map.get(p)!] as const)
  }, [cards])
  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-auto pb-2">
      {piles.map(([pile, list]) => (
        <div key={pile} className="flex w-28 shrink-0 flex-col">
          <div className="mb-1 text-center text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
            {pile === 'Lands' || pile === 'Unknown' ? pile : `CMC ${pile}`} · {list.reduce((n, c) => n + c.count, 0)}
          </div>
          <div className="flex flex-col">
            {list.map((c, i) => <PileCard key={c.name} card={c} first={i === 0} onClick={onCardClick} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function PileCard({ card, first, onClick }: { card: Card; first: boolean; onClick?: (card: Card) => void }) {
  const props = useCardProps(card)
  return (
    <div
      {...props}
      onClick={onClick && (() => onClick(card))}
      className={`relative overflow-hidden rounded-md ring-1 ring-black/40 transition-transform hover:z-10 hover:-translate-y-1 ${first ? '' : '-mt-[118px]'} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ aspectRatio: '488 / 680' }}
    >
      {card.images[0] ? (
        <img src={card.images[0]} alt={card.name} className="size-full object-cover" loading="lazy" />
      ) : (
        <div className="flex size-full flex-col bg-stone-800 p-1.5 text-[10px] text-stone-200" style={{ borderTop: `3px solid ${identityColor(card)}` }}>
          {card.name}
        </div>
      )}
      {card.count > 1 && <span className="absolute top-1 right-1 rounded bg-black/80 px-1 text-[10px] font-bold text-white">×{card.count}</span>}
    </div>
  )
}
