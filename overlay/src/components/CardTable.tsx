import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Card } from '../types'
import { useApp } from '../store'
import { useFormat } from '../ui'
import { formatStat, gradeTone, identityColor, statsFor, tagIcon, cardColors, COLOR_VAR } from '../lib/cards'
import { ManaCost } from './ManaCost'
import { useCardProps } from './cardInteractions'

const STAT_FIELDS = ['gihwr', 'ohwr', 'gpwr', 'gnswr', 'gdwr', 'iwd', 'alsa', 'ata']
const BASE_FIELDS = ['value', ...STAT_FIELDS, 'wheel', 'colors', 'count', 'tags']
const MAX_COLUMNS = 15

const SHORT: Record<string, string> = {
  name: 'Card', value: 'Value', gihwr: 'GIH', ohwr: 'OH', gpwr: 'GP', gnswr: 'GNS', gdwr: 'GD',
  iwd: 'IWD', alsa: 'ALSA', ata: 'ATA', wheel: 'Wheel', colors: 'Colors', count: '#', tags: 'Tags',
}
const EXTRA_LABELS: Record<string, string> = {
  gnswr: 'GNS WR: Games Not Seen Win Rate',
  gdwr: 'GD WR: Games Drawn Win Rate',
}
const WIDTH: Record<string, string> = { tags: '64px', colors: '52px', count: '28px', value: '48px', wheel: '44px' }
const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']

const DEFAULT_COLUMNS: Record<string, string[]> = {
  pack_table: ['name', 'value', 'gihwr'],
  missing_table: ['name', 'alsa'],
  taken_table: ['name', 'count', 'gihwr'],
  compare_table: ['name', 'gihwr', 'iwd'],
  overlay_table: ['name', 'value', 'gihwr'],
  overlay_pool_table: ['name', 'count', 'gihwr'],
}
for (const id of ['suggest_deck_table', 'suggest_sb_table', 'custom_deck_table', 'custom_sb_table', 'sealed_deck_table', 'sealed_pool_table']) {
  DEFAULT_COLUMNS[id] = ['name', 'count', 'cmc', 'gihwr']
}

function sortGroupOf(viewId: string) {
  if (viewId === 'pack_table' || viewId === 'overlay_table') return 'pack'
  if (viewId === 'taken_table' || viewId === 'overlay_pool_table') return 'pool'
  return viewId
}

interface Props {
  viewId: string
  cards: Card[]
  /** Archetype for stats; defaults to the resolved deck filter. */
  arch?: string
  pickedNames?: string[]
  highlightBest?: boolean
  showReasons?: boolean
  extraFields?: string[]
  onRowClick?: (card: Card) => void
  onRowDoubleClick?: (card: Card) => void
  /** Makes rows draggable. */
  onRowDragStart?: (card: Card, e: DragEvent) => void
  rowTitle?: string
  empty?: ReactNode
  toolbar?: ReactNode
  className?: string
}

