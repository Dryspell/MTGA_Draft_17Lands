import { COLOR_VAR, parseManaCost } from '../lib/cards'

function Pip({ symbol }: { symbol: string }) {
  const parts = symbol.split('/')
  const colored = parts.filter((p) => COLOR_VAR[p] && p !== 'C')
  const background =
    colored.length === 2
      ? `linear-gradient(135deg, ${COLOR_VAR[colored[0]]} 50%, ${COLOR_VAR[colored[1]]} 50%)`
      : colored.length === 1
        ? COLOR_VAR[colored[0]]
        : '#57534e'
  const label = colored.length ? '' : symbol
  return (
    <span
      className="inline-flex size-3.5 items-center justify-center rounded-full text-[9px] font-bold text-stone-900 shadow-[inset_0_-1px_0_rgb(0_0_0/0.25)]"
      style={{ background }}
      title={symbol}
    >
      {label && <span className="text-stone-100">{label}</span>}
    </span>
  )
}

export function ManaCost({ cost }: { cost: string }) {
  const symbols = parseManaCost(cost)
  if (!symbols.length) return null
  return (
    <span className="inline-flex gap-0.5">
      {symbols.map((s, i) => (
        <Pip key={i} symbol={s} />
      ))}
    </span>
  )
}
