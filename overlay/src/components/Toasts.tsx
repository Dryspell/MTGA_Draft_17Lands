import { useApp } from '../store'

const TONE = {
  info: 'bg-stone-800 text-stone-100 ring-white/10',
  success: 'bg-emerald-900/95 text-emerald-100 ring-emerald-500/30',
  error: 'bg-red-950/95 text-red-100 ring-red-500/30',
}

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 left-3 z-50 flex flex-col items-end gap-1.5">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto max-w-sm rounded-lg px-3 py-2 text-left text-[12px] shadow-xl ring-1 ${TONE[t.tone]}`}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}
