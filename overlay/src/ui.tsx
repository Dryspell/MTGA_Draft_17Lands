import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Card, DeckVariant } from './types'
import { useApp } from './store'
import type { FormatContext } from './lib/cards'

export type Tab = 'draft' | 'pool' | 'builder' | 'custom' | 'sealed' | 'compare' | 'tiers' | 'datasets' | 'settings'

interface UiState {
  tab: Tab
  setTab: (tab: Tab) => void
  mini: boolean
  setMini: (mini: boolean) => void
  compare: Card[]
  addCompare: (card: Card) => void
  setCompare: (cards: Card[]) => void
  custom: { deck: Card[]; sideboard: Card[] } | null
  setCustom: (custom: { deck: Card[]; sideboard: Card[] } | null) => void
  builder: { variants: DeckVariant[]; selected: string | null; running: boolean; message: string; error: string; builtFor: string | null }
  setBuilder: (update: Partial<UiState['builder']>) => void
  sealedId: string | null
  setSealedId: (id: string | null) => void
}

const UiContext = createContext<UiState | null>(null)

export function useUi(): UiState {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('useUi outside UiProvider')
  return ctx
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>(() => (localStorage.getItem('tab') as Tab) || 'draft')
  const [mini, setMiniState] = useState(() => localStorage.getItem('mini') === '1')
  const [compare, setCompare] = useState<Card[]>([])
  const [custom, setCustom] = useState<UiState['custom']>(null)
  const [builder, setBuilderState] = useState<UiState['builder']>({ variants: [], selected: null, running: false, message: '', error: '', builtFor: null })
  const [sealedId, setSealedId] = useState<string | null>(null)

  const setTab = useCallback((t: Tab) => {
    localStorage.setItem('tab', t)
    setTabState(t)
  }, [])
  const setMini = useCallback((m: boolean) => {
    localStorage.setItem('mini', m ? '1' : '0')
    setMiniState(m)
  }, [])
  const addCompare = useCallback((card: Card) => setCompare((list) => (list.some((c) => c.name === card.name) ? list : [...list, card])), [])
  const setBuilder = useCallback((update: Partial<UiState['builder']>) => setBuilderState((b) => ({ ...b, ...update })), [])

  const value = useMemo(
    () => ({ tab, setTab, mini, setMini, compare, addCompare, setCompare, custom, setCustom, builder, setBuilder, sealedId, setSealedId }),
    [tab, setTab, mini, setMini, compare, addCompare, custom, builder, setBuilder, sealedId],
  )
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>
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
