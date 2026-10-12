import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { Card } from '../types'
import { CardInteractionsContext } from './cardInteractions'
import { useApp } from '../store'
import { useUi } from '../ui'
import { ALL_DECKS, isBasic, scryfallUrl, tagLabel } from '../lib/cards'
import { copyText, openUrl } from '../lib/platform'

interface Hover {
  card: Card
  rect: DOMRect
}

interface Menu {
  card: Card
  x: number
  y: number
}

const PANEL_W = 236

export function CardInteractionsProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<Hover | null>(null)
  const [menuState, setMenu] = useState<Menu | null>(null)

  const hover = useCallback((card: Card | null, el?: HTMLElement) => {
    setHovered(card && el && !isBasic(card) ? { card, rect: el.getBoundingClientRect() } : null)
  }, [])
  const menu = useCallback((card: Card, e: MouseEvent) => {
    e.preventDefault()
    setHovered(null)
    setMenu({ card, x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!menuState) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menuState])

  const value = useMemo(() => ({ hover, menu }), [hover, menu])
  return (
    <CardInteractionsContext.Provider value={value}>
      {children}
      {hovered && <HoverPanel {...hovered} />}
      {menuState && <ContextMenu {...menuState} close={() => setMenu(null)} />}
    </CardInteractionsContext.Provider>
  )
}

const RARITY_TONE: Record<string, string> = { mythic: 'text-orange-400', rare: 'text-yellow-400', uncommon: 'text-sky-300' }

function HoverPanel({ card, rect }: Hover) {
  const { meta, config } = useApp()
  const showImage = config?.features.images_enabled !== false && card.images.length > 0
  const all = card.deckColors[ALL_DECKS] ?? {}
  const archetypes = Object.entries(card.deckColors)
    .filter(([k, s]) => k !== ALL_DECKS && (s.gihwr ?? 0) > 0)
    .sort((a, b) => (b[1].samples ?? b[1].gih ?? 0) - (a[1].samples ?? a[1].gih ?? 0))
    .slice(0, 10)

  const panel = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const vw = window.innerWidth
  const vh = window.innerHeight
  const placeRight = rect.right + PANEL_W + 8 <= vw
  const placeLeft = rect.left - PANEL_W - 8 >= 0
  const left = placeRight ? rect.right + 6 : placeLeft ? rect.left - PANEL_W - 6 : vw - PANEL_W - 8
  const top = Math.max(6, Math.min(rect.top - 40, vh - height - 6))

  const pct = (v?: number, signed = false) => (v ? `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%` : '-')
  const num = (v?: number) => (v ? (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)) : '-')
  const rarity = (card.rarity || 'common').toLowerCase()

  return (
    <div
      ref={panel}
      className="pointer-events-none fixed z-50 max-h-[calc(100vh-12px)] overflow-hidden rounded-lg bg-stone-900/98 shadow-2xl shadow-black/70 ring-1 ring-accent/40"
      style={{ left, top, width: PANEL_W, visibility: height ? 'visible' : 'hidden' }}
    >
      <div className="flex items-baseline justify-between gap-2 bg-white/5 px-3 py-1.5">
        <span className="truncate font-semibold text-white">{card.name}</span>
        <span className={`text-[10px] font-semibold capitalize ${RARITY_TONE[rarity] ?? 'text-stone-400'}`}>{rarity}</span>
      </div>
      {showImage && <img src={card.images[0]} alt="" className="block w-full" style={{ aspectRatio: '488 / 680' }} />}
      <div className="flex flex-col gap-2 p-3 text-[11px]">
        <div>
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-accent uppercase">Global performance</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <Row label="GIH WR" value={pct(all.gihwr)} good={(all.gihwr ?? 0) >= 55} />
            <Row label="IWD" value={pct(all.iwd, true)} good={(all.iwd ?? 0) >= 3} />
            <Row label="ALSA" value={num(all.alsa)} />
            <Row label="ATA" value={num(all.ata)} />
            <Row label="Games" value={num(all.samples ?? all.gih)} />
          </div>
        </div>
        {archetypes.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold tracking-wider text-emerald-300 uppercase">Archetype play share</div>
            {archetypes.map(([k, s]) => (
              <div key={k} className="flex justify-between">
                <span className="truncate text-stone-400">{meta?.colorNames[k] ?? k} ({k})</span>
                <span className={`tabular font-semibold ${(s.gihwr ?? 0) >= 55 ? 'text-emerald-300' : 'text-stone-200'}`}>{s.gihwr?.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        )}
        {card.tags.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-semibold tracking-wider text-amber-300 uppercase">Card roles</div>
            <div className="text-stone-300">{card.tags.map((t) => tagLabel(t, meta?.tagVisuals ?? {})).join('   ')}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex justify-between gap-1">
      <span className="text-stone-500">{label}</span>
      <span className={`tabular font-semibold ${good ? 'text-emerald-300' : 'text-stone-200'}`}>{value}</span>
    </div>
  )
}

function ContextMenu({ card, x, y, close }: Menu & { close: () => void }) {
  const { addCompare, setCompareOpen } = useUi()
  const { toast } = useApp()
  const items: [string, () => void][] = [
    [`Compare "${card.name}"`, () => { addCompare(card); setCompareOpen(true) }],
    ['Copy name', () => copyText(card.name).then(() => toast('Copied card name', 'success'))],
    ['View on Scryfall', () => openUrl(scryfallUrl(card.name))],
  ]
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - items.length * 28 - 12)
  return (
    <div
      className="fixed z-50 min-w-44 rounded-md bg-stone-800 py-1 shadow-xl ring-1 ring-white/10"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map(([label, fn]) => (
        <button
          key={label}
          onClick={() => { fn(); close() }}
          className="block w-full truncate px-3 py-1 text-left text-[12px] text-stone-200 hover:bg-accent/80 hover:text-white"
        >
          {label}
        </button>
      ))}
    </div>
  )
}
