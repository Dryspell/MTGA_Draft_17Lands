import { useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

const inTauri = '__TAURI_INTERNALS__' in window

export function WindowControls() {
  const [pinned, setPinned] = useState(true)
  if (!inTauri) return null
  const win = getCurrentWindow()

  const togglePin = async () => {
    await win.setAlwaysOnTop(!pinned)
    setPinned(!pinned)
  }

  const btn = 'flex size-6 items-center justify-center rounded text-stone-400 hover:bg-white/10 hover:text-white'
  return (
    <div className="flex items-center">
      <button onClick={togglePin} className={`${btn} ${pinned ? 'text-accent' : ''}`} title={pinned ? 'Unpin from top' : 'Keep on top'}>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
          <path d="M9.8 1.5 14.5 6.2l-1.4.6-2.4 2.4.3 3.3-1.4 1.4-2.6-2.6-3.5 3.5-.7-.7 3.5-3.5-2.6-2.6L5.1 6.6l3.3.3 2.4-2.4z" />
        </svg>
      </button>
      <button onClick={() => win.minimize()} className={btn} title="Minimize">
        <svg viewBox="0 0 16 16" className="size-3.5" stroke="currentColor" strokeWidth="1.5">
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <button onClick={() => win.close()} className={`${btn} hover:bg-red-500/80`} title="Close">
        <svg viewBox="0 0 16 16" className="size-3.5" stroke="currentColor" strokeWidth="1.5">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  )
}
