import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import type { Card } from '../types'
import { identityColor } from '../lib/cards'
import { isCardDrag, readCardDrag, startCardDrag, type DraggedCard, type DragSource } from '../lib/drag'
import { DECK_PILES, PILES, defaultPile, pileLabel } from '../lib/piles'
import { useCardProps } from './cardInteractions'

const HIGHLIGHT = 'bg-accent/10 ring-1 ring-accent/50'

/** A drop target that lights up while a card is dragged over it. */
export function DropZone({ onDrop, children, className = '' }: { onDrop: (card: DraggedCard) => void; children: ReactNode; className?: string }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        if (!isCardDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={(e) => {
        setOver(false)
        const card = readCardDrag(e)
        if (!card) return
        e.preventDefault()
        onDrop(card)
      }}
      className={`rounded-lg transition-colors ${over ? HIGHLIGHT : ''} ${className}`}
    >
      {children}
    </div>
  )
}

interface PilesProps {
  cards: Card[]
  /** Where cards dragged out of these piles come from. Omit for read-only piles. */
  zone?: DragSource
  pileOf?: (card: Card) => string
  /** Always show the main mana-value columns so cards can be dropped into empty ones. */
  showEmpty?: boolean
  onCardClick?: (card: Card) => void
  onDropToPile?: (card: DraggedCard, pile: string) => void
}

export function CardPiles({ cards, zone, pileOf = defaultPile, showEmpty, onCardClick, onDropToPile }: PilesProps) {
  const [over, setOver] = useState<string | null>(null)
  const piles = useMemo(() => {
    const map = new Map<string, Card[]>()
    for (const c of cards) {
      const pile = pileOf(c)
      map.set(pile, [...(map.get(pile) ?? []), c])
    }
    for (const list of map.values()) list.sort((a, b) => a.cmc - b.cmc || a.colors.join('').localeCompare(b.colors.join('')) || a.name.localeCompare(b.name))
    return PILES.filter((p) => map.has(p) || (showEmpty && DECK_PILES.includes(p))).map((p) => [p, map.get(p) ?? []] as const)
  }, [cards, pileOf, showEmpty])

  const columnDrop = (pile: string) => onDropToPile && {
    onDragOver: (e: DragEvent) => {
      if (!isCardDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setOver(pile)
    },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null) },
    onDrop: (e: DragEvent) => {
      setOver(null)
      const card = readCardDrag(e)
      if (!card) return
      e.preventDefault()
      e.stopPropagation()
      onDropToPile(card, pile)
    },
  }

  return (
    <div className="flex min-h-0 gap-1.5 overflow-x-auto pb-2">
      {piles.map(([pile, list]) => (
        <div
          key={pile}
          {...columnDrop(pile)}
          className={`flex max-w-[124px] min-w-[84px] flex-1 flex-col rounded-md p-0.5 transition-colors ${over === pile ? HIGHLIGHT : ''}`}
        >
          <div className="mb-1 text-center text-[10px] font-semibold tracking-wider text-stone-500 uppercase">
            {pileLabel(pile)} · {list.reduce((n, c) => n + c.count, 0)}
          </div>
          {list.length ? (
            <div className="flex flex-col">
              {list.map((c, i) => <PileCard key={c.name} card={c} first={i === 0} zone={zone} onClick={onCardClick} />)}
            </div>
          ) : (
            <div className="h-16 rounded-md border border-dashed border-line" />
          )}
        </div>
      ))}
    </div>
  )
}

function PileCard({ card, first, zone, onClick }: { card: Card; first: boolean; zone?: DragSource; onClick?: (card: Card) => void }) {
  const props = useCardProps(card)
  return (
    <div
      {...props}
      draggable={!!zone}
      onDragStart={(e) => {
        props.onDragStart()
        if (zone) startCardDrag(e, { name: card.name, from: zone })
      }}
      onClick={onClick && (() => onClick(card))}
      className={`relative overflow-hidden rounded-md ring-1 ring-black/40 transition-transform hover:z-10 hover:-translate-y-1 ${zone ? 'cursor-grab active:cursor-grabbing' : onClick ? 'cursor-pointer' : ''}`}
      style={{ aspectRatio: '488 / 680', marginTop: first ? 0 : '-105%' }}
    >
      {card.images[0] ? (
        <img src={card.images[0]} alt={card.name} className="pointer-events-none size-full object-cover" loading="lazy" draggable={false} />
      ) : (
        <div className="flex size-full flex-col bg-stone-800 p-1.5 text-[10px] text-stone-200" style={{ borderTop: `3px solid ${identityColor(card)}` }}>
          {card.name}
        </div>
      )}
      {card.count > 1 && <span className="absolute top-1 right-1 rounded bg-black/80 px-1 text-[10px] font-bold text-white">×{card.count}</span>}
    </div>
  )
}
