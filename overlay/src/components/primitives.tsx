import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { useApp } from '../store'

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent/90 text-white hover:bg-accent',
  subtle: 'bg-white/[0.06] text-stone-200 hover:bg-white/10',
  ghost: 'text-stone-400 hover:bg-white/10 hover:text-white',
  danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25',
}

export function Button({
  variant = 'subtle', className = '', busy, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={`cursor-pointer rounded-md bg-white/[0.06] px-2 py-1 text-[12px] text-stone-200 outline-none hover:bg-white/10 focus:ring-1 focus:ring-accent/60 disabled:opacity-40 [&>option]:bg-stone-900 [&>optgroup]:bg-stone-900 ${className}`}
    >
      {children}
    </select>
  )
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`rounded-md bg-white/[0.06] px-2 py-1 text-[12px] text-stone-100 outline-none placeholder:text-stone-500 focus:ring-1 focus:ring-accent/60 ${className}`}
    />
  )
}

export function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1 text-[12px] text-stone-200" title={hint}>
      <span
        className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] ring-1 transition-colors ${
          checked ? 'bg-accent ring-accent' : 'bg-white/5 ring-white/20'
        }`}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m2.5 6 2.5 2.5 4.5-5" />
          </svg>
        )}
      </span>
      <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md bg-white/5 p-0.5 text-[11px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-0.5 whitespace-nowrap transition-colors ${
            value === o.value ? 'bg-white/10 text-white' : 'text-stone-400 hover:text-stone-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ className = 'size-3' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} />
}

export function Progress({ value, message }: { value: number | null; message?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full bg-accent transition-[width] ${value === null ? 'w-1/3 animate-pulse' : ''}`}
          style={value === null ? undefined : { width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
      {message && <span className="truncate text-[11px] text-stone-400">{message}</span>}
    </div>
  )
}

export function Empty({ title, children, action }: { title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {title && <div className="text-[13px] font-medium text-stone-300">{title}</div>}
      {children && <div className="max-w-80 text-[12px] text-stone-500">{children}</div>}
      {action}
    </div>
  )
}

/** Collapsible panel whose open state is persisted in settings.collapsible_states. */
export function Section({
  id, title, right, children, defaultOpen = true, className = '',
}: { id?: string; title: ReactNode; right?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const { config, patchSettings } = useApp()
  const states = config?.settings.collapsible_states ?? {}
  const open = id ? states[id] ?? defaultOpen : true
  const toggle = () => id && patchSettings({ collapsible_states: { ...states, [id]: !open } })
  return (
    <section className={`rounded-lg bg-panel ${className}`}>
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={toggle}
          disabled={!id}
          className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-semibold tracking-wider text-stone-400 uppercase disabled:cursor-default"
        >
          {id && <span className={`text-[9px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>}
          {title}
        </button>
        {right}
      </header>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}

export function Modal({ title, onClose, children, footer, width = 'max-w-md' }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className={`flex max-h-full w-full ${width} flex-col rounded-xl bg-stone-900 shadow-2xl ring-1 ring-white/10`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-white">✕</button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</footer>}
      </div>
    </div>
  )
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>{children}</div>
}

export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: 'good' | 'fair' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'fair' ? 'text-amber-300' : 'text-stone-100'
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12px]">
      <span className="text-stone-400">{label}</span>
      <span className={`tabular font-semibold ${color}`}>{value}</span>
    </div>
  )
}
