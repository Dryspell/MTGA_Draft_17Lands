import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import type { TierFile } from '../types'
import { openUrl } from '../lib/platform'
import { Button, Empty, Input, Section } from '../components/primitives'

export function TierListsView() {
  const { runJob, toast } = useApp()
  const [tiers, setTiers] = useState<TierFile[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api.tiers().then(setTiers).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const importTier = async () => {
    setBusy(true)
    try {
      await runJob(api.importTier(url.trim(), label.trim()))
      toast('Tier list imported. Add it as a column from any table’s Columns menu.', 'success')
      setUrl('')
      setLabel('')
      load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: TierFile) => {
    if (!window.confirm(`Delete tier list "${t.label}"?`)) return
    await api.deleteTier(t.filename)
    load()
  }

  return (
    <div className="flex flex-col gap-3">
      <Section title="Import from 17Lands">
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-stone-400">
            Create a tier list on{' '}
            <button className="text-accent hover:underline" onClick={() => openUrl('https://www.17lands.com/tier_list')}>17lands.com/tier_list</button>
            , then paste its share link here.
          </p>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.17lands.com/tier_list/..." />
          <div className="flex gap-1.5">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="flex-1" />
            <Button variant="primary" onClick={importTier} busy={busy} disabled={!url.trim()}>Import</Button>
          </div>
        </div>
      </Section>
      <Section title={`Saved tier lists (${tiers.length})`}>
        {tiers.length ? (
          <div className="flex flex-col">
            {tiers.map((t) => (
              <div key={t.filename} className="flex items-center gap-2 border-b border-line py-1.5 text-[12px] last:border-0">
                <span className="w-12 font-semibold text-stone-200">{t.set}</span>
                <span className="flex-1 truncate text-stone-300">{t.label}</span>
                <span className="text-[11px] text-stone-500">{t.date}</span>
                <Button variant="ghost" onClick={() => remove(t)} title="Delete">✕</Button>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No tier lists yet.</Empty>
        )}
      </Section>
    </div>
  )
}
