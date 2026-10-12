import { useEffect, useRef } from 'react'
import { AppProvider } from './AppProvider'
import { UiProvider } from './UiProvider'
import { useApp } from './store'
import { useUi } from './ui'
import { applyTheme } from './lib/theme'
import { inTauri, setAlwaysOnTop, setWindowSize, windowSize } from './lib/platform'
import { CardInteractionsProvider } from './components/CardHover'
import { TitleBar } from './components/TitleBar'
import { TopBar } from './components/TopBar'
import { Rail } from './components/Rail'
import { Toasts } from './components/Toasts'
import { CompareDrawer } from './components/CompareDrawer'
import { DraftView } from './views/DraftView'
import { DeckView } from './views/DeckView'
import { DataView } from './views/DataView'
import { SettingsView } from './views/SettingsView'
import { MiniView } from './views/MiniView'

const VIEWS = {
  draft: DraftView,
  deck: DeckView,
  data: DataView,
  settings: SettingsView,
}

const MINI_SIZE = { width: 340, height: 560 }
const FULL_SIZE = { width: 900, height: 780 }

function useWindowEffects() {
  const { config } = useApp()
  const { mini } = useUi()
  const settings = config?.settings
  const firstMini = useRef(true)

  useEffect(
    () => applyTheme(settings?.theme_palette, settings?.ui_size, settings?.theme === 'Light'),
    [settings?.theme_palette, settings?.ui_size, settings?.theme],
  )

  const onTop = settings?.always_on_top
  useEffect(() => {
    if (onTop !== undefined) setAlwaysOnTop(onTop)
  }, [onTop])

  useEffect(() => {
    if (!inTauri) return
    if (firstMini.current) {
      firstMini.current = false
      return
    }
    const key = mini ? 'size-full' : 'size-mini'
    windowSize().then((size) => {
      if (size) localStorage.setItem(key, JSON.stringify(size))
      const saved = localStorage.getItem(mini ? 'size-mini' : 'size-full')
      const target = saved ? JSON.parse(saved) : mini ? MINI_SIZE : FULL_SIZE
      setWindowSize(target.width, target.height, mini ? 260 : 380, mini ? 220 : 320)
    })
  }, [mini])
}

function Shell() {
  const { tab, mini } = useUi()
  useWindowEffects()
  const View = VIEWS[tab] ?? DraftView

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-surface ring-1 ring-white/10">
      <TitleBar />
      {mini ? (
        <main className="min-h-0 flex-1 overflow-hidden p-2">
          <MiniView />
        </main>
      ) : (
        <div className="flex min-h-0 flex-1">
          <Rail />
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <TopBar />
            <main className="min-h-0 flex-1 overflow-y-auto p-3">
              <View />
            </main>
            <CompareDrawer />
          </div>
        </div>
      )}
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <UiProvider>
        <CardInteractionsProvider>
          <Shell />
        </CardInteractionsProvider>
      </UiProvider>
    </AppProvider>
  )
}
