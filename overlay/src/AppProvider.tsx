import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, HOST } from './api'
import { AppContext, type AppState, type JobListener, type Toast, type Tone } from './store'
import type { BridgeMessage, Config, GameView, Job, Meta, Settings, Snapshot } from './types'

export function AppProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('Connecting to engine...')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [game, setGame] = useState<GameView | null>(null)
  const [decksVersion, setDecksVersion] = useState(0)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const jobs = useRef(new Map<string, Job>())
  const listeners = useRef(new Map<string, Set<JobListener>>())
  const toastId = useRef(0)

  const toast = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, message, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await api.config())
    } catch {
      // engine still booting; retried on the next Ready
    }
  }, [])

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: number | undefined
    let disposed = false

    const onJob = (job: Job) => {
      jobs.current.set(job.id, { ...jobs.current.get(job.id), ...job })
      listeners.current.get(job.id)?.forEach((fn) => fn(job))
    }

    const connect = () => {
      ws = new WebSocket(`ws://${HOST}/ws`)
      ws.onopen = () => {
        setConnected(true)
        api.meta().then(setMeta).catch(() => {})
        refreshConfig()
      }
      ws.onmessage = (ev) => {
        const msg: BridgeMessage = JSON.parse(ev.data)
        if (msg.type === 'status') {
          setStatus(msg.status)
          if (msg.status === 'Ready') refreshConfig()
        } else if (msg.type === 'snapshot') setSnapshot(msg.snapshot)
        else if (msg.type === 'game') setGame(msg.game)
        else if (msg.type === 'decks') setDecksVersion(msg.version)
        else if (msg.type === 'job') onJob(msg)
      }
      ws.onclose = () => {
        if (disposed) return
        // Job updates only arrive over this socket, so anything still running can never finish.
        for (const id of listeners.current.keys()) {
          const known = jobs.current.get(id)
          if (known && known.status !== 'running') continue
          onJob({ ...(known ?? { id, kind: '', progress: null }), status: 'error', message: 'Lost the connection to the engine before this finished' })
        }
        setConnected(false)
        setStatus('Engine offline, retrying...')
        retry = window.setTimeout(connect, 1500)
      }
    }
    connect()
    return () => {
      disposed = true
      window.clearTimeout(retry)
      ws?.close()
    }
  }, [refreshConfig])

  const patchConfig = useCallback(async (patch: Record<string, Record<string, unknown>>) => {
    setConfig((c) => {
      if (!c) return c
      const next = { ...c } as Record<string, unknown>
      for (const [section, values] of Object.entries(patch)) {
        next[section] = { ...(next[section] as object), ...values }
      }
      return next as unknown as Config
    })
    try {
      setConfig(await api.patchConfig(patch))
    } catch (e) {
      toast(`Could not save settings: ${(e as Error).message}`, 'error')
      refreshConfig()
    }
  }, [refreshConfig, toast])

  const patchSettings = useCallback((patch: Partial<Settings>) => patchConfig({ settings: patch }), [patchConfig])

  const runJob = useCallback(<T,>(start: Promise<Job>, onUpdate?: JobListener) => {
    return start.then(
      (job) =>
        new Promise<T>((resolve, reject) => {
          const settle = (j: Job) => {
            onUpdate?.(j)
            if (j.status === 'running') return
            listeners.current.get(job.id)?.delete(settle)
            if (j.status === 'done') resolve(j.result as T)
            else reject(new Error(j.message || 'Job failed'))
          }
          const set = listeners.current.get(job.id) ?? new Set()
          set.add(settle)
          listeners.current.set(job.id, set)
          const known = jobs.current.get(job.id)
          if (known && known.status !== 'running') settle(known)
        }),
    )
  }, [])

  const value = useMemo<AppState>(
    () => ({
      connected, status, snapshot, game, decksVersion, meta, config, toasts,
      patchSettings, patchConfig, refreshConfig, runJob, toast, dismissToast,
    }),
    [connected, status, snapshot, game, decksVersion, meta, config, toasts, patchSettings, patchConfig, refreshConfig, runJob, toast, dismissToast],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
