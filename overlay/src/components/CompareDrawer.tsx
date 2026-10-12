import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import { CardTable } from './CardTable'
import { Button, Empty, Input } from './primitives'

/** Card comparison panel that slides over whichever tab is open. */
export function CompareDrawer() {
  const { toast, snapshot } = useApp()
  const { compare, setCompare, compareOpen, setCompareOpen } = useUi()
  const [names, setNames] = useState<string[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (compareOpen) api.cardNames().then(setNames).catch(() => {})
  }, [compareOpen, snapshot?.dataset])

  useEffect(() => {
    if (!compareOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCompareOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compareOpen, setCompareOpen])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return names.filter((n) => n.toLowerCase().includes(q) && !compare.some((c) => c.name === n)).slice(0, 8)
  }, [query, names, compare])

  const add = async (name: string) => {
    const exact = names.find((n) => n.toLowerCase() === name.trim().toLowerCase()) ?? suggestions[0]
    if (!exact) return toast('No card with that name in this dataset', 'error')
    const [card] = await api.lookupCards([exact])
    if (card) setCompare([...compare, card])
    setQuery('')
  }

  return (
    <aside
      aria-hidden={!compareOpen}
      className={`absolute inset-y-0 right-0 z-30 flex w-[min(440px,100%)] flex-col gap-2 border-l border-line bg-surface p-3 shadow-2xl backdrop-blur transition-transform duration-200 ${
        compareOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'
      }`}
    >
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">Compare cards{compare.length ? ` (${compare.length})` : ''}</h2>
        <button onClick={() => setCompareOpen(false)} className="text-stone-500 hover:text-white" title="Close (Esc)">✕</button>
      </div>
      <div className="relative flex items-center gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add(query)}
          placeholder="Search a card to compare…"
          className="flex-1"
          tabIndex={compareOpen ? 0 : -1}
        />
        <Button onClick={() => add(query)} disabled={!query.trim()}>Add</Button>
        <Button variant="ghost" onClick={() => setCompare([])} disabled={!compare.length}>Clear</Button>
        {suggestions.length > 0 && (
          <div className="absolute top-full left-0 z-20 mt-1 w-72 rounded-lg bg-stone-800 py-1 shadow-xl ring-1 ring-white/10">
            {suggestions.map((n) => (
              <button key={n} onClick={() => add(n)} className="block w-full truncate px-3 py-1 text-left text-[12px] text-stone-200 hover:bg-accent/80 hover:text-white">{n}</button>
            ))}
          </div>
        )}
      </div>
      {compare.length ? (
        <CardTable viewId="compare_table" cards={compare} onRowDoubleClick={(c) => setCompare(compare.filter((x) => x.name !== c.name))} rowTitle="Double-click to remove" className="flex-1" />
      ) : (
        <Empty title="Nothing to compare yet">Search for cards above, or right-click any card and choose Compare.</Empty>
      )}
    </aside>
  )
}
