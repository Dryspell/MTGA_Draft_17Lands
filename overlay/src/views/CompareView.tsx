import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import { CardTable } from '../components/CardTable'
import { Button, Empty, Input } from '../components/primitives'

export function CompareView() {
  const { toast, snapshot } = useApp()
  const { compare, setCompare } = useUi()
  const [names, setNames] = useState<string[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    api.cardNames().then(setNames).catch(() => {})
  }, [snapshot?.dataset])

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
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative flex items-center gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add(query)}
          placeholder="Search a card to compare…"
          className="flex-1"
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
    </div>
  )
}
