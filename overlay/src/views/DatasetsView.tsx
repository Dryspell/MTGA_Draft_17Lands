import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import type { DatasetFile, SetOption } from '../types'
import { Button, Input, Progress, Section, Select } from '../components/primitives'

export function DatasetsView() {
  const { meta, runJob, toast, snapshot } = useApp()
  const [data, setData] = useState<{ files: DatasetFile[]; sets: SetOption[]; excluded: string[]; liveSets: string[] } | null>(null)
  const [form, setForm] = useState({ set: '', event: '', group: 'All', period: 'All Time', threshold: '500' })
  const [job, setJob] = useState<{ progress: number | null; message: string } | null>(null)

  const load = useCallback(() => api.datasets().then((d) => {
    setData(d)
    setForm((f) => {
      if (f.set) return f
      const first = d.sets[0]
      return first ? { ...f, set: first.name, event: first.formats[0] ?? '' } : f
    })
  }).catch(() => {}), [])
  useEffect(() => { load() }, [load, snapshot?.dataset])

  const set = data?.sets.find((s) => s.name === form.set)

  const download = async () => {
    if (!/^\d+$/.test(form.threshold.trim() || '500')) return toast('Min games must be numeric.', 'error')
    setJob({ progress: 0, message: 'Starting download…' })
    try {
      const res = await runJob<{ filename: string; limited: boolean }>(
        api.downloadDataset({ set: form.set, event: form.event, group: form.group, period: form.period, threshold: Number(form.threshold || 500) }),
        (j) => setJob((cur) => ({ progress: j.progress ?? cur?.progress ?? null, message: j.message || cur?.message || '' })),
      )
      toast(res.limited ? 'Downloaded (limited data)' : 'Download successful', 'success')
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setJob(null)
    }
  }

  const guarded = (fn: () => Promise<unknown>, confirmText?: string) => async () => {
    if (confirmText && !window.confirm(confirmText)) return
    try {
      await fn()
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const activate = (f: DatasetFile) => guarded(async () => {
    await api.setDataset(f.filename)
    toast(`Using ${f.set} ${f.event} (${f.group})`, 'success')
  })()

  const remove = (f: DatasetFile) => guarded(
    () => api.deleteDataset(f.filename),
    `Delete ${f.filename}?\n\nIt will be excluded from automatic sync until you restore excluded datasets.`,
  )()

  const clearInactive = guarded(async () => {
    const res = await api.clearInactive()
    toast(`Removed ${res.removed} dataset(s).${res.failures.length ? ` ${res.failures.length} could not be removed.` : ''}`, res.failures.length ? 'error' : 'success')
  }, `Delete every dataset that isn't active or for a live set${data?.liveSets.length ? ` (${data.liveSets.join(', ')})` : ''}?`)

  const restore = guarded(async () => {
    await api.restoreExcluded()
    toast('Excluded datasets will download again on the next sync.', 'success')
  })

  const reset = guarded(async () => {
    const res = await api.resetDatasets()
    toast(`Removed ${res.removed} dataset(s). Restart to download fresh 17Lands data.`, 'success')
  }, 'Delete all downloaded datasets?\n\nThe latest 17Lands data will be re-downloaded automatically the next time you start the app. Deleted datasets stay excluded.')

  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div className="flex flex-col gap-3">
      <Section title="Download from 17Lands">
        <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
          <Field label="Set">
            <Select value={form.set} onChange={(e) => {
              const s = data?.sets.find((x) => x.name === e.target.value)
              update({ set: e.target.value, event: s?.formats[0] ?? '' })
            }} className="w-full">
              {data?.sets.filter((s) => s.live).length ? <optgroup label="Live sets">{data.sets.filter((s) => s.live).map((s) => <option key={s.name} value={s.name}>{s.name} ({s.code})</option>)}</optgroup> : null}
              <optgroup label="All sets">{data?.sets.filter((s) => !s.live).map((s) => <option key={s.name} value={s.name}>{s.name} ({s.code})</option>)}</optgroup>
            </Select>
          </Field>
          <Field label="Event">
            <Select value={form.event} onChange={(e) => update({ event: e.target.value })} className="w-full">
              {(set?.formats ?? meta?.limitedTypes ?? []).map((f) => <option key={f}>{f}</option>)}
            </Select>
          </Field>
          <Field label="Users">
            <Select value={form.group} onChange={(e) => update({ group: e.target.value })} className="w-full">
              {(meta?.userGroups ?? ['All']).map((g) => <option key={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="Period">
            <Select value={form.period} onChange={(e) => update({ period: e.target.value })} className="w-full">
              {(meta?.timePeriods ?? ['All Time']).map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Min games">
            <Input value={form.threshold} onChange={(e) => update({ threshold: e.target.value })} className="w-full" />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" className="w-full" onClick={download} busy={!!job} disabled={!form.set || !form.event}>Download</Button>
          </div>
        </div>
        {job && <div className="mt-3"><Progress value={job.progress} message={job.message} /></div>}
      </Section>

      <Section title={`Local datasets (${data?.files.length ?? 0})`} right={<span className="text-[10px] text-stone-500">click to activate</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] tracking-wide text-stone-500 uppercase">
                <th className="py-1 font-semibold">Set</th><th className="font-semibold">Event</th><th className="font-semibold">Users</th>
                <th className="font-semibold">Dates</th><th className="font-semibold">Collected</th><th className="text-right font-semibold">Games</th><th />
              </tr>
            </thead>
            <tbody>
              {data?.files.map((f) => (
                <tr key={f.filename} onClick={() => !f.active && activate(f)} className={`cursor-pointer border-t border-line ${f.active ? 'bg-accent/15 text-white' : 'text-stone-300 hover:bg-white/5'}`}>
                  <td className="py-1.5 pl-1">{f.active && <span className="mr-1 text-accent">●</span>}{f.set}</td>
                  <td>{f.event}</td>
                  <td>{f.group}</td>
                  <td className="text-stone-400">{f.start} → {f.end}</td>
                  <td className="text-stone-400">{f.collected.slice(0, 16)}</td>
                  <td className="tabular text-right">{f.games.toLocaleString()}</td>
                  <td className="text-right">
                    {!f.active && <button onClick={(e) => { e.stopPropagation(); remove(f) }} className="px-2 text-stone-500 hover:text-red-300" title="Delete dataset">✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="flex flex-wrap gap-1.5">
        <Button onClick={clearInactive}>Clear inactive datasets</Button>
        {!!data?.excluded.length && <Button onClick={restore}>Restore excluded ({data.excluded.length})</Button>}
        <div className="flex-1" />
        <Button variant="danger" onClick={reset}>Reset dataset cache</Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-wider text-stone-500 uppercase">{label}</span>
      {children}
    </label>
  )
}
