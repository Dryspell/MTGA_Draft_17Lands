import { useEffect, useState } from 'react'
import type { BridgeMessage, Snapshot } from './types'

const HOST = import.meta.env.VITE_BRIDGE_HOST ?? '127.0.0.1:8617'
const HTTP = `http://${HOST}`

export interface BridgeState {
  connected: boolean
  status: string
  snapshot: Snapshot | null
}

export function useBridge(): BridgeState {
  const [state, setState] = useState<BridgeState>({
    connected: false,
    status: 'Connecting to engine...',
    snapshot: null,
  })

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: number | undefined
    let disposed = false

    const connect = () => {
      ws = new WebSocket(`ws://${HOST}/ws`)
      ws.onopen = () => setState((s) => ({ ...s, connected: true }))
      ws.onmessage = (ev) => {
        const msg: BridgeMessage = JSON.parse(ev.data)
        if (msg.type === 'status') setState((s) => ({ ...s, status: msg.status }))
        else setState((s) => ({ ...s, snapshot: msg.snapshot }))
      }
      ws.onclose = () => {
        if (disposed) return
        setState((s) => ({ ...s, connected: false, status: 'Engine offline, retrying...' }))
        retry = window.setTimeout(connect, 1500)
      }
    }
    connect()

    return () => {
      disposed = true
      window.clearTimeout(retry)
      ws?.close()
    }
  }, [])

  return state
}

export interface FilterOptions {
  current: string | null
  options: Record<string, string>
}

export const api = {
  filters: (): Promise<FilterOptions> => fetch(`${HTTP}/api/filters`).then((r) => r.json()),
  setFilter: (filter: string) =>
    fetch(`${HTTP}/api/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter }),
    }),
  reload: () => fetch(`${HTTP}/api/reload`, { method: 'POST' }),
}
