import { useState } from 'react'
import { useBridge } from './bridge'
import { Header } from './components/Header'
import { PackView, Empty } from './components/PackView'
import { PoolView } from './components/PoolView'
import { PreviewProvider } from './components/CardPreview'

type Tab = 'pack' | 'pool'

export default function App() {
  const { connected, status, snapshot } = useBridge()
  const [tab, setTab] = useState<Tab>('pack')

  return (
    <PreviewProvider>
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl backdrop-blur-md">
        <Header snapshot={snapshot} connected={connected} status={status} />

        <nav className="flex gap-1 px-3 pt-2">
          {(['pack', 'pool'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-[12px] capitalize transition-colors ${
                tab === t ? 'bg-white/10 text-white' : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              {t}
              {t === 'pack' && snapshot?.packCards.length ? (
                <span className="ml-1 text-stone-500">{snapshot.packCards.length}</span>
              ) : null}
              {t === 'pool' && snapshot?.poolSize ? <span className="ml-1 text-stone-500">{snapshot.poolSize}</span> : null}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto px-2 py-2">
          {!snapshot ? (
            <Empty>{status}</Empty>
          ) : tab === 'pack' ? (
            <PackView cards={snapshot.packCards} missing={snapshot.missingCards} />
          ) : (
            <PoolView snapshot={snapshot} />
          )}
        </main>
      </div>
    </PreviewProvider>
  )
}
