import type { ReactNode } from 'react'
import { useApp } from '../store'
import { useUi, type Tab } from '../ui'

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
)

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'draft', label: 'Draft', icon: icon(<><rect x="3" y="4" width="9" height="12" rx="1.5" /><path d="M14 6.5 17 7.5l-2.5 9-3-.8" /></>) },
  { id: 'game', label: 'Game: live analysis & history', icon: icon(<><path d="M4 3.5 12.5 12M3.5 3.5h3v3M16 3.5 7.5 12M16.5 3.5h-3v3" /><path d="m5.5 12.5 2 2M14.5 12.5l-2 2M4 16l2.5-2.5M16 16l-2.5-2.5" /></>) },
  { id: 'deck', label: 'Deck', icon: icon(<><rect x="3" y="6" width="8" height="11" rx="1.2" /><path d="M6 6V4.2A1.2 1.2 0 0 1 7.2 3h6.6A1.2 1.2 0 0 1 15 4.2v8.6a1.2 1.2 0 0 1-1.2 1.2H11" /><path d="M14.5 7h1.3A1.2 1.2 0 0 1 17 8.2v6.6" /></>) },
  { id: 'data', label: 'Data: 17Lands datasets & tier lists', icon: icon(<><ellipse cx="10" cy="5" rx="6" ry="2.5" /><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></>) },
]

const base = 'relative flex size-9 items-center justify-center rounded-lg transition-colors'
const idle = 'text-stone-500 hover:bg-white/5 hover:text-stone-200'

export function Rail() {
  const { tab, setTab, compare, compareOpen, setCompareOpen } = useUi()
  const { game } = useApp()
  const item = (t: { id: Tab; label: string; icon: ReactNode }) => (
    <button key={t.id} onClick={() => setTab(t.id)} title={t.label} className={`${base} ${tab === t.id ? 'bg-accent/15 text-accent' : idle}`}>
      {tab === t.id && <span className="absolute top-2 bottom-2 -left-1.5 w-0.5 rounded-full bg-accent" />}
      {t.icon}
      {t.id === 'game' && game?.active && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-emerald-400" title="Game in progress" />}
    </button>
  )
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line py-2">
      {TABS.map(item)}
      <div className="flex-1" />
      <button
        onClick={() => setCompareOpen(!compareOpen)}
        title="Compare cards"
        className={`${base} ${compareOpen ? 'bg-accent/15 text-accent' : idle}`}
      >
        {icon(<><path d="M6 3v14M14 3v14M3 7h6M11 13h6" /></>)}
        {compare.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] leading-4 font-bold text-[#fff]">{compare.length}</span>
        )}
      </button>
      {item({
        id: 'settings', label: 'Settings',
        icon: icon(<><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>),
      })}
    </nav>
  )
}
