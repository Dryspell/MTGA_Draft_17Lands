import type { Card, DeckEntry } from '../types'
import { COLORS, isCreature, isLand } from './cards'

export interface DeckSummary {
  total: number
  creatures: number
  lands: number
  spells: number
  pips: Record<string, number>
  curve: number[]
  tags: [string, number][]
  avgCmc: number
}

/** Port of the Deck Builder's stats panel (composition, pips, roles, curve 1..6+). */
export function summarize(deck: Card[]): DeckSummary {
  const pips: Record<string, number> = Object.fromEntries(COLORS.map((c) => [c, 0]))
  const curve = [0, 0, 0, 0, 0, 0]
  const tags = new Map<string, number>()
  let total = 0, creatures = 0, lands = 0, cmcSum = 0, nonLands = 0
  for (const c of deck) {
    total += c.count
    if (isCreature(c)) creatures += c.count
    if (isLand(c)) {
      lands += c.count
      continue
    }
    nonLands += c.count
    cmcSum += c.cmc * c.count
    curve[Math.max(1, Math.min(6, Math.floor(c.cmc))) - 1] += c.count
    for (const s of COLORS) pips[s] += (c.manaCost.split(s).length - 1) * c.count
    for (const t of c.tags) tags.set(t, (tags.get(t) ?? 0) + c.count)
  }
  return {
    total, creatures, lands, spells: total - creatures - lands, pips, curve,
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]),
    avgCmc: nonLands ? cmcSum / nonLands : 0,
  }
}

export const count = (cards: Card[]) => cards.reduce((n, c) => n + c.count, 0)

export const entries = (cards: Card[]): DeckEntry[] => cards.map((c) => ({ name: c.name, count: c.count }))

/** Seven random cards from the deck, expanded by count. */
export function sampleHand(deck: Card[], size = 7): Card[] {
  const library = deck.flatMap((c) => Array.from({ length: c.count }, () => ({ ...c, count: 1 })))
  for (let i = library.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[library[i], library[j]] = [library[j], library[i]]
  }
  return library.slice(0, size)
}
