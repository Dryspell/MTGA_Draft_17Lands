import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { useUi } from '../ui'
import { inTauri, currentWindow, openUrl } from '../lib/platform'
import { checkForUpdate, type UpdateInfo } from '../lib/update'
import { SignalDots } from './Charts'

function useUpdate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    checkForUpdate().then(setUpdate, () => {})
  }, [])
  return update
}

export function TitleBar() {
  const { snapshot, connected, status, config, patchSettings } = useApp()
  const { mini, setMini } = useUi()
  const update = useUpdate()
  const pinned = config?.settings.always_on_top ?? true
  const live = !!snapshot && snapshot.pack > 0
  const btn = 'flex size-6 items-center justify-center rounded text-stone-400 hover:bg-white/10 hover:text-white'

  return (
    <header data-tauri-drag-region className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
      <span data-tauri-drag-region className={`size-1.5 shrink-0 rounded-full ${connected ? (live ? 'bg-emerald-400' : 'bg-stone-500') : 'bg-red-500'}`} />
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-baseline gap-2 truncate">
        {snapshot?.event.set ? (
          <>
            <span data-tauri-drag-region className="font-semibold text-white">{snapshot.event.set}</span>
            <span data-tauri-drag-region className="text-[11px] text-stone-400">{snapshot.event.type}</span>
          </>
        ) : (
          <span data-tauri-drag-region className="font-semibold text-stone-300">MTGA Draft</span>
        )}
        <span data-tauri-drag-region className={`truncate text-[11px] ${live ? 'tabular text-stone-200' : 'text-stone-500'}`}>
          {live ? `P${snapshot.pack} · p${snapshot.pick}` : status}
        </span>
        {snapshot && !snapshot.isLiveLog && snapshot.logFile && <span className="text-[11px] text-amber-400/80">past draft</span>}
      </div>
      {snapshot && live && <SignalDots signals={snapshot.signals} />}
      {update && (
        <button
          onClick={() => openUrl(update.url)}
          className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/30"
          title={`Version ${update.version} is available. Click to open the release page.`}
        >
          Update {update.version}
        </button>
      )}
      <div className="flex items-center">
        <button onClick={() => setMini(!mini)} className={btn} title={mini ? 'Restore full window' : 'Mini overlay mode'}>
          {mini ? '⤢' : '⤡'}
        </button>
        {inTauri && (
          <>
            <button onClick={() => patchSettings({ always_on_top: !pinned })} className={`${btn} ${pinned ? 'text-accent' : ''}`} title={pinned ? 'Unpin from top' : 'Keep on top'}>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
                <path d="M9.8 1.5 14.5 6.2l-1.4.6-2.4 2.4.3 3.3-1.4 1.4-2.6-2.6-3.5 3.5-.7-.7 3.5-3.5-2.6-2.6L5.1 6.6l3.3.3 2.4-2.4z" />
              </svg>
            </button>
            <button onClick={() => currentWindow().then((w) => w?.minimize())} className={btn} title="Minimize">
              <svg viewBox="0 0 16 16" className="size-3.5" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 8h9" /></svg>
            </button>
            <button onClick={() => currentWindow().then((w) => w?.close())} className={`${btn} hover:bg-red-500/80`} title="Close">
              <svg viewBox="0 0 16 16" className="size-3.5" stroke="currentColor" strokeWidth="1.5"><path d="m4 4 8 8M12 4l-8 8" /></svg>
            </button>
          </>
        )}
      </div>
    </header>
  )
}
