import type { ReactNode } from 'react'
import { useUi, type Tab } from '../ui'

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'draft', label: 'Draft', icon: icon(<><rect x="3" y="4" width="9" height="12" rx="1.5" /><path d="M14 6.5 17 7.5l-2.5 9-3-.8" /></>) },
  { id: 'pool', label: 'Card Pool', icon: icon(<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></>) },
  { id: 'builder', label: 'Deck Builder', icon: icon(<><path d="M10 2.5 12 7l4.5.5-3.4 3 1 4.5L10 12.7 5.9 15l1-4.5-3.4-3L8 7z" /></>) },
  { id: 'custom', label: 'Custom Deck', icon: icon(<><path d="M4 16h3l8.5-8.5-3-3L4 13z" /><path d="m11 6 3 3" /></>) },
  { id: 'sealed', label: 'Sealed Studio', icon: icon(<><rect x="3" y="6" width="14" height="10" rx="1.5" /><path d="M7 6V4.5h6V6M3 10h14" /></>) },
  { id: 'compare', label: 'Comparisons', icon: icon(<><path d="M6 3v14M14 3v14M3 7h6M11 13h6" /></>) },
  { id: 'tiers', label: 'Tier Lists', icon: icon(<><path d="M4 5h12M4 10h8M4 15h4" /></>) },
  { id: 'datasets', label: 'Datasets', icon: icon(<><ellipse cx="10" cy="5" rx="6" ry="2.5" /><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></>) },
]

export function Rail() {
  const { tab, setTab } = useUi()
  const item = (t: { id: Tab; label: string; icon: ReactNode }) => (
    <button
      key={t.id}
      onClick={() => setTab(t.id)}
      title={t.label}
      className={`relative flex size-9 items-center justify-center rounded-lg transition-colors ${
        tab === t.id ? 'bg-accent/15 text-accent' : 'text-stone-500 hover:bg-white/5 hover:text-stone-200'
      }`}
    >
      {tab === t.id && <span className="absolute top-2 bottom-2 -left-1.5 w-0.5 rounded-full bg-accent" />}
      {t.icon}
    </button>
  )
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line py-2">
      {TABS.map(item)}
      <div className="flex-1" />
      {item({
        id: 'settings', label: 'Settings',
        icon: icon(<><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>),
      })}
    </nav>
  )
}
