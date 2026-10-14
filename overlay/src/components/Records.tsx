import type { WinLoss } from '../types'
import { COLOR_VAR } from '../lib/cards'

const winRate = (r: WinLoss) => (r.wins + r.losses ? r.wins / (r.wins + r.losses) : 0)

export function Pips({ colors }: { colors: string[] }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {colors.map((c) => <span key={c} className="size-2.5 rounded-full ring-1 ring-black/30" style={{ background: COLOR_VAR[c] }} />)}
    </span>
  )
}

export function WinLossText({ r, className = '' }: { r: WinLoss; className?: string }) {
  if (!r.games) return <span className={`text-stone-600 ${className}`}>no games</span>
  const tone = winRate(r) >= 0.55 ? 'text-emerald-300' : winRate(r) < 0.45 ? 'text-red-300' : 'text-stone-300'
  return <span className={`tabular ${tone} ${className}`}>{r.wins}–{r.losses}</span>
}

export function Breakdown({ title, rows }: { title: string; rows: (WinLoss & { key: string; label?: string })[] }) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-stone-300">{r.label ?? r.key}</span>
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-red-400/30"><span className="block h-full bg-emerald-400/70" style={{ width: `${Math.round(winRate(r) * 100)}%` }} /></span>
          <WinLossText r={r} className="w-10 text-right" />
        </div>
      ))}
    </div>
  )
}
