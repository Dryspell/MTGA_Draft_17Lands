import { useState } from 'react'
import type { Card } from '../types'
import { isLand } from './cards'

export const PILES = ['Lands', '1', '2', '3', '4', '5', '6+', 'Unknown']
export const DECK_PILES = PILES.slice(0, 7)

export function defaultPile(card: Card) {
  if (isLand(card)) return 'Lands'
  if (!card.types.length && !card.cmc) return 'Unknown'
  return card.cmc <= 1 ? '1' : card.cmc >= 6 ? '6+' : String(Math.floor(card.cmc))
}

export const pileLabel = (pile: string) => (pile === 'Lands' || pile === 'Unknown' ? pile : `CMC ${pile}`)

type Layout = Record<string, string>

function read(key: string): Layout {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Layout
  } catch {
    return {}
  }
}

/** Arena-style manual pile placement, remembered per build. */
export function usePileLayout(id: string) {
  const key = `piles:${id}`
  const [stored, setStored] = useState(() => ({ key, layout: read(key) }))
  const layout = stored.key === key ? stored.layout : read(key)

  const save = (next: Layout) => {
    if (Object.keys(next).length) localStorage.setItem(key, JSON.stringify(next))
    else localStorage.removeItem(key)
    setStored({ key, layout: next })
  }

  return {
    pileOf: (card: Card) => layout[card.name] ?? defaultPile(card),
    place: (card: Card, pile: string) => {
      const next = { ...layout }
      if (pile === defaultPile(card)) delete next[card.name]
      else next[card.name] = pile
      save(next)
    },
    reset: () => save({}),
    custom: Object.keys(layout).length > 0,
  }
}
