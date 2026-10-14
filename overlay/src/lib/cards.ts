import type { Card, CardStats, Metrics } from '../types'

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const

export const COLOR_VAR: Record<string, string> = {
  W: 'var(--color-mana-w)',
  U: 'var(--color-mana-u)',
  B: 'var(--color-mana-b)',
  R: 'var(--color-mana-r)',
  G: 'var(--color-mana-g)',
  C: 'var(--color-mana-c)',
}

export const COLOR_LABEL: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' }

export const BASIC_LANDS: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }

export const ALL_DECKS = 'All Decks'

export const WILDCARDS = ['common', 'uncommon', 'rare', 'mythic'] as const
export const RARITY_TONE: Record<string, string> = { common: 'text-stone-300', uncommon: 'text-sky-200', rare: 'text-amber-300', mythic: 'text-orange-400' }

export function cardColors(card: Pick<Card, 'colors' | 'manaCost'>): string[] {
  if (card.colors.length) return card.colors
  return COLORS.filter((c) => card.manaCost.includes(c))
}

export function identityColor(card: Pick<Card, 'colors' | 'manaCost'>): string {
  const colors = cardColors(card)
  if (colors.length > 1) return 'var(--color-mana-gold)'
  return COLOR_VAR[colors[0] ?? 'C']
}

export const isLand = (c: Pick<Card, 'types'>) => c.types.includes('Land')
export const isBasic = (c: Pick<Card, 'name' | 'types'>) => c.name in BASIC_LANDS || c.types.includes('Basic')
export const isCreature = (c: Pick<Card, 'types'>) => c.types.includes('Creature')

/** Stats for an archetype, falling back to All Decks when the card has no data there. */
export function statsFor(card: Card, arch: string): { stats: CardStats; arch: string; fallback: boolean } {
  const own = card.deckColors[arch]
  if (own?.gihwr) return { stats: own, arch, fallback: false }
  const all = card.deckColors[ALL_DECKS] ?? {}
  return { stats: all, arch: ALL_DECKS, fallback: arch !== ALL_DECKS && !!all.gihwr }
}

export function gihwr(card: Card, arch = ALL_DECKS): number {
  return statsFor(card, arch).stats.gihwr ?? 0
}

export interface FormatContext {
  resultFormat: string
  metrics: Metrics
  gradeDeviations: Record<string, number>
  winRateFields: string[]
}

/** Port of card_logic.format_win_rate. */
export function formatStat(value: number | undefined, field: string, arch: string, ctx: FormatContext): string {
  if (!value) return '-'
  if (ctx.resultFormat === 'Percentage' || !ctx.winRateFields.includes(field)) return value.toFixed(1)
  const [mean, std] = ctx.metrics[arch]?.[field] ?? [0, 0]
  if (!std) return value.toFixed(1)
  const z = (value - mean) / std
  if (ctx.resultFormat === 'Grade') {
    for (const [grade, limit] of Object.entries(ctx.gradeDeviations)) if (z >= limit) return grade
    return 'F'
  }
  const upper = mean + 2 * std
  const lower = mean - 1.67 * std
  if (upper === lower) return '2.5'
  return Math.max(0, Math.min(5, ((value - lower) / (upper - lower)) * 5)).toFixed(1)
}

export function gradeFor(value: number | undefined, arch: string, ctx: FormatContext): string | null {
  if (!value) return null
  return formatStat(value, 'gihwr', arch, { ...ctx, resultFormat: 'Grade' })
}

export function gradeTone(grade: string | null): string {
  if (!grade || grade === '-') return 'bg-white/5 text-stone-500'
  switch (grade[0]) {
    case 'A':
      return 'bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30'
    case 'B':
      return 'bg-lime-400/10 text-lime-300 ring-1 ring-lime-400/20'
    case 'C':
      return 'bg-amber-400/10 text-amber-300'
    case 'D':
      return 'bg-orange-500/10 text-orange-400'
    default:
      return 'bg-red-500/10 text-red-400'
  }
}

export function parseManaCost(cost: string): string[] {
  return Array.from(cost.matchAll(/\{([^}]+)\}/g), (m) => m[1])
}

export function tagIcon(tag: string, visuals: Record<string, string>): string {
  return (visuals[tag] ?? tag).split(' ')[0]
}

export function tagLabel(tag: string, visuals: Record<string, string>): string {
  return visuals[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1)
}

export const scryfallUrl = (name: string) => `https://scryfall.com/search?q=${encodeURIComponent(name)}`

export function sortByCmc<T extends Pick<Card, 'cmc' | 'name'>>(cards: T[]): T[] {
  return [...cards].sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name))
}

export function basicCard(name: string, count = 1): Card {
  const color = BASIC_LANDS[name]
  return {
    name, manaCost: '', colors: color ? [color] : [], types: ['Land', 'Basic'], subtypes: [], rarity: 'basic',
    cmc: 0, images: [], tags: [], count, returnableAt: [], deckColors: {}, tiers: {}, recommendation: null,
  }
}
