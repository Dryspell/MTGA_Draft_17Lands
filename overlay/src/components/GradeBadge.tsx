import { gradeTone } from '../lib/cards'

export function GradeBadge({ grade, muted }: { grade: string | null; muted?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 w-7 items-center justify-center rounded text-[11px] font-semibold ${gradeTone(grade)} ${muted ? 'opacity-60' : ''}`}
    >
      {grade ?? '–'}
    </span>
  )
}
