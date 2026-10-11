import { useEffect, useState } from 'react'
import { api, type FilterOptions } from '../bridge'
import type { Snapshot } from '../types'
import { Signals } from './Signals'
import { WindowControls } from './WindowControls'

interface Props {
  snapshot: Snapshot | null
  connected: boolean
  status: string
}

const EVENT_LABEL: Record<string, string> = {
  PremierDraft: 'Premier',
  TradDraft: 'Traditional',
  QuickDraft: 'Quick',
  Sealed: 'Sealed',
  TradSealed: 'Trad Sealed',
}

export function Header({ snapshot, connected, status }: Props) {
  const [filters, setFilters] = useState<FilterOptions | null>(null)

  useEffect(() => {
    if (!connected) return
    api.filters().then(setFilters).catch(() => {})
  }, [connected, snapshot?.dataset])

  const onFilter = async (value: string) => {
    setFilters((f) => (f ? { ...f, current: value } : f))
    await api.setFilter(value)
  }

  const live = snapshot && snapshot.pack > 0
  const autoLabel = snapshot && filters?.current === 'Auto' ? ` → ${snapshot.filter}` : ''

  return (
    <header data-tauri-drag-region className="flex items-center gap-3 border-b border-line px-3 py-2">
      <div data-tauri-drag-region className="min-w-0 flex-1">
        <div data-tauri-drag-region className="flex items-baseline gap-2">
          {snapshot?.event.set ? (
            <>
              <span className="font-semibold text-white">{snapshot.event.set}</span>
              <span className="text-[11px] text-stone-400">
                {EVENT_LABEL[snapshot.event.type] ?? snapshot.event.type}
              </span>
            </>
          ) : (
            <span className="text-stone-400">No event</span>
          )}
        </div>
        <div data-tauri-drag-region className="flex items-center gap-1.5 text-[11px]">
          <span
            className={`size-1.5 rounded-full ${connected ? (live ? 'bg-emerald-400' : 'bg-stone-500') : 'bg-red-500'}`}
          />
          <span className={live ? 'tabular text-stone-200' : 'text-stone-500'}>
            {live ? `Pack ${snapshot.pack} · Pick ${snapshot.pick}` : status}
          </span>
          {snapshot && !snapshot.isLiveLog && <span className="text-amber-400/80">· past draft</span>}
        </div>
      </div>

      {snapshot && <Signals signals={snapshot.signals} />}

      <div className="flex items-center gap-1">
        {filters && (
          <select
            value={filters.current ?? 'Auto'}
            onChange={(e) => onFilter(e.target.value)}
            className="max-w-28 cursor-pointer rounded bg-white/5 px-1.5 py-1 text-[11px] text-stone-300 outline-none hover:bg-white/10"
            title="Archetype used for win rates"
          >
            {Object.entries(filters.options).map(([label, value]) => (
              <option key={value} value={value} className="bg-stone-900">
                {value === 'Auto' ? `Auto${autoLabel}` : label}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => api.reload()}
          className="rounded px-1.5 py-1 text-stone-400 hover:bg-white/10 hover:text-white"
          title="Rescan Arena log"
        >
          ⟳
        </button>
        <WindowControls />
      </div>
    </header>
  )
}
