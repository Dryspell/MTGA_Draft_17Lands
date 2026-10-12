import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Card } from './types'
import { UiContext, type Tab, type UiState } from './ui'

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
