import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../store'
import { useUi } from '../ui'
import type { HistoryLog } from '../types'
import { downloadText, pickFile, pickFolder, pickSavePath, readClipboard } from '../lib/platform'
import { Button, Modal, Select } from './primitives'

export function TopBar() {
  const { snapshot, config, patchSettings, toast, connected } = useApp()
  const sources = snapshot?.sources
  const [history, setHistory] = useState<{ live: string | null; logs: HistoryLog[]; current: string } | null>(null)

  useEffect(() => {
    if (connected && config) api.history().then(setHistory).catch(() => {})
  }, [connected, config, snapshot?.draftId, snapshot?.logFile])

  let current: { event: string; group: string } | null = null
  for (const [event, groups] of Object.entries(sources?.events ?? {})) {
    for (const [group, file] of Object.entries(groups)) if (file === snapshot?.dataset) current = { event, group }
  }

  const setDataset = async (event: string, group?: string) => {
    const groups = sources?.events[event] ?? {}
    const file = groups[group ?? ''] ?? groups.All ?? Object.values(groups)[0]
    if (!file) return
    try {
      await api.setDataset(file)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const filter = config?.settings.deck_filter ?? 'Auto'
  const filters = snapshot?.filterOptions ?? {}
  const events = Object.keys(sources?.events ?? {})
  const groups = current ? Object.keys(sources?.events[current.event] ?? {}) : []

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
      <FileMenu />
      {events.length > 0 && (
        <>
          <Select value={current?.event ?? ''} onChange={(e) => setDataset(e.target.value)} title="Dataset event type" className="max-w-32">
            {!current && <option value="">Dataset…</option>}
            {events.map((e) => <option key={e} value={e}>{sources?.setCode} {e}</option>)}
          </Select>
          {groups.length > 1 && (
            <Select value={current?.group ?? ''} onChange={(e) => current && setDataset(current.event, e.target.value)} title="17Lands user group">
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          )}
        </>
      )}
      {Object.keys(filters).length > 0 && (
        <Select value={filter} onChange={(e) => patchSettings({ deck_filter: e.target.value })} title="Archetype used for win rates" className="max-w-36">
          {Object.entries(filters).map(([label, key]) => (
            <option key={key} value={key}>{key === 'Auto' ? `Auto${snapshot?.filter && filter === 'Auto' ? ` → ${snapshot.filter}` : ''}` : label}</option>
          ))}
        </Select>
      )}
      {history && (history.live || history.logs.length > 0) && (
        <Select
          value={history.current}
          onChange={(e) => api.openLog(e.target.value).catch((err) => toast(err.message, 'error'))}
          title="Live log or a past draft"
          className="max-w-40"
        >
          {history.live && <option value={history.live}>● Live (Player.log)</option>}
          {!history.logs.some((l) => l.path === history.current) && history.current !== history.live && (
            <option value={history.current}>{history.current.split(/[\\/]/).pop()}</option>
          )}
          {history.logs.length > 0 && (
            <optgroup label="Past drafts">
              {history.logs.map((l) => (
                <option key={l.path} value={l.path}>{l.set} {l.event} · {new Date(l.time).toLocaleDateString()}</option>
              ))}
            </optgroup>
          )}
        </Select>
      )}
      <div className="flex-1" />
      <Button variant="ghost" onClick={() => api.reload().then(() => toast('Rescanning log…'))} title="Rescan the current log">⟳</Button>
    </div>
  )
}

function FileMenu() {
  const { toast, snapshot } = useApp()
  const [open, setOpen] = useState(false)
  const [practice, setPractice] = useState<null | 'generate' | 'import'>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const guard = (fn: () => Promise<unknown>) => () => {
    setOpen(false)
    fn().catch((e) => toast((e as Error).message, 'error'))
  }

  const readLog = (title: string) => guard(async () => {
    const path = await pickFile(title, [{ name: 'Log files', extensions: ['log', 'txt'] }])
    if (path) await api.openLog(path)
  })

  const exportDraft = (format: 'csv' | 'json') => guard(async () => {
    const name = `${snapshot?.event.set || 'draft'}_${snapshot?.event.type || ''}_${new Date().toISOString().slice(0, 10)}.${format}`
    const path = await pickSavePath(`Export draft (${format.toUpperCase()})`, name, [{ name: format.toUpperCase(), extensions: [format] }])
    const res = await api.exportDraft(format, path ?? undefined)
    if (res.content !== undefined) downloadText(name, res.content)
    toast(`Draft exported${res.path ? ` to ${res.path}` : ''}`, 'success')
  })

  const locate = guard(async () => {
    const path = await pickFolder('Select the MTGA_Data folder')
    if (!path) return
    const res = await api.locateMtgaData(path)
    toast(`MTGA data folder set to ${res.path}`, 'success')
  })

  const items: ([string, () => void] | null)[] = [
    ['Read draft log…', readLog('Read draft log')],
    ['Read Player.log…', readLog('Read Player.log')],
    ['Locate MTGA data folder…', locate],
    null,
    ['Export draft (CSV)', exportDraft('csv')],
    ['Export draft (JSON)', exportDraft('json')],
    null,
    ['Practice: generate random sealed pool', () => { setOpen(false); setPractice('generate') }],
    ['Practice: import sealed pool from clipboard', () => { setOpen(false); setPractice('import') }],
  ]

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} title="File and tools">☰</Button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-64 rounded-lg bg-stone-800 py-1 shadow-xl ring-1 ring-white/10">
          {items.map((item, i) =>
            item ? (
              <button key={item[0]} onClick={item[1]} className="block w-full px-3 py-1.5 text-left text-[12px] text-stone-200 hover:bg-accent/80 hover:text-white">
                {item[0]}
              </button>
            ) : (
              <div key={i} className="my-1 border-t border-line" />
            ),
          )}
        </div>
      )}
      {practice && <PracticeDialog mode={practice} onClose={() => setPractice(null)} />}
    </div>
  )
}

export function PracticeDialog({ mode, onClose }: { mode: 'generate' | 'import'; onClose: () => void }) {
  const { toast } = useApp()
  const { setTab, setSealedId } = useUi()
  const [sets, setSets] = useState<{ code: string; label: string; active: boolean }[]>([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.practiceSets().then((s) => {
      setSets(s)
      setCode(s[0]?.code ?? '')
    }).catch((e) => toast(e.message, 'error'))
  }, [toast])

  const confirm = async () => {
    setBusy(true)
    try {
      const text = mode === 'import' ? await readClipboard() : ''
      const session = await api.practiceSealed(code, mode, text)
      setSealedId(session.id)
      setTab('deck')
      onClose()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const active = sets.filter((s) => s.active)
  const inactive = sets.filter((s) => !s.active)
  return (
    <Modal
      title={mode === 'import' ? 'Import practice sealed pool' : 'Generate practice sealed pool'}
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!code} onClick={confirm}>{mode === 'import' ? 'Import from clipboard' : 'Generate pool'}</Button></>}
    >
      <p className="mb-3 text-[12px] text-stone-400">
        {mode === 'import'
          ? 'Copy a pool in MTGA format (e.g. "1 Card Name") to your clipboard, then pick the set it belongs to.'
          : 'Opens six packs (1 rare/mythic, 3 uncommons, 10 commons each) from a downloaded dataset.'}
      </p>
      <Select value={code} onChange={(e) => setCode(e.target.value)} className="w-full">
        {active.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
        {inactive.length > 0 && <optgroup label="Other sets">{inactive.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</optgroup>}
      </Select>
    </Modal>
  )
}
