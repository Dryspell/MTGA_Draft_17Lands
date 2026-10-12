import { createContext, useContext, useMemo } from 'react'
import type { Card, DeckVariant } from './types'
import { useApp } from './store'
import type { FormatContext } from './lib/cards'

export type Tab = 'draft' | 'deck' | 'data' | 'settings'

const LEGACY_TABS: Record<string, Tab> = { pool: 'deck', builder: 'deck', custom: 'deck', sealed: 'deck', tiers: 'data', datasets: 'data', compare: 'draft' }

export function storedTab(value: string | null): Tab {
  if (!value) return 'draft'
  if (value in LEGACY_TABS) return LEGACY_TABS[value]
  return ['draft', 'deck', 'data', 'settings'].includes(value) ? (value as Tab) : 'draft'
}

export interface UiState {
  tab: Tab
  setTab: (tab: Tab) => void
  mini: boolean
  setMini: (mini: boolean) => void
  compare: Card[]
  addCompare: (card: Card) => void
  setCompare: (cards: Card[]) => void
  compareOpen: boolean
  setCompareOpen: (open: boolean) => void
  /** Suggested builds for the live draft pool (kept across tab switches). */
  builder: { variants: DeckVariant[]; selected: string | null; running: boolean; message: string; error: string; builtFor: string | null }
  setBuilder: (update: Partial<UiState['builder']>) => void
  /** Practice sealed session shown in the Deck tab instead of the live pool. */
  sealedId: string | null
  setSealedId: (id: string | null) => void
}

export const UiContext = createContext<UiState | null>(null)

export function useUi(): UiState {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUi outside UiProvider')
  return ctx
}

/** Everything needed to render a stat the way the user's Preferences ask for. */
export function useFormat(): FormatContext & { arch: string; cardColors: boolean } {
  const { meta, config, snapshot } = useApp()
  return useMemo(
    () => ({
      resultFormat: config?.settings.result_format ?? 'Percentage',
      metrics: snapshot?.metrics ?? {},
      gradeDeviations: meta?.gradeDeviations ?? {},
      winRateFields: meta?.winRateFields ?? ['gihwr', 'ohwr', 'gpwr', 'gnswr', 'gdwr'],
      arch: snapshot?.filter || 'All Decks',
      cardColors: !!config?.settings.card_colors_enabled,
    }),
    [meta, config, snapshot?.metrics, snapshot?.filter],
  )
}