export function CardTable({
  viewId, cards, arch: archProp, pickedNames, highlightBest, showReasons, extraFields = [],
  onRowClick, onRowDoubleClick, onRowDragStart, rowTitle, empty, toolbar, className = '',
}: Props) {
  const { config, snapshot, meta, patchSettings } = useApp()
  const fmt = useFormat()
  const arch = archProp ?? fmt.arch
  const tierOptions = useMemo(() => snapshot?.tierOptions ?? {}, [snapshot?.tierOptions])
  const settings = config?.settings
  const columns = (settings?.column_configs[viewId] ?? DEFAULT_COLUMNS[viewId] ?? ['name', 'gihwr']).filter(
    (f) => f === 'name' || BASE_FIELDS.includes(f) || extraFields.includes(f) || f in tierOptions,
  )
  const group = sortGroupOf(viewId)
  const hasRecs = cards.some((c) => c.recommendation)
  const sort = settings?.table_sort_states[group] ?? { column: hasRecs ? 'value' : 'gihwr', reverse: true }

  const setSort = (column: string) => {
    const reverse = sort.column === column ? !sort.reverse : column !== 'name'
    patchSettings({ table_sort_states: { ...settings?.table_sort_states, [group]: { column, reverse } } })
  }
  const setColumns = (next: string[]) => patchSettings({ column_configs: { ...settings?.column_configs, [viewId]: next } })

  const best = useMemo(() => {
    if (!highlightBest) return null
    return cards.reduce<Card | null>((top, c) => ((c.recommendation?.score ?? -1) > (top?.recommendation?.score ?? -1) ? c : top), null)
  }, [cards, highlightBest])
  const maxScore = best?.recommendation?.score ?? 0

  const sorted = useMemo(() => {
    const value = (c: Card): number | string => {
      const col = sort.column
      if (col === 'name') return c.name
      if (col === 'value') return c.recommendation?.score ?? -1
      if (col === 'wheel') return c.recommendation?.wheelChance ?? -1
      if (col === 'count') return c.count
      if (col === 'cmc') return c.cmc
      if (col === 'colors') return cardColors(c).join('')
      if (col === 'tags') return c.tags.length
      if (col in tierOptions) {
        const i = GRADE_ORDER.indexOf((c.tiers[col] ?? '').trim())
        return i < 0 ? -1 : GRADE_ORDER.length - i
      }
      return statsFor(c, arch).stats[col as 'gihwr'] ?? 0
    }
    const dir = sort.reverse ? -1 : 1
    return [...cards].sort((a, b) => {
      const va = value(a), vb = value(b)
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)
      return cmp * dir || a.name.localeCompare(b.name)
    })
  }, [cards, sort.column, sort.reverse, arch, tierOptions])

  const headerDrag = useColumnDrag(columns, setColumns)
  const template = columns.map((c) => (c === 'name' ? 'minmax(110px,1fr)' : WIDTH[c] ?? '42px')).join(' ')
  const label = (f: string) => (f in tierOptions ? tierOptions[f] : SHORT[f] ?? f.toUpperCase())

  const fieldLabels = useMemo(() => {
    const out: [string, string][] = [...BASE_FIELDS, ...extraFields].map((f) => [f, meta?.columnLabels[f] ?? EXTRA_LABELS[f] ?? f])
    for (const [k, v] of Object.entries(tierOptions)) out.push([k, `${k}: ${v}`])
    return out
  }, [meta, tierOptions, extraFields])

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="flex items-center gap-1.5 pb-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{toolbar}</div>
        <ColumnPicker columns={columns} fields={fieldLabels} onChange={setColumns} />
      </div>
      <div className="grid items-center gap-x-1.5 border-b border-line px-1 pb-1 text-[10px] font-semibold tracking-wide text-stone-500 uppercase" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => (
          <button
            key={c}
            {...headerDrag.props(c)}
            onClick={() => setSort(c)}
            title={`${c in tierOptions ? tierOptions[c] : meta?.columnLabels[c] ?? EXTRA_LABELS[c] ?? ''}${c === 'name' ? '' : ' (drag to reorder)'}`}
            className={`truncate rounded-sm hover:text-stone-200 ${c === 'name' ? 'pl-2 text-left' : 'text-right'} ${sort.column === c ? 'text-stone-200' : ''} ${headerDrag.style(c)}`}
          >
            {label(c)}
            {sort.column === c && <span className="ml-0.5">{sort.reverse ? '▾' : '▴'}</span>}
          </button>
        ))}
      </div>
      {cards.length === 0 ? (
        empty ?? <div className="py-6 text-center text-[12px] text-stone-500">No cards</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-0.5">
          {sorted.map((card) => (
            <Row
              key={card.name}
              card={card}
              columns={columns}
              template={template}
              arch={arch}
              picked={pickedNames?.includes(card.name)}
              best={card === best}
              strength={maxScore > 0 ? Math.max(0, card.recommendation?.score ?? 0) / maxScore : 0}
              showReasons={showReasons}
              onClick={onRowClick}
              onDoubleClick={onRowDoubleClick}
              onDragStart={onRowDragStart}
              title={rowTitle}
              tierOptions={tierOptions}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Row({
  card, columns, template, arch, picked, best, strength, showReasons, onClick, onDoubleClick, onDragStart, title, tierOptions,
}: {
  card: Card; columns: string[]; template: string; arch: string; picked?: boolean; best?: boolean; strength: number
  showReasons?: boolean; onClick?: (c: Card) => void; onDoubleClick?: (c: Card) => void
  onDragStart?: (c: Card, e: DragEvent) => void; title?: string; tierOptions: Record<string, string>
}) {
  const fmt = useFormat()
  const { meta } = useApp()
  const props = useCardProps(card)
  const rec = card.recommendation
  const { stats, arch: statArch, fallback } = statsFor(card, arch)

  let tone = 'hover:bg-white/5'
  if (picked) tone = 'bg-emerald-600/25 ring-1 ring-emerald-500/40'
  else if (best) tone = 'bg-accent/10 ring-1 ring-accent/50'
  else if (!fmt.cardColors && rec?.isElite) tone = 'bg-amber-400/[0.07] hover:bg-amber-400/10'
  else if (!fmt.cardColors && rec?.archetypeFit === 'High') tone = 'bg-sky-400/[0.05] hover:bg-sky-400/10'
  const tint = fmt.cardColors && !picked ? { background: `color-mix(in srgb, ${identityColor(card)} 12%, transparent)` } : undefined

  const cell = (f: string): ReactNode => {
    switch (f) {
      case 'name':
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="h-6 w-[3px] shrink-0 rounded-r" style={{ background: identityColor(card) }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                {rec?.isElite && <span title="Elite pick">⭐</span>}
                {!rec?.isElite && rec?.archetypeFit === 'High' && <span className="text-[10px] text-sky-300" title="High archetype fit">[+]</span>}
                <span className={`truncate ${best ? 'font-semibold text-white' : 'text-stone-200'}`}>{card.name}</span>
                {card.returnableAt.length > 0 && (
                  <span className="shrink-0 text-[10px] text-sky-300/80" title={`Can return at pick ${card.returnableAt.join(', ')}`}>
                    ⟳{card.returnableAt.join(',')}
                  </span>
                )}
              </div>
              {showReasons && rec?.reasoning.length ? (
                <div className="truncate text-[10px] text-stone-500">{rec.reasoning.slice(0, best ? 3 : 1).join(' · ')}</div>
              ) : null}
            </div>
            <ManaCost cost={card.manaCost} />
          </div>
        )
      case 'value':
        return rec ? (
          <div className="relative text-right">
            <span className="absolute inset-y-0.5 right-0 rounded-sm bg-accent/20" style={{ width: `${Math.max(8, strength * 100)}%` }} />
            <span className="tabular relative">{rec.score.toFixed(0)}</span>
          </div>
        ) : '-'
      case 'wheel':
        return rec && rec.wheelChance > 0 ? `${rec.wheelChance.toFixed(0)}%` : '-'
      case 'colors':
        return (
          <span className="inline-flex justify-end gap-0.5">
            {cardColors(card).map((c) => <span key={c} className="size-2.5 rounded-full" style={{ background: COLOR_VAR[c] }} />)}
          </span>
        )
      case 'count':
        return card.count
      case 'cmc':
        return card.cmc
      case 'tags':
        return card.tags.length ? <span title={card.tags.join(', ')}>{card.tags.map((t) => tagIcon(t, meta?.tagVisuals ?? {})).join(' ')}</span> : '-'
      default: {
        if (f in tierOptions) return card.tiers[f] ?? 'NA'
        const text = formatStat(stats[f as 'gihwr'], f, statArch, fmt)
        if (fmt.resultFormat === 'Grade' && fmt.winRateFields.includes(f) && text !== '-') {
          return <span className={`inline-block min-w-7 rounded px-1 text-center text-[11px] font-semibold ${gradeTone(text)} ${fallback ? 'opacity-60' : ''}`}>{text}</span>
        }
        return <span className={fallback ? 'text-stone-500' : ''} title={fallback ? 'No data for this archetype; showing All Decks' : undefined}>{text}</span>
      }
    }
  }

  return (
    <div
      {...props}
      onClick={onClick && (() => onClick(card))}
      onDoubleClick={onDoubleClick && (() => onDoubleClick(card))}
      draggable={!!onDragStart}
      onDragStart={(e) => { props.onDragStart(); onDragStart?.(card, e) }}
      title={title}
      style={{ gridTemplateColumns: template, ...tint }}
      className={`grid items-center gap-x-1.5 rounded-md py-1 pr-1 text-[12px] transition-colors ${tone} ${onClick || onDoubleClick ? 'cursor-pointer' : ''}`}
    >
      {columns.map((f) => (
        <div key={f} className={`tabular min-w-0 ${f === 'name' ? '' : 'text-right text-stone-300'}`}>{cell(f)}</div>
      ))}
    </div>
  )
}

/** The name column is pinned first; everything else can be dragged around it. */
function moveColumn(columns: string[], from: string, to: string): string[] {
  if (from === to || from === 'name' || to === 'name') return columns
  const next = columns.filter((c) => c !== from)
  const at = next.indexOf(to)
  next.splice(columns.indexOf(from) < columns.indexOf(to) ? at + 1 : at, 0, from)
  return next
}

/** HTML5 drag handlers for reordering columns, shared by the header and the picker. */
function useColumnDrag(columns: string[], onChange: (cols: string[]) => void) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const props = (f: string) =>
    f === 'name'
      ? {}
      : {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', f)
            setDragging(f)
          },
          onDragOver: (e: DragEvent) => {
            if (!dragging) return
            e.preventDefault()
            setOver(f)
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            if (dragging) onChange(moveColumn(columns, dragging, f))
            setDragging(null)
            setOver(null)
          },
          onDragEnd: () => {
            setDragging(null)
            setOver(null)
          },
        }
  const style = (f: string) => (dragging === f ? 'opacity-40' : over === f && dragging ? 'bg-accent/20' : '')
  return { props, style }
}

function ColumnPicker({ columns, fields, onChange }: { columns: string[]; fields: [string, string][]; onChange: (cols: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const toggle = (f: string) => {
    if (columns.includes(f)) onChange(columns.filter((c) => c !== f))
    else if (columns.length < MAX_COLUMNS) onChange([...columns, f])
  }
  const drag = useColumnDrag(columns, onChange)

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded px-1.5 py-0.5 text-[11px] text-stone-500 hover:bg-white/10 hover:text-white" title="Choose columns">
        ⚙ Columns
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-64 rounded-lg bg-stone-800 p-2 shadow-xl ring-1 ring-white/10">
          <div className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Shown ({columns.length}/{MAX_COLUMNS})</div>
          {columns.slice(1).map((f) => (
            <div key={f} {...drag.props(f)} className={`flex cursor-grab items-center gap-1 rounded px-1 py-0.5 text-[12px] hover:bg-white/5 ${drag.style(f)}`}>
              <span className="text-stone-600">⠿</span>
              <span className="flex-1 truncate text-stone-200">{fields.find(([k]) => k === f)?.[1] ?? f}</span>
              <button onClick={() => toggle(f)} className="px-1 text-stone-500 hover:text-red-300">✕</button>
            </div>
          ))}
          <div className="mt-2 mb-1 px-1 text-[10px] font-semibold tracking-wider text-stone-500 uppercase">Available</div>
          <div className="max-h-48 overflow-y-auto">
            {fields.filter(([k]) => !columns.includes(k)).map(([k, label]) => (
              <button key={k} onClick={() => toggle(k)} disabled={columns.length >= MAX_COLUMNS} className="block w-full truncate rounded px-1 py-0.5 text-left text-[12px] text-stone-300 hover:bg-white/5 disabled:opacity-40">
                + {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
